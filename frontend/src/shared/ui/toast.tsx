// Lightweight toast system — no external deps.
import { useEffect, useState, useCallback } from "react";
import { Icon } from "../../data";

type ToastKind = "ok" | "err" | "info";
type ToastItem = { id: string; message: string; kind: ToastKind };

let listeners: Array<(item: ToastItem) => void> = [];

export const toast = {
  ok: (message: string) => emit({ id: rid(), message, kind: "ok" }),
  err: (message: string) => emit({ id: rid(), message, kind: "err" }),
  info: (message: string) => emit({ id: rid(), message, kind: "info" }),
};

const rid = () => Math.random().toString(36).slice(2);
const emit = (item: ToastItem) => {
  for (const l of listeners) l(item);
};

export const ToastHost = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    const onItem = (item: ToastItem) => {
      setItems((prev) => [...prev, item]);
      setTimeout(() => remove(item.id), item.kind === "err" ? 6000 : 3000);
    };
    listeners.push(onItem);
    return () => {
      listeners = listeners.filter((l) => l !== onItem);
    };
  }, [remove]);

  if (items.length === 0) return null;
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} onClick={() => remove(t.id)}>
          <Icon name={t.kind === "ok" ? "check" : t.kind === "err" ? "warn" : "sparkle"} size={14} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
};
