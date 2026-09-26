// Выпадающий список со своим меню вместо системного.
// Настоящий <select> остаётся (стили, ширина и подпись выбранного пункта —
// как раньше), но открывается наше меню: отметка выбранного, поиск в длинных
// списках, стрелки / Enter / Escape. onChange получает e.target.value — как у select.
import {
  Children, Fragment, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ChangeEventLike = { target: { value: string }; currentTarget: { value: string } };

type Props = {
  value?: string | number | null;
  onChange?: (e: ChangeEventLike) => void;
  disabled?: boolean;
  required?: boolean;
  style?: CSSProperties;
  className?: string;
  title?: string;
  id?: string;
  name?: string;
  children?: ReactNode;
};

type Item = { value: string; label: ReactNode; text: string; disabled: boolean };

const textOf = (n: ReactNode): string => {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (isValidElement(n)) return textOf((n.props as { children?: ReactNode }).children);
  return "";
};

// Разворачиваем <option> из детей: фрагменты, массивы из .map(), условия.
const collect = (children: ReactNode, out: Item[] = []): Item[] => {
  Children.forEach(children, (ch) => {
    if (!isValidElement(ch)) return;
    const props = ch.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    if (ch.type === "option") {
      const label = props.children;
      out.push({
        value: props.value != null ? String(props.value) : textOf(label),
        label,
        text: textOf(label),
        disabled: !!props.disabled,
      });
    } else if (ch.type === Fragment || ch.type === "optgroup") {
      collect(props.children, out);
    }
  });
  return out;
};

const SEARCH_FROM = 9; // поиск появляется в списках от 9 пунктов

export const Select = ({ value, onChange, disabled, required, style, className, title, id, name, children }: Props) => {
  const items = useMemo(() => collect(children), [children]);
  const current = value == null ? "" : String(value);
  const selRef = useRef<HTMLSelectElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number; up: boolean } | null>(null);

  const visible = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return qq ? items.filter((it) => it.text.toLowerCase().includes(qq)) : items;
  }, [items, q]);

  const openMenu = () => {
    if (disabled || items.length === 0) return;
    setQ("");
    const idx = items.findIndex((it) => it.value === current);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const choose = (it: Item) => {
    if (it.disabled) return;
    setOpen(false);
    selRef.current?.focus();
    if (it.value !== current) onChange?.({ target: { value: it.value }, currentTarget: { value: it.value } });
  };

  // Тач: не даём открыться системному колесу — слушатель не пассивный.
  useEffect(() => {
    const el = selRef.current;
    if (!el) return;
    const onTouch = (e: TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      setOpen((o) => { if (!o) { setQ(""); setActive(Math.max(0, items.findIndex((it) => it.value === current))); } return !o; });
    };
    el.addEventListener("touchstart", onTouch, { passive: false });
    return () => el.removeEventListener("touchstart", onTouch);
  }, [disabled, items, current]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = selRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 180);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      const maxH = Math.min(340, up ? above : below);
      setPos({ top: up ? r.top - 6 : r.bottom + 6, left, width, maxH, up });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Клик снаружи, клавиатура.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const tgt = e.target as Node;
      if (popRef.current?.contains(tgt) || selRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); selRef.current?.focus(); }
      // stopPropagation: иначе то же нажатие дойдёт до <select> и откроет меню снова.
      else if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setActive((a) => Math.min(visible.length - 1, a + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setActive((a) => Math.max(0, a - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); const it = visible[active]; if (it) choose(it); }
      else if (e.key === "Tab") { setOpen(false); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  });

  // Держим активный пункт в поле зрения.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const withSearch = items.length >= SEARCH_FROM;

  return (
    <>
      <select
        ref={selRef}
        id={id}
        name={name}
        value={current}
        disabled={disabled}
        required={required}
        style={style}
        className={`sel-native${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        title={title}
        onChange={() => { /* значение меняется только через наше меню */ }}
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else { selRef.current?.focus(); openMenu(); } }}
        onKeyDown={(e) => {
          if (open) return;
          if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); openMenu(); }
        }}
      >
        {children}
      </select>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className={`sel-pop${pos.up ? " sel-pop--up" : ""}`}
          style={{
            left: pos.left, width: pos.width, maxHeight: pos.maxH,
            ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
          }}
          role="listbox"
        >
          {withSearch && (
            <div className="sel-pop__search">
              <input
                autoFocus
                value={q}
                onChange={(e) => { setQ(e.target.value); setActive(0); }}
                placeholder={document.documentElement.lang === "ky" ? "Издөө…" : "Поиск…"}
              />
            </div>
          )}
          <div className="sel-pop__list" ref={listRef}>
            {visible.length === 0 && (
              <div className="sel-pop__empty">{document.documentElement.lang === "ky" ? "Табылган жок" : "Ничего не найдено"}</div>
            )}
            {visible.map((it, i) => (
              <button
                key={`${it.value}-${i}`}
                type="button"
                data-idx={i}
                role="option"
                aria-selected={it.value === current}
                disabled={it.disabled}
                className={[
                  "sel-pop__opt",
                  it.value === current && "is-selected",
                  i === active && "is-active",
                ].filter(Boolean).join(" ")}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(it)}
              >
                <span className="sel-pop__label">{it.label}</span>
                {it.value === current && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
