// Конец окна записи в группу, когда ребёнка с действующим абонементом
// добавляют в группу или переводят. Правило то же, что при продаже:
// пакет на месяцы — до конца абонемента (срок календарный); разовое,
// пробное, персональное — до N-го занятия группы от даты записи,
// а без расписания — до конца абонемента.
import { supabase } from "./supabase";
import { computeWindowEnd } from "../lib/enrollmentWindow";
import { CARD_MONTHS } from "../lib/cards";

export const enrollmentEndFor = async (
  card: { type?: string | null; total_lessons?: number | null; end_date?: string | null },
  groupId: string,
  fromDate: string,
): Promise<string | null> => {
  if (card.type && CARD_MONTHS[card.type]) return card.end_date ?? null;
  const { data: schedule } = await supabase
    .from("group_schedule")
    .select("day_of_week, start_time")
    .eq("group_id", groupId);
  return computeWindowEnd(fromDate, card.total_lessons ?? 0, schedule ?? []) ?? card.end_date ?? null;
};
