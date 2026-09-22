import { supabaseAdmin } from "./supabase.js";

// =====================================================================
// Генерация занятий группы по group_schedule.
//
// Раньше занятия создавались только вручную (кнопка «сгенерировать» в
// админке) — при продаже абонемента с окном дальше сгенерированного
// горизонта ребёнок «записывался» лишь на существующие уроки (жалоба:
// «должен был раскидать до 12.11, а записал только до 24.09»), а дни,
// добавленные в расписание позже, вообще не появлялись (нет суббот).
//
// Идемпотентно: пары (date, start_time), уже существующие у группы,
// пропускаются; диапазон обрезается по [starts_on, ends_on] группы.
// =====================================================================

const parseYmd = (s: string): [number, number, number] => {
  const parts = s.split("-");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
};
const dowOf = (s: string): number => {
  const [y, m, d] = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const nextDay = (s: string): string => {
  const [y, m, d] = parseYmd(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};
export const addDays = (s: string, days: number): string => {
  const [y, m, d] = parseYmd(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export type EnsureResult =
  | { ok: true; inserted: number; reason?: string }
  | { ok: false; error: string; message?: string };

export const ensureLessonsForGroup = async (
  groupId: string,
  from: string,
  to: string,
  createdBy: string | null = null,
): Promise<EnsureResult> => {
  const { data: group, error: gErr } = await supabaseAdmin
    .from("groups")
    .select("id, organization_id, coach_id, starts_on, ends_on, is_active, deleted_at")
    .eq("id", groupId)
    .maybeSingle();
  if (gErr || !group) return { ok: false, error: "group_not_found" };
  if (!group.coach_id) return { ok: true, inserted: 0, reason: "no_coach" };
  if (group.deleted_at || group.is_active === false) {
    return { ok: true, inserted: 0, reason: "group_inactive" };
  }

  let effFrom = from;
  let effTo = to;
  const startsOn = group.starts_on as string | null;
  const endsOn = group.ends_on as string | null;
  if (startsOn && startsOn > effFrom) effFrom = startsOn;
  if (endsOn && endsOn < effTo) effTo = endsOn;
  if (effFrom > effTo) return { ok: true, inserted: 0, reason: "outside_group_term" };

  const { data: schedules, error: sErr } = await supabaseAdmin
    .from("group_schedule")
    .select("*")
    .eq("group_id", groupId);
  if (sErr) return { ok: false, error: "schedule_load_failed", message: sErr.message };
  if (!schedules || schedules.length === 0) {
    return { ok: true, inserted: 0, reason: "no_schedule_defined" };
  }

  const { data: existing } = await supabaseAdmin
    .from("lessons")
    .select("date, start_time")
    .eq("group_id", groupId)
    .gte("date", effFrom)
    .lte("date", effTo);
  const existingKeys = new Set(
    (existing ?? []).map((l: { date: string; start_time: string }) => `${l.date}_${l.start_time}`),
  );

  const toInsert: Record<string, unknown>[] = [];
  let cursor = effFrom;
  while (cursor <= effTo) {
    const dow = dowOf(cursor);
    for (const s of schedules.filter((x: { day_of_week: number }) => x.day_of_week === dow)) {
      const key = `${cursor}_${s.start_time}`;
      if (existingKeys.has(key)) continue;
      toInsert.push({
        organization_id: group.organization_id,
        group_id: groupId,
        coach_id: group.coach_id,
        date: cursor,
        start_time: s.start_time,
        duration_min: s.duration_min,
        type: "regular",
        status: "scheduled",
        created_by: createdBy,
      });
    }
    cursor = nextDay(cursor);
  }

  if (toInsert.length === 0) return { ok: true, inserted: 0 };

  const { error: iErr } = await supabaseAdmin.from("lessons").insert(toInsert);
  if (iErr) return { ok: false, error: "insert_failed", message: iErr.message };
  return { ok: true, inserted: toInsert.length };
};

// Горизонт по всем активным группам: занятия должны существовать от
// сегодня до max(today + BASE_HORIZON_DAYS, конец самого дальнего
// активного enrollment группы). Вызывается планировщиком; идемпотентно.
const BASE_HORIZON_DAYS = 30;

export const ensureLessonHorizon = async (
  log?: { warn: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void },
): Promise<{ groups: number; inserted: number }> => {
  const today = todayIso();
  const baseTo = addDays(today, BASE_HORIZON_DAYS);

  const { data: groups, error: gErr } = await supabaseAdmin
    .from("groups")
    .select("id")
    .eq("is_active", true)
    .is("deleted_at", null);
  if (gErr || !groups) {
    log?.warn({ err: gErr }, "lesson_horizon_groups_failed");
    return { groups: 0, inserted: 0 };
  }

  // Максимальный конец окна записи по каждой группе одним запросом.
  const { data: enr } = await supabaseAdmin
    .from("enrollments")
    .select("group_id, end_date")
    .is("archived_at", null)
    .gte("end_date", today);
  const maxEndByGroup = new Map<string, string>();
  for (const e of enr ?? []) {
    const cur = maxEndByGroup.get(e.group_id);
    if (!cur || e.end_date > cur) maxEndByGroup.set(e.group_id, e.end_date);
  }

  // Потолок генерации: битое окно записи (опечатка в годе) не должно
  // плодить занятия на годы вперёд. 366 дней покрывает самый длинный тариф.
  const hardCap = addDays(today, 366);

  let inserted = 0;
  for (const g of groups) {
    const maxEnd = maxEndByGroup.get(g.id);
    let to = maxEnd && maxEnd > baseTo ? maxEnd : baseTo;
    if (to > hardCap) to = hardCap;
    const res = await ensureLessonsForGroup(g.id, today, to);
    if (!res.ok) {
      log?.warn({ group_id: g.id, err: res }, "lesson_horizon_group_failed");
    } else if (res.inserted > 0) {
      inserted += res.inserted;
      log?.info({ group_id: g.id, inserted: res.inserted, to }, "lesson_horizon_generated");
    }
  }
  return { groups: groups.length, inserted };
};
