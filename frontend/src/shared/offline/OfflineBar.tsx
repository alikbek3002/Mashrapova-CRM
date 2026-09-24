// Индикатор офлайна и очереди — ТЗ §12.4.
//
// Без него офлайн-режим опаснее его отсутствия: кассир принимает деньги,
// экран отвечает «готово», а куда ушла продажа — непонятно. Полоса
// показывает, что связи нет и сколько операций ждёт отправки, а после
// синхронизации коротко подтверждает, что всё ушло.
import { useEffect, useState } from "react";
import { Icon } from "../../data";
import type { Lang } from "../../data";
import { subscribe, flush, getOps, getRejected, clearRejected, type OutboxOp, type RejectedOp } from "./outbox";

export const OfflineBar = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine);
  const [ops, setOps] = useState<OutboxOp[]>(() => getOps());
  const [rejected, setRejected] = useState<RejectedOp[]>(() => getRejected());
  const [justSynced, setJustSynced] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => subscribe((next) => {
    setOps((prev) => {
      // Очередь опустела после того, как в ней что-то было — значит
      // синхронизация прошла. Показываем это, иначе исчезновение полосы
      // выглядит как потеря данных.
      if (prev.length > 0 && next.length === 0) {
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 4000);
      }
      return next;
    });
    setRejected(getRejected());
  }), []);

  const pending = ops.length;
  const hasRejected = rejected.length > 0;

  if (online && pending === 0 && !justSynced && !hasRejected) return null;

  const tone = !online
    ? { bg: "var(--yellow-100)", fg: "var(--yellow-ink)", border: "oklch(0.92 0.10 90)" }
    : hasRejected
      ? { bg: "var(--red-50, var(--bg-soft))", fg: "var(--red-600)", border: "var(--red-100, var(--line))" }
      : pending > 0
        ? { bg: "var(--blue-50)", fg: "var(--blue-ink)", border: "var(--line)" }
        : { bg: "var(--green-50, var(--bg-soft))", fg: "var(--green-ink, var(--ink))", border: "var(--line)" };

  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90,
        background: tone.bg, color: tone.fg, borderTop: `1px solid ${tone.border}`,
        padding: "8px 14px", fontSize: 13,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}
    >
      <Icon name={online ? "check" : "warn"} size={15} />
      <span style={{ flex: 1, minWidth: 180 }}>
        {!online && pending === 0 && t("Нет связи. Доступны расписание, отметка посещений и продажа за наличные.",
                                        "Байланыш жок. Жадыбал, катышуу жана накталай сатуу иштейт.")}
        {!online && pending > 0 && t(`Нет связи · ${pending} операций ждут отправки`,
                                     `Байланыш жок · ${pending} операция күтүүдө`)}
        {online && pending > 0 && t(`Синхронизация · осталось ${pending}`, `Синхрондоштуруу · ${pending} калды`)}
        {online && pending === 0 && justSynced && !hasRejected
          && t("Всё синхронизировано", "Баары синхрондоштурулду")}
        {online && pending === 0 && hasRejected
          && t(`${rejected.length} операций сервер отклонил — нужно разобраться`,
               `${rejected.length} операцияны сервер четке какты`)}
      </span>

      {online && pending > 0 && (
        <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void flush()}>
          {t("Отправить сейчас", "Азыр жөнөтүү")}
        </button>
      )}

      {(pending > 0 || hasRejected) && (
        <button
          className="btn btn--ghost"
          style={{ padding: "4px 10px", fontSize: 12 }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t("Скрыть", "Жашыруу") : t("Подробнее", "Кеңири")}
        </button>
      )}

      {open && (
        <div style={{ flexBasis: "100%", marginTop: 6, fontSize: 12 }}>
          {ops.map((o) => (
            <div key={o.id} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
              <span style={{ flex: 1 }}>{o.label}</span>
              <span style={{ opacity: 0.7 }}>
                {new Date(o.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                {o.attempts > 0 && ` · ${t("попыток", "аракет")} ${o.attempts}`}
              </span>
            </div>
          ))}
          {rejected.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, padding: "2px 0", color: "var(--red-600)" }}>
              <span style={{ flex: 1 }}>{r.label}</span>
              <span style={{ opacity: 0.8, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.reason}
              </span>
            </div>
          ))}
          {hasRejected && (
            <button
              className="btn btn--ghost"
              style={{ padding: "4px 10px", fontSize: 12, marginTop: 6, color: "var(--red-600)" }}
              onClick={() => {
                if (confirm(t(
                  "Убрать отклонённые операции из списка? Сами операции не выполнятся — разберитесь с ними до очистки.",
                  "Четке кагылган операцияларды тизмеден алабызбы?",
                ))) { clearRejected(); setRejected([]); }
              }}
            >
              {t("Очистить список отклонённых", "Тизмени тазалоо")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
