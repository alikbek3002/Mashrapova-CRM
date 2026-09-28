// Поле времени со своим выбором вместо системного <input type="time">.
// value/onChange — как у input: "ЧЧ:ММ" (значение "ЧЧ:ММ:СС" тоже понимает).
// Время можно ввести руками («1830» → «18:30») или выбрать часы и минуты.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type ChangeEventLike = { target: { value: string }; currentTarget: { value: string } };

type Props = {
  value?: string | null;
  onChange?: (e: ChangeEventLike) => void;
  disabled?: boolean;
  required?: boolean;
  step?: number | string;
  min?: string;
  max?: string;
  title?: string;
  id?: string;
  name?: string;
  className?: string;
  style?: CSSProperties;
};

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const norm = (v?: string | null) => (/^\d{2}:\d{2}/.test(v ?? "") ? (v as string).slice(0, 5) : "");
const mask = (raw: string) => {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
};
const valid = (s: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return !!m && +m[1] < 24 && +m[2] < 60;
};

export const TimeInput = ({ value, onChange, disabled, required, title, id, name, className, style }: Props) => {
  const cur = norm(value);
  const [text, setText] = useState(cur);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hRef = useRef<HTMLDivElement>(null);
  const mRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);

  useEffect(() => { setText(cur); }, [cur]);

  const emit = (v: string) => onChange?.({ target: { value: v }, currentTarget: { value: v } });
  const h = cur ? +cur.slice(0, 2) : null;
  const m = cur ? +cur.slice(3, 5) : null;

  const setPart = (part: "h" | "m", n: number) => {
    const hh = part === "h" ? n : (h ?? 9);
    const mm = part === "m" ? n : (m ?? 0);
    emit(`${pad(hh)}:${pad(mm)}`);
    if (part === "m") setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const W = 216, H = 300;
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

  // Прокрутить колонки к выбранным значениям.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      hRef.current?.querySelector<HTMLElement>(".is-selected")?.scrollIntoView({ block: "center" });
      mRef.current?.querySelector<HTMLElement>(".is-selected")?.scrollIntoView({ block: "center" });
    });
  }, [open]);

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

  return (
    <div ref={wrapRef} className={`dp-field tp-field${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={className}
        style={style}
        value={text}
        placeholder="чч:мм"
        title={title}
        disabled={disabled}
        required={required}
        onFocus={() => !disabled && setOpen(true)}
        onClick={() => !disabled && setOpen(true)}
        onChange={(e) => {
          const v = mask(e.target.value);
          setText(v);
          if (valid(v)) emit(v);
          else if (v === "" && !required) emit("");
        }}
        onBlur={() => { if (text && !valid(text)) setText(cur); }}
        onKeyDown={(e) => { if (e.key === "Enter" && open) { e.preventDefault(); setOpen(false); } }}
      />
      <button
        type="button"
        className="dp-field__btn"
        tabIndex={-1}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        aria-label="Время"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className={`dp tp${pos.up ? " dp--up" : ""}`} style={{ top: pos.top, left: pos.left }}>
          <div className="dp__head tp__head">
            <span className="tp__big">{h != null ? pad(h) : "––"}<i>:</i>{m != null ? pad(m) : "––"}</span>
          </div>
          <div className="tp__cols">
            <div className="tp__col" ref={hRef}>
              {HOURS.map((n) => (
                <button key={n} type="button" className={`tp__cell${n === h ? " is-selected" : ""}`} onClick={() => setPart("h", n)}>
                  {pad(n)}
                </button>
              ))}
            </div>
            <div className="tp__col" ref={mRef}>
              {MINUTES.map((n) => (
                <button key={n} type="button" className={`tp__cell${n === m ? " is-selected" : ""}`} onClick={() => setPart("m", n)}>
                  {pad(n)}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
