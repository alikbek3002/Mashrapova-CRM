// Проходная по расписанию: окна доступа детей на терминалах Hikvision.
//
// Решение «пускать/не пускать» принимает САМ терминал через срок действия
// персоны (UserInfo.Valid, точность до секунды, локальное время). Backend
// раз в минуту считает для каждого ребёнка желаемое состояние и, если оно
// отличается от последнего отправленного (таблица access_grants), шлёт
// ISUP-сервису POST /valid по каждому онлайн-терминалу.
//
// Состояния персоны:
//   window       — [начало занятия − before, конец + after]: текущее или
//                  ближайшее сегодняшнее занятие (группа или ПТ);
//   none         — занятий сегодня больше нет: Valid в прошлом
//                  (enable:false НЕЛЬЗЯ — у Hikvision это «без ограничений»);
//   unrestricted — режим выключен: 2023…2033, как при обычной заливке лица.
// Сотрудников (person_no 20001+) планировщик не трогает.
import type { FastifyBaseLogger } from "fastify";
import { env } from "./env.js";
import { supabaseAdmin } from "./supabase.js";
import { orgDateOf } from "./hik-pt.js";

export type GrantState = "window" | "none" | "unrestricted";
export type Desired = { state: GrantState; from: string | null; until: string | null }; // ISO UTC

export type AccessSettings = {
  enabled: boolean;
  beforeMin: number;
  afterMin: number;
  autoExitHours: number;
};

export type AccessWindowRow = {
  child_id: string;
  starts_at: string;
  ends_at: string;
  source: "lesson" | "pt";
  ref_id: string;
};

const NONE_BEGIN = "2000-01-01T00:00:00";
const NONE_END = "2000-01-01T00:00:01";
const FOREVER_BEGIN = "2023-01-01T00:00:00";
const FOREVER_END = "2033-12-30T23:59:59";

const ORG_OFFSET_MS = 6 * 3_600_000; // Бишкек UTC+6, без перехода на летнее время

/** ISO UTC → локальное время терминала без смещения ("2026-09-05T16:45:00"). */
export const toTerminalLocal = (iso: string): string =>
  new Date(Date.parse(iso) + ORG_OFFSET_MS).toISOString().slice(0, 19);

const isupHeaders = {
  "Content-Type": "application/json",
  "X-Internal-Key": env.HIK_INGEST_SECRET ?? "",
};

// ---------------------------------------------------------------------
// Настройки и данные
// ---------------------------------------------------------------------

export const loadAccessSettings = async (): Promise<AccessSettings> => {
  const { data } = await supabaseAdmin
    .from("org_settings")
    .select("access_schedule_enabled, access_before_min, access_after_min, access_auto_exit_hours")
    .limit(1)
    .maybeSingle();
  return {
    enabled: !!data?.access_schedule_enabled,
    beforeMin: data?.access_before_min ?? 15,
    afterMin: data?.access_after_min ?? 15,
    autoExitHours: data?.access_auto_exit_hours ?? 5,
  };
};

/** Занятия дня (группы + ПТ) детей с номером на проходной. p_date — местная дата. */
export const loadAccessWindows = async (orgDate: string): Promise<AccessWindowRow[]> => {
  const { data, error } = await supabaseAdmin.rpc("fn_access_windows", { p_date: orgDate });
  if (error) throw new Error(`fn_access_windows: ${error.message}`);
  return (data ?? []) as AccessWindowRow[];
};

type Interval = { from: number; until: number };

/** Паддинги + слияние пересекающихся окон одного ребёнка. */
export const paddedIntervals = (rows: AccessWindowRow[], s: AccessSettings): Interval[] => {
  const list = rows
    .map((r) => ({
      from: Date.parse(r.starts_at) - s.beforeMin * 60_000,
      until: Date.parse(r.ends_at) + s.afterMin * 60_000,
    }))
    .filter((i) => !Number.isNaN(i.from) && !Number.isNaN(i.until) && i.until > i.from)
    .sort((a, b) => a.from - b.from);
  const merged: Interval[] = [];
  for (const i of list) {
    const last = merged[merged.length - 1];
    if (last && i.from <= last.until) last.until = Math.max(last.until, i.until);
    else merged.push({ ...i });
  }
  return merged;
};

/** Текущее (now внутри) либо ближайшее будущее окно; null — на сегодня всё. */
export const pickWindow = (intervals: Interval[], nowMs: number): Interval | null => {
  for (const i of intervals) {
    if (nowMs < i.until) return i; // отсортированы по from: первое незакончившееся
  }
  return null;
};

export const desiredFor = (intervals: Interval[], nowMs: number): Desired => {
  const w = pickWindow(intervals, nowMs);
  if (!w) return { state: "none", from: null, until: null };
  return { state: "window", from: new Date(w.from).toISOString(), until: new Date(w.until).toISOString() };
};

const sameDesired = (a: Desired, b: { state: string; valid_from: string | null; valid_until: string | null }) =>
  a.state === b.state
  && (a.state !== "window"
    || (b.valid_from != null && b.valid_until != null
      && Date.parse(b.valid_from) === Date.parse(a.from!)
      && Date.parse(b.valid_until) === Date.parse(a.until!)));

/** Локальные begin/end для терминала по желаемому состоянию. */
export const terminalValid = (d: Desired): { begin: string; end: string } => {
  if (d.state === "window") return { begin: toTerminalLocal(d.from!), end: toTerminalLocal(d.until!) };
  if (d.state === "none") return { begin: NONE_BEGIN, end: NONE_END };
  return { begin: FOREVER_BEGIN, end: FOREVER_END };
};

// ---------------------------------------------------------------------
// Желаемое состояние всех детей
// ---------------------------------------------------------------------

type Kid = { id: string; person_no: string };

/** Дети, у которых есть персона на терминале (номер + фото/факт заливки). */
const loadKids = async (): Promise<Kid[]> => {
  const { data, error } = await supabaseAdmin
    .from("children")
    .select("id, access_person_no")
    .not("access_person_no", "is", null)
    .or("face_enrolled_at.not.is.null,face_photo_path.not.is.null")
    .is("deleted_at", null)
    .limit(5000);
  if (error) throw new Error(`children: ${error.message}`);
  return (data ?? []).map((k) => ({ id: k.id, person_no: k.access_person_no! }));
};

export const computeDesiredAll = async (
  nowMs: number,
  settings: AccessSettings,
): Promise<Map<string, { kid: Kid; desired: Desired }>> => {
  const kids = await loadKids();
  const out = new Map<string, { kid: Kid; desired: Desired }>();
  if (!settings.enabled) {
    for (const kid of kids) out.set(kid.id, { kid, desired: { state: "unrestricted", from: null, until: null } });
    return out;
  }
  const rows = await loadAccessWindows(orgDateOf(nowMs));
  const byChild = new Map<string, AccessWindowRow[]>();
  for (const r of rows) {
    const arr = byChild.get(r.child_id) ?? [];
    arr.push(r);
    byChild.set(r.child_id, arr);
  }
  for (const kid of kids) {
    const desired = desiredFor(paddedIntervals(byChild.get(kid.id) ?? [], settings), nowMs);
    out.set(kid.id, { kid, desired });
  }
  return out;
};

/** Окно ребёнка на сегодня (для карточки): все интервалы + выбранный. */
export const windowsForChild = async (childId: string, nowMs = Date.now()) => {
  const settings = await loadAccessSettings();
  const rows = (await loadAccessWindows(orgDateOf(nowMs))).filter((r) => r.child_id === childId);
  const intervals = paddedIntervals(rows, settings);
  return {
    settings,
    intervals: intervals.map((i) => ({ from: new Date(i.from).toISOString(), until: new Date(i.until).toISOString() })),
    desired: settings.enabled ? desiredFor(intervals, nowMs) : ({ state: "unrestricted", from: null, until: null } as Desired),
    lessons: rows,
  };
};

// ---------------------------------------------------------------------
// Реконсайлер
// ---------------------------------------------------------------------

const onlineDevices = async (): Promise<string[]> => {
  const res = await fetch(`${env.ISUP_API_URL}/healthz`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { devices_online?: Record<string, string> };
  return Object.keys(body.devices_online ?? {});
};

type GrantRow = {
  child_id: string; device_serial: string; state: string;
  valid_from: string | null; valid_until: string | null; pushed_at: string; error: string | null;
};

export type SyncStatus = {
  last_tick_at: string | null;
  last_duration_ms: number | null;
  devices_online: string[];
  children: number;
  pending: number;        // отличий осталось после тика
  pushed: number;         // отправлено в последнем тике
  errors: number;         // строк access_grants с ошибкой
  running: boolean;
  last_error: string | null;
};

const status: SyncStatus = {
  last_tick_at: null, last_duration_ms: null, devices_online: [], children: 0,
  pending: 0, pushed: 0, errors: 0, running: false, last_error: null,
};
export const accessSyncStatus = (): SyncStatus => ({ ...status });

/** Сбросить отправленное состояние ребёнка — следующий тик перевыставит окно. */
export const invalidateGrants = async (childId: string) => {
  await supabaseAdmin.from("access_grants").delete().eq("child_id", childId);
};

const MAX_OPS_PER_DEVICE = 150;
const RETRY_ERROR_MS = 5 * 60_000;          // повтор после ошибки терминала
const RETRY_NOT_FOUND_MS = 30 * 60_000;     // персоны нет — ждём заливку лица (face-sync)

type Job = { kid: Kid; desired: Desired; device: string; priority: number };

const pushOne = async (log: FastifyBaseLogger, job: Job): Promise<void> => {
  const v = terminalValid(job.desired);
  let error: string | null = null;
  try {
    const res = await fetch(`${env.ISUP_API_URL}/valid`, {
      method: "POST", headers: isupHeaders,
      body: JSON.stringify({
        device_id: job.device, person_no: job.kid.person_no, valid_from: v.begin, valid_until: v.end,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { devices?: Record<string, string> };
        detail = parsed.devices?.[job.device] ?? detail;
      } catch { /* не JSON */ }
      error = detail;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const { error: dbErr } = await supabaseAdmin.from("access_grants").upsert({
    child_id: job.kid.id,
    device_serial: job.device,
    state: job.desired.state,
    valid_from: job.desired.from,
    valid_until: job.desired.until,
    pushed_at: new Date().toISOString(),
    error,
  }, { onConflict: "child_id,device_serial" });
  if (dbErr) log.warn({ err: dbErr }, "hik_access_grant_save_failed");
  if (error) log.warn({ child: job.kid.id, device: job.device, error }, "hik_access_window_push_failed");
  else log.info({ child: job.kid.id, device: job.device, ...job.desired }, "hik_access_window_pushed");
};

let running = false;

/** Один тик: желаемое состояние vs access_grants → отправка отличий. */
export const runAccessWindowSync = async (log: FastifyBaseLogger, nowMs = Date.now()) => {
  if (!env.HIK_INGEST_SECRET) return;
  if (running) return; // предыдущий тик ещё шлёт
  running = true;
  status.running = true;
  const started = Date.now();
  try {
    let devices: string[];
    try {
      devices = await onlineDevices();
    } catch {
      status.last_error = "isup_unreachable";
      return;
    }
    status.devices_online = devices;
    if (devices.length === 0) return;

    const settings = await loadAccessSettings();
    const desiredAll = await computeDesiredAll(nowMs, settings);
    status.children = desiredAll.size;

    const { data: grantRows, error } = await supabaseAdmin
      .from("access_grants").select("*").limit(20000);
    if (error) throw new Error(`access_grants: ${error.message}`);
    const grants = new Map<string, GrantRow>();
    for (const g of (grantRows ?? []) as GrantRow[]) grants.set(`${g.child_id}|${g.device_serial}`, g);

    const jobsByDevice = new Map<string, Job[]>();
    let errors = 0;
    for (const { kid, desired } of desiredAll.values()) {
      for (const device of devices) {
        const g = grants.get(`${kid.id}|${device}`);
        if (g?.error) errors++;
        let need = !g || !sameDesired(desired, g);
        if (!need && g?.error) {
          const age = nowMs - Date.parse(g.pushed_at);
          need = age > (g.error === "person_not_found" ? RETRY_NOT_FOUND_MS : RETRY_ERROR_MS);
        }
        if (!need) continue;
        // приоритет: ближайшее окно раньше всех; затем снятие доступа; затем бессрочные
        const priority = desired.state === "window" ? Date.parse(desired.from!)
          : desired.state === "none" ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
        const arr = jobsByDevice.get(device) ?? [];
        arr.push({ kid, desired, device, priority });
        jobsByDevice.set(device, arr);
      }
    }
    status.errors = errors;

    let pushed = 0;
    let pending = 0;
    // терминалы — независимые сессии SDK: параллельно между собой,
    // последовательно внутри одного (один CMS-канал)
    await Promise.all([...jobsByDevice.entries()].map(async ([, jobs]) => {
      jobs.sort((a, b) => a.priority - b.priority);
      const take = jobs.slice(0, MAX_OPS_PER_DEVICE);
      pending += jobs.length - take.length;
      for (const job of take) {
        await pushOne(log, job);
        pushed++;
      }
    }));
    status.pushed = pushed;
    status.pending = pending;
    status.last_error = null;
    if (pushed > 0 || pending > 0) log.info({ pushed, pending, devices }, "hik_access_window_tick");
  } catch (e) {
    status.last_error = e instanceof Error ? e.message : String(e);
    log.warn({ err: e }, "hik_access_window_tick_threw");
  } finally {
    running = false;
    status.running = false;
    status.last_tick_at = new Date().toISOString();
    status.last_duration_ms = Date.now() - started;
  }
};

/** Желаемое окно ребёнка прямо сейчас — для заливки лица (чтобы не открыть доступ до тика). */
export const currentValidFor = async (childId: string): Promise<{ begin: string; end: string } | null> => {
  try {
    const w = await windowsForChild(childId);
    return terminalValid(w.desired);
  } catch {
    return null;
  }
};
