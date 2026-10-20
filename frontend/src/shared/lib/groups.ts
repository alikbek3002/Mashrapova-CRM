// Подпись группы в выпадающих списках: «Детская группа · Пн/Ср/Пт 17:00 ·
// Осмонов Элмырза». Офис выбирает группу по времени и тренеру, а не по
// названию (просьба 2026-10-21).
import type { Lang } from "../../data";
import { scheduleDaysText } from "./enrollmentWindow";

type Slot = { day_of_week: number; start_time: string };
type Person = { full_name?: string | null } | null;
export type GroupForLabel = {
  name: string;
  coach?: Person | Person[];
  schedule?: Slot[] | null;
};

// «Пн/Ср/Пт 17:00» или «Пн/Ср 17:00, Пт 18:00», если время разное.
export const scheduleText = (lang: Lang, schedule: Slot[]): string => {
  const byTime = new Map<string, Slot[]>();
  for (const s of schedule) {
    const hhmm = (s.start_time ?? "").slice(0, 5);
    byTime.set(hhmm, [...(byTime.get(hhmm) ?? []), s]);
  }
  return Array.from(byTime.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, slots]) => `${scheduleDaysText(lang, slots)} ${time}`.trim())
    .join(", ");
};

export const groupOptionLabel = (g: GroupForLabel, lang: Lang): string => {
  const coach = Array.isArray(g.coach) ? g.coach[0] : g.coach;
  return [
    g.name.trim(),
    g.schedule && g.schedule.length > 0 ? scheduleText(lang, g.schedule) : null,
    coach?.full_name?.trim() || null,
  ].filter(Boolean).join(" · ");
};
