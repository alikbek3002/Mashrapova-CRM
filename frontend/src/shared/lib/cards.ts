// Подписи абонементов для людей: «1 месяц · 12 занятий · осталось 12 ·
// с 13 октября 2026 по 13 ноября 2026» вместо «monthly · 12 · … · active».
import { fmtPeriod } from "./dates";

type L = "ru" | "ky";

const TYPE_TEXT: Record<string, { ru: string; ky: string }> = {
  monthly:    { ru: "1 месяц",            ky: "1 ай" },
  quarterly:  { ru: "3 месяца",           ky: "3 ай" },
  half_year:  { ru: "6 месяцев",          ky: "6 ай" },
  nine_month: { ru: "9 месяцев",          ky: "9 ай" },
  annual:     { ru: "12 месяцев",         ky: "12 ай" },
  personal:   { ru: "Персональный",       ky: "Жеке" },
  single:     { ru: "Разовое занятие",    ky: "Бир жолку сабак" },
  trial:      { ru: "Пробная тренировка", ky: "Сыноо машыгуусу" },
};

const STATUS_TEXT: Record<string, { ru: string; ky: string }> = {
  active:   { ru: "действует",      ky: "күчүндө" },
  ending:   { ru: "заканчивается",  ky: "бүтүп баратат" },
  frozen:   { ru: "заморожен",      ky: "тындырылган" },
  expired:  { ru: "истёк",          ky: "мөөнөтү бүттү" },
  debt:     { ru: "долг",           ky: "карыз" },
  archived: { ru: "в архиве",       ky: "архивде" },
};

// Срок абонемента в месяцах (ТЗ §4.1: «1 месяц», «3 месяца» …).
// Остальные типы живут по дням из тарифа.
export const CARD_MONTHS: Record<string, number> = {
  monthly: 1, quarterly: 3, half_year: 6, nine_month: 9, annual: 12,
};

export const cardTypeText = (type: string | null | undefined, lang: L): string =>
  (type && TYPE_TEXT[type]?.[lang]) ?? type ?? "—";

export const cardStatusText = (status: string | null | undefined, lang: L): string =>
  (status && STATUS_TEXT[status]?.[lang]) ?? status ?? "—";

// 1 занятие, 2 занятия, 12 занятий
export const lessonsText = (n: number, lang: L): string => {
  if (lang === "ky") return `${n} сабак`;
  const d10 = n % 10, d100 = n % 100;
  const w = d10 === 1 && d100 !== 11 ? "занятие"
    : d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14) ? "занятия" : "занятий";
  return `${n} ${w}`;
};

export const cardLabel = (
  c: { type: string; total_lessons?: number | null; start_date: string; end_date: string; status?: string | null },
  lang: L,
  remaining?: number | null,
): string =>
  [
    cardTypeText(c.type, lang),
    c.total_lessons ? lessonsText(c.total_lessons, lang) : null,
    remaining != null ? (lang === "ru" ? `осталось ${remaining}` : `калды ${remaining}`) : null,
    fmtPeriod(c.start_date, c.end_date, lang),
    // «действует» очевидно, пишем только когда что-то не так
    c.status && c.status !== "active" ? cardStatusText(c.status, lang) : null,
  ].filter(Boolean).join(" · ");
