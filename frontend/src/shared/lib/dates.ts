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
