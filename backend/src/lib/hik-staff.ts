// Проходная для сотрудников (тренеры, менеджеры, директор — все profiles).
// У profiles нет колонок под номер/фото/статус, а миграции сейчас применить
// нельзя (нет доступа к БД на DDL) — храним в app_metadata учётки Supabase:
//   auth.users.app_metadata.access = { person_no, face_photo_path, face_enrolled_at }
// Пишет/читает только backend (service role). При появлении доступа к БД
// переносится в колонки одной миграцией без изменения API.
import { supabaseAdmin } from "./supabase.js";

export type StaffAccess = {
  access_person_no: string | null;
  face_photo_path: string | null;
  face_enrolled_at: string | null;
};

export type StaffAccessRow = { id: string; full_name: string; access: StaffAccess };

const EMPTY: StaffAccess = { access_person_no: null, face_photo_path: null, face_enrolled_at: null };
const STAFF_NO_START = 20000; // номера сотрудников: 20001+ (дети — 10001+)

const fromMeta = (meta: Record<string, unknown> | undefined): StaffAccess => {
  const a = (meta?.access ?? {}) as Partial<StaffAccess>;
  return {
    access_person_no: a.access_person_no ?? null,
    face_photo_path: a.face_photo_path ?? null,
    face_enrolled_at: a.face_enrolled_at ?? null,
  };
};

export const getStaffAccess = async (profileId: string): Promise<StaffAccess | null> => {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(profileId);
  if (error || !data.user) return null;
  return fromMeta(data.user.app_metadata as Record<string, unknown>);
};

export const setStaffAccess = async (profileId: string, patch: Partial<StaffAccess>) => {
  const { data } = await supabaseAdmin.auth.admin.getUserById(profileId);
  const cur = fromMeta(data?.user?.app_metadata as Record<string, unknown>);
  const next = { ...cur, ...patch };
  const { error } = await supabaseAdmin.auth.admin.updateUserById(profileId, {
    app_metadata: { ...(data?.user?.app_metadata ?? {}), access: next },
  });
  if (error) throw new Error(`staff_access_update_failed: ${error.message}`);
  // правим кэш на месте: полный listUsers (все учётки, вкл. родителей) — секунды
  if (cache) {
    const row = cache.rows.find((r) => r.id === profileId);
    if (row) row.access = next;
    else {
      const { data: p } = await supabaseAdmin.from("profiles").select("full_name").eq("id", profileId).maybeSingle();
      cache.rows.push({ id: profileId, full_name: p?.full_name ?? "", access: next });
    }
  }
  return next;
};

// Список сотрудников с данными проходной. auth.admin.listUsers — тяжёлый
// вызов (все учётки, включая родителей), поэтому кэшируем на минуту.
let cache: { at: number; rows: StaffAccessRow[] } | null = null;
let refreshing: Promise<StaffAccessRow[]> | null = null;

export const listStaffAccess = async (): Promise<StaffAccessRow[]> => {
  // кэш никогда не «протухает» для читателя: отдаём что есть, обновляем в фоне
  if (cache) {
    if (Date.now() - cache.at > 60_000 && !refreshing) {
      refreshing = loadStaffAccess().finally(() => { refreshing = null; });
    }
    return cache.rows;
  }
  return refreshing ?? (refreshing = loadStaffAccess().finally(() => { refreshing = null; }));
};

const loadStaffAccess = async (): Promise<StaffAccessRow[]> => {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`list_users_failed: ${error.message}`);
  const withAccess = data.users
    .map((u) => ({ id: u.id, access: fromMeta(u.app_metadata as Record<string, unknown>) }))
    .filter((u) => u.access.access_person_no || u.access.face_photo_path);
  const ids = withAccess.map((u) => u.id);
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles").select("id, full_name").in("id", ids);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }
  const rows = withAccess.map((u) => ({ id: u.id, full_name: names.get(u.id) ?? "", access: u.access }));
  cache = { at: Date.now(), rows };
  return rows;
};

export const staffByPersonNo = async (personNo: string): Promise<StaffAccessRow | null> => {
  const rows = await listStaffAccess().catch(() => [] as StaffAccessRow[]);
  return rows.find((r) => r.access.access_person_no === personNo) ?? null;
};

export const nextStaffPersonNo = async (): Promise<string> => {
  const rows = await listStaffAccess();
  const max = rows
    .map((r) => Number(r.access.access_person_no))
    .filter((n) => Number.isFinite(n) && n > STAFF_NO_START && n < 100000)
    .reduce((a, b) => Math.max(a, b), STAFF_NO_START);
  return String(max + 1);
};

export const emptyStaffAccess = (): StaffAccess => ({ ...EMPTY });
