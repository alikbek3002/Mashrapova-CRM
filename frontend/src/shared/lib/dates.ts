// Человеческий формат дат для UI. В БД и API даты живут как YYYY-MM-DD —
// показывать их людям надо как ДД.ММ.ГГГГ («даты наоборот» — жалоба офиса).
// Строковый разбор без new Date(): нет сюрпризов с таймзоной.

export const fmtD = (iso?: string | null): string => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
};

export const fmtRange = (from?: string | null, to?: string | null): string =>
  `${fmtD(from)} → ${fmtD(to)}`;

// «13 октября 2026» / «13-октябрь 2026» — для сроков абонемента, где
// офис просил писать месяц словами.
const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_KY = ["январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export const fmtDLong = (iso: string | null | undefined, lang: "ru" | "ky"): string => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const day = Number(m[3]);
  const mon = Number(m[2]) - 1;
  return lang === "ru" ? `${day} ${MONTHS_RU[mon]} ${m[1]}` : `${day}-${MONTHS_KY[mon]} ${m[1]}`;
};

// «с 13 октября 2026 по 13 ноября 2026»
export const fmtPeriod = (from: string | null | undefined, to: string | null | undefined, lang: "ru" | "ky"): string =>
  lang === "ru" ? `с ${fmtDLong(from, lang)} по ${fmtDLong(to, lang)}` : `${fmtDLong(from, lang)} — ${fmtDLong(to, lang)}`;

// То же число через n месяцев: 13.10 → 13.11. Если такого числа нет,
// берём последний день месяца: 31.01 + 1 месяц → 28.02 (29.02).
export const addMonthsIso = (iso: string, n: number): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
};

export const addDaysIso = (iso: string, n: number): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
