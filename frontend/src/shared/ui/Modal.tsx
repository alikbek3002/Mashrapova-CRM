import { useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../data";

export const Modal = ({
  open,
  onClose,
  title,
  children,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  // "full" — почти во весь экран (совпадает с паддингом .modal-overlay,
  // 20px с каждой стороны), для широких таблиц (табель группы).
  width?: number | "full";
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  // Портал в body. Без него родитель с `transform`/`animation`
  // (например, `.admin-table tbody tr` с uq-fade-in) становится
  // containing block'ом для `position: fixed` overlay'я — и модалка
  // прибивается к ячейке таблицы вместо viewport'а.
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: width === "full" ? "calc(100vw - 40px)" : width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal__head">
          <div className="modal__title">{title}</div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

export const Field = ({
  label,
  children,
  hint,
  error,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: string;
  error?: string;
}) => (
  <label className="field">
    <span className="field__label">{label}</span>
    {children}
    {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
  </label>
);

export const Toast = ({ message, kind = "ok" }: { message: string; kind?: "ok" | "err" }) => (
  <div className={`toast toast--${kind}`}>
    <Icon name={kind === "ok" ? "check" : "warn"} size={14} />
    {message}
  </div>
);
