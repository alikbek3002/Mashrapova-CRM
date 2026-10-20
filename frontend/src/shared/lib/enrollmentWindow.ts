// Расчёт окна записи (date-window enrollment): от даты первой тренировки
// отсчитываем N занятий по расписанию группы и получаем дату конца окна.
//
// Дни недели/перебор дат — в UTC (как в backend/src/routes/v1/lessons-bulk.ts),
// чтобы day_of_week и итерация не съезжали по таймзоне.
import { I18N } from "../../data";
import type { Lang } from "../../data";
import type { GroupSchedule } from "../types/database";

type ScheduleSlot = Pick<GroupSchedule, "day_of_week" | "start_time">;

const parseYmd = (s: string): [number, number, number] => {
  const p = s.split("-");
  return [Number(p[0]), Number(p[1]), Number(p[2])];
};
const dowOf = (s: string): number => {
  const [y, m, d] = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Вс … 6=Сб
};
const nextDay = (s: string): string => {
  const [y, m, d] = parseYmd(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};

const MAX_ITER = 732; // ~2 года — страховка от пустого/битого расписания

// I18N.weekdays идёт с понедельника; day_of_week — с воскресенья (0).
const weekdayIdx = (dow: number) => (dow + 6) % 7;

/**
 * Дата N-го занятия окна, начиная со startDate (включительно).
 * Считаем ЗАНЯТИЯ, а не дни: день с 2 слотами расписания = 2 занятия
 * (так же, как генерируются реальные занятия в lessons-bulk).
 * @returns YYYY-MM-DD или null, если расписание пустое / N не достигнут.
 */
export const computeWindowEnd = (
  startDate: string,
  count: number,
  schedule: ScheduleSlot[],
): string | null => {
  if (!startDate || count <= 0 || schedule.length === 0) return null;
  let seen = 0;
  let cursor = startDate;
  for (let i = 0; i < MAX_ITER; i++) {
    const dow = dowOf(cursor);
    const slotsToday = schedule.filter((s) => s.day_of_week === dow).length;
    if (slotsToday > 0) {
      seen += slotsToday;
      if (seen >= count) return cursor;
    }
    cursor = nextDay(cursor);
  }
  return null;
};

/**
 * Дни тренировок группы для кассы: «Пн/Ср/Пт».
 */
export const scheduleDaysText = (lang: Lang, schedule: ScheduleSlot[]): string => {
  const wd = I18N[lang].weekdays; // с понедельника
  return Array.from(new Set(schedule.map((s) => s.day_of_week)))
    .sort((a, b) => weekdayIdx(a) - weekdayIdx(b))
    .map((dow) => wd[weekdayIdx(dow)])
    .join("/");
};
