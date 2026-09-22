// Автозаполнение entry_time/exit_time в ПТ-занятиях из событий турникета
// (§6.3 документа интеграции). Проведение тренировки турникет НЕ отмечает —
// completed_source/status не трогаем, только время входа/выхода.

export type PtSessionInfo = {
  date: string;          // pt_sessions.date (локальная дата организации)
  start_time: string;    // pt_sessions.start_time ("17:00:00")
  duration_min: number | null;
  status: string;
};

export type PtLessonCandidate = {
  id: string;
  entry_time: string | null;
  exit_time: string | null;
  status: string;
  session: PtSessionInfo;
};

export type PtAutofillPatch = {
  id: string;
  patch: { entry_time: string } | { exit_time: string };
};

// Окно сопоставления: проход в пределах ±90 мин от начала (вход) /
// конца (выход) тренировки считается относящимся к ней.
export const PT_MATCH_WINDOW_MIN = 90;

// Бишкек — UTC+6 круглый год (перехода на летнее время нет).
// organizations.timezone заведён на будущее; для единственной организации
// константа проще и не тянет lookup таймзоны на каждый проход.
export const ORG_UTC_OFFSET = "+06:00";

export const sessionStartMs = (s: PtSessionInfo): number =>
  Date.parse(`${s.date}T${s.start_time}${ORG_UTC_OFFSET}`);

// Локальная (бишкекская) дата события — для выборки сессий за день.
export const orgDateOf = (eventMs: number): string =>
  new Date(eventMs + 6 * 3_600_000).toISOString().slice(0, 10);

// Окно ±90 мин может пересекать местную полночь (сессия 23:30 или 00:30) —
// выбираем сессии за соседние даты тоже. ±4 ч покрывает окно + длительность.
export const orgDatesAround = (eventMs: number): string[] => [
  ...new Set([
    orgDateOf(eventMs - 4 * 3_600_000),
    orgDateOf(eventMs),
    orgDateOf(eventMs + 4 * 3_600_000),
  ]),
];

const INACTIVE = new Set(["cancelled", "rescheduled"]);

/**
 * Подбирает ПТ-занятие ребёнка под событие прохода и возвращает патч
 * для pt_lessons (или null, если сопоставлять нечего/не с чем).
 *
 * Правила:
 * - direction "in" (и "unknown" — на пилоте один терминал на вход):
 *   заполняем entry_time только если он ещё пуст (первый вход — истина).
 * - direction "out": заполняем/сдвигаем exit_time, если событие позже
 *   текущего значения (ребёнок мог выйти и вернуться — берём последний выход).
 * - Отменённые/перенесённые занятия и сессии не участвуют.
 * - Из нескольких кандидатов берём ближайший по времени к якорю
 *   (начало сессии для входа, конец — для выхода).
 */
export const matchPtLesson = (
  lessons: PtLessonCandidate[],
  eventMs: number,
  direction: "in" | "out" | "unknown",
): PtAutofillPatch | null => {
  const windowMs = PT_MATCH_WINDOW_MIN * 60_000;
  const dir = direction === "out" ? "out" : "in";

  let best: PtLessonCandidate | null = null;
  let bestDist = Infinity;
  for (const l of lessons) {
    if (INACTIVE.has(l.status) || INACTIVE.has(l.session.status)) continue;
    const start = sessionStartMs(l.session);
    if (Number.isNaN(start)) continue;
    // выход до начала сессии к ней не относится (иначе exit_time < entry_time)
    if (dir === "out" && eventMs <= start) continue;
    const anchor = dir === "in" ? start : start + (l.session.duration_min ?? 60) * 60_000;
    const dist = Math.abs(eventMs - anchor);
    // при равном расстоянии — детерминированно по id (порядок строк из БД не задан)
    if (dist <= windowMs && (dist < bestDist || (dist === bestDist && best !== null && l.id < best.id))) {
      best = l;
      bestDist = dist;
    }
  }
  if (!best) return null;

  const iso = new Date(eventMs).toISOString();
  if (dir === "in") {
    // Занятое entry_time сознательно НЕ «перетекает» на соседнее занятие:
    // повторный вход того же ребёнка не должен фиктивно открывать другую сессию.
    if (best.entry_time) return null;
    return { id: best.id, patch: { entry_time: iso } };
  }
  if (best.entry_time && eventMs <= Date.parse(best.entry_time)) return null;
  if (best.exit_time && Date.parse(best.exit_time) >= eventMs) return null;
  return { id: best.id, patch: { exit_time: iso } };
};
