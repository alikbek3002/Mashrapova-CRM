// Поле даты со своим календарём вместо системного <input type="date">.
// Интерфейс как у input: value — "ГГГГ-ММ-ДД" (или ""), onChange получает
// событие с e.target.value в том же формате, поэтому код вокруг не меняется.
// Дату можно ввести руками (ДД.ММ.ГГГГ) или выбрать в календаре.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type ChangeEventLike = { target: { value: string }; currentTarget: { value: string } };

type Props = {
  value?: string | null;
  onChange?: (e: ChangeEventLike) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  title?: string;
  id?: string;
  name?: string;
  className?: string;
  style?: CSSProperties;
};

const MONTHS = {
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  ky: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
};
const MONTHS_SHORT = {
  ru: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  ky: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
};
const WEEKDAYS = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  ky: ["Дш", "Шш", "Шр", "Бш", "Жм", "Иш", "Жк"],
};
const TXT = {
  ru: { today: "Сегодня", clear: "Очистить", pick: "Выбрать дату" },
  ky: { today: "Бүгүн", clear: "Тазалоо", pick: "Күндү тандоо" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => { const d = new Date(); return toIso(d.getFullYear(), d.getMonth(), d.getDate()); };
const isoToDisplay = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
};
const displayToIso = (s: string): string | null => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return toIso(y, mo - 1, d);
};
// Маска ввода: только цифры, точки ставятся сами — «25092026» → «25.09.2026».
const maskDisplay = (raw: string) => {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
};

const currentLang = (): "ru" | "ky" =>
  typeof document !== "undefined" && document.documentElement.lang === "ky" ? "ky" : "ru";

type View = "days" | "months" | "years";

export const DateInput = ({
  value, onChange, min, max, disabled, required, placeholder, title, id, name, className, style,
}: Props) => {
  const lang = currentLang();
  const t = TXT[lang];
  const iso = value ?? "";
  const [text, setText] = useState(isoToDisplay(iso));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("days");
  const base = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayIso();
  const [cursor, setCursor] = useState({ y: +base.slice(0, 4), m: +base.slice(5, 7) - 1 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);

  useEffect(() => { setText(isoToDisplay(iso)); }, [iso]);

  const emit = (v: string) => {
    const ev = { target: { value: v }, currentTarget: { value: v } };
    onChange?.(ev);
  };

  const inRange = (d: string) => (!min || d >= min) && (!max || d <= max);

  const openPicker = () => {
    if (disabled) return;
    const b = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayIso();
    setCursor({ y: +b.slice(0, 4), m: +b.slice(5, 7) - 1 });
    setView("days");
    setOpen(true);
  };

  // Позиция всплывашки: под полем, а если не влезает — над ним.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const W = 296, H = 372;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
      const up = r.bottom + H + 8 > window.innerHeight && r.top - H - 8 > 0;
      setPos({ top: up ? r.top - H - 6 : r.bottom + 6, left, up });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Закрытие по клику снаружи и по Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (popRef.current?.contains(tgt) || wrapRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const days = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const shift = (first.getDay() + 6) % 7; // понедельник — первый день
    const start = new Date(cursor.y, cursor.m, 1 - shift);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { iso: toIso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), out: d.getMonth() !== cursor.m, wd: (i % 7) };
    });
  }, [cursor]);

  const yearStart = cursor.y - (cursor.y % 12);
  const today = todayIso();

  const pick = (d: string) => {
    if (!inRange(d)) return;
    emit(d);
    setOpen(false);
  };

  const step = (dir: 1 | -1) => {
    if (view === "days") {
      const m = cursor.m + dir;
      setCursor({ y: cursor.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
    } else if (view === "months") {
      setCursor({ ...cursor, y: cursor.y + dir });
    } else {
      setCursor({ ...cursor, y: cursor.y + dir * 12 });
    }
  };

  const title_ =
    view === "days" ? <>{MONTHS[lang][cursor.m]} <span>{cursor.y}</span></>
    : view === "months" ? <>{cursor.y}</>
    : <>{yearStart} — {yearStart + 11}</>;

  const popup = open && pos && createPortal(
    <div
      ref={popRef}
      className={`dp${pos.up ? " dp--up" : ""}`}
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={t.pick}
    >
      <div className="dp__head">
        <button type="button" className="dp__nav" onClick={() => step(-1)} aria-label="‹">‹</button>
        <button
          type="button"
          className="dp__title"
          onClick={() => setView(view === "days" ? "months" : view === "months" ? "years" : "days")}
        >
          {title_}
        </button>
        <button type="button" className="dp__nav" onClick={() => step(1)} aria-label="›">›</button>
      </div>

      {view === "days" && (
        <>
          <div className="dp__week">
            {WEEKDAYS[lang].map((w, i) => <span key={w} className={i >= 5 ? "is-weekend" : ""}>{w}</span>)}
          </div>
          <div className="dp__grid">
            {days.map((d) => (
              <button
                key={d.iso}
                type="button"
                disabled={!inRange(d.iso)}
                className={[
                  "dp__day",
                  d.out && "is-out",
                  d.wd >= 5 && "is-weekend",
                  d.iso === today && "is-today",
                  d.iso === iso && "is-selected",
                ].filter(Boolean).join(" ")}
                onClick={() => pick(d.iso)}
              >
                <span>{d.day}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {view === "months" && (
        <div className="dp__grid dp__grid--3">
          {MONTHS_SHORT[lang].map((mn, i) => (
            <button
              key={mn}
              type="button"
              className={[
                "dp__cell",
                iso.startsWith(`${cursor.y}-${pad(i + 1)}`) && "is-selected",
                today.startsWith(`${cursor.y}-${pad(i + 1)}`) && "is-today",
              ].filter(Boolean).join(" ")}
              onClick={() => { setCursor({ ...cursor, m: i }); setView("days"); }}
            >
              <span>{mn}</span>
            </button>
          ))}
        </div>
      )}

      {view === "years" && (
        <div className="dp__grid dp__grid--3">
          {Array.from({ length: 12 }, (_, i) => yearStart + i).map((y) => (
            <button
              key={y}
              type="button"
              className={[
                "dp__cell",
                iso.startsWith(`${y}-`) && "is-selected",
                today.startsWith(`${y}-`) && "is-today",
              ].filter(Boolean).join(" ")}
              onClick={() => { setCursor({ ...cursor, y }); setView("months"); }}
            >
              <span>{y}</span>
            </button>
          ))}
        </div>
      )}

      <div className="dp__foot">
        <button type="button" className="dp__link" disabled={!inRange(today)} onClick={() => pick(today)}>{t.today}</button>
        {!required && iso && (
          <button type="button" className="dp__link dp__link--muted" onClick={() => { emit(""); setOpen(false); }}>{t.clear}</button>
        )}
      </div>
    </div>,
    document.body,
  );

  return (
    <div ref={wrapRef} className={`dp-field${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={className}
        style={style}
        value={text}
        placeholder={placeholder ?? (lang === "ru" ? "дд.мм.гггг" : "кк.аа.жжжж")}
        title={title}
        disabled={disabled}
        required={required}
        onFocus={openPicker}
        onClick={() => { if (!open) openPicker(); }}
        onChange={(e) => {
          const masked = maskDisplay(e.target.value);
          setText(masked);
          const parsed = displayToIso(masked);
          if (parsed && inRange(parsed)) {
            emit(parsed);
            setCursor({ y: +parsed.slice(0, 4), m: +parsed.slice(5, 7) - 1 });
          } else if (masked === "" && !required) {
            emit("");
          }
        }}
        onBlur={() => {
          // Недописанная или неверная дата — возвращаем последнюю правильную.
          if (text && !displayToIso(text)) setText(isoToDisplay(iso));
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && open) { e.preventDefault(); setOpen(false); } }}
      />
      <button
        type="button"
        className="dp-field__btn"
        tabIndex={-1}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-label={t.pick}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
      {popup}
    </div>
  );
};
