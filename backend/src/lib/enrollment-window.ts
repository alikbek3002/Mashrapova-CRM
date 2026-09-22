import { supabaseAdmin } from "./supabase.js";

/**
 * Держит окно записи ребёнка в группе согласованным с переносом занятия.
 *
 * Ребёнок числится в группе только внутри [enrollments.start_date,
 * enrollments.end_date] — по этому окну строятся и ростер занятия, и табель
 * (см. useEnrollmentsByGroup / useGroupTabel). Окно рассчитывается при продаже
 * абонемента по датам N ближайших занятий, поэтому перенос урока вперёд
 * выталкивает его за границу окна: занятие в расписании есть, а ребёнка в нём
 * уже нет, и оплаченная тренировка теряется. Особенно больно это при
 * заморозке — там дат сдвигается много.
 *
 * Правило: если занятие уехало с даты A на более позднюю B, всем активным
 * записям этой группы, чьё окно накрывало A, но заканчивается раньше B,
 * продлеваем end_date до B. Перенос назад окно не трогает — там занятие и так
 * остаётся внутри.
 *
 * @returns сколько записей поправили
 */
export async function extendEnrollmentWindowsForMove(
  moves: { group_id: string; previous_date: string; new_date: string }[],
): Promise<number> {
  // Сдвиги вперёд, сгруппированные по группе: для каждой берём самый дальний
  // новый край и самый ранний исходный — один UPDATE на группу.
  const byGroup = new Map<string, { minPrev: string; maxNext: string }>();
  for (const m of moves) {
    if (!m.group_id || m.new_date <= m.previous_date) continue;
    const cur = byGroup.get(m.group_id);
    if (!cur) {
      byGroup.set(m.group_id, { minPrev: m.previous_date, maxNext: m.new_date });
    } else {
      if (m.previous_date < cur.minPrev) cur.minPrev = m.previous_date;
      if (m.new_date > cur.maxNext) cur.maxNext = m.new_date;
    }
  }
  if (byGroup.size === 0) return 0;

  let touched = 0;
  for (const [groupId, { minPrev, maxNext }] of byGroup) {
    const { data, error } = await supabaseAdmin
      .from("enrollments")
      .update({ end_date: maxNext })
      .eq("group_id", groupId)
      .is("archived_at", null)
      .not("end_date", "is", null)
      .gte("end_date", minPrev)
      .lt("end_date", maxNext)
      .select("id");
    if (error) throw new Error(error.message);
    touched += data?.length ?? 0;
  }
  return touched;
}
