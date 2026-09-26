import { useMemo, useState } from "react";
import { MIcon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState } from "./common";
import { useNotifications } from "../shared/api/queries";
import { useMarkNotificationsRead } from "../shared/api/mutations";
import {
  eventMeta,
  eventLabel,
  eventHint,
  eventSubject,
  eventDetail,
  isTaskEvent,
} from "./notificationEvents";
import { humanMinutes } from "./leadFunnel";

// =====================================================================
// Инбокс сотрудника — ТЗ §9.1, колонка «Системное (менеджер)».
//
// Чего не хватало: события для офиса писались в таблицу notifications из
// шести мест (refresh_lead_sla, refresh_card_notices, отмена занятия,
// заявка на заморозку), но читало эту таблицу ТОЛЬКО приложение родителя.
// То есть задача «продлить абонемент, осталось 3 дня» создавалась
// исправно и не показывалась никому.
//
// Частично это закрывала страница воронки: она считает просрочку по лидам
// сама, из самих лидов. Но задачи по абонементам (§4.5), риск оттока и
// заявки на заморозку не показывались нигде.
//
// Права здесь не проверяются, и это не упущение: RLS отдаёт строки только
// получателю (notifications_owner_rw: recipient_id = auth.uid()). Каждый
// видит ровно свои задачи — менеджер свои, директор свои.
// =====================================================================

type Tab = "todo" | "all";

export const InboxPage = ({
  lang,
  onNavigate,
}: {
  lang: Lang;
  onNavigate?: (id: string) => void;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const ru = lang === "ru";
  const { data: items = [], isLoading, error } = useNotifications(200);
  const markRead = useMarkNotificationsRead();
  const [tab, setTab] = useState<Tab>("todo");

  const now = Date.now();

  // «Требуют действия» = событие-задача и ещё не закрыто. Прочитанное
  // событие считается закрытым: отдельного статуса «сделано» в таблице
  // нет, а вводить его ради галочки значило бы менять схему под интерфейс.
  const todo = useMemo(
    () => items.filter((n) => isTaskEvent(n.type) && !n.is_read),
    [items],
  );

  const shown = tab === "todo" ? todo : items;

  const subtitle = isLoading
    ? t("Загрузка…", "Жүктөлүүдө…")
    : todo.length > 0
      ? t(`${todo.length} требуют действия`, `${todo.length} аракет талап кылат`)
      : t("Задач нет", "Тапшырма жок");

  return (
    <>
      <PageHeader
        title={t("Задачи", "Тапшырмалар")}
        subtitle={subtitle}
        actions={
          shown.some((n) => !n.is_read) ? (
            <button
              className="btn"
              disabled={markRead.isPending}
              onClick={() =>
                markRead.mutate(shown.filter((n) => !n.is_read).map((n) => n.id))
              }
            >
              <MIcon name="done_all" size={16} />{" "}
              {t("Отметить всё прочитанным", "Баарын окулду деп белгилөө")}
            </button>
          ) : undefined
        }
      />

      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            <button
              className={`tabs__btn ${tab === "todo" ? "is-active" : ""}`}
              onClick={() => setTab("todo")}
            >
              {t("Требуют действия", "Аракет талап кылат")}
              {todo.length > 0 ? ` · ${todo.length}` : ""}
            </button>
            <button
              className={`tabs__btn ${tab === "all" ? "is-active" : ""}`}
              onClick={() => setTab("all")}
            >
              {t("Все события", "Бардык окуялар")}
              {items.length > 0 ? ` · ${items.length}` : ""}
            </button>
          </div>
        </div>

        {error ? (
          <EmptyState title={t("Ошибка", "Ката")} hint={error.message} />
        ) : isLoading ? (
          <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
        ) : shown.length === 0 ? (
          <EmptyState
            title={
              tab === "todo"
                ? t("Задач нет", "Тапшырма жок")
                : t("Событий пока нет", "Окуялар жок")
            }
            hint={
              tab === "todo"
                ? t(
                    "Просроченные лиды, продления и заявки на заморозку появятся здесь.",
                    "Кечиктирилген лиддер, узартуулар жана тындыруу арыздары бул жерде чыгат.",
                  )
                : undefined
            }
          />
        ) : (
          <div style={{ padding: 12 }}>
            {shown.map((n) => {
              const meta = eventMeta(n.type);
              const payload = (n.payload ?? {}) as Record<string, unknown>;
              const detail = eventDetail(n.type, payload, lang);
              const hint = eventHint(n.type, lang);
              const ageMin = (now - new Date(n.created_at).getTime()) / 60000;
              const isTask = meta.task === true && !n.is_read;

              return (
                <div
                  key={n.id}
                  className="call-row"
                  style={{
                    opacity: n.is_read ? 0.6 : 1,
                    background: isTask ? "var(--surface)" : undefined,
                  }}
                >
                  <div
                    className="call-row__avatar"
                    style={{
                      display: "grid",
                      placeItems: "center",
                      background: isTask ? "var(--red-50, var(--bg-soft))" : "var(--bg-soft)",
                      color: isTask ? "var(--red-600)" : "var(--muted)",
                    }}
                  >
                    <MIcon name={meta.icon} size={18} />
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div className="call-row__name">
                      {eventLabel(n.type, lang)}
                      {" · "}
                      <span style={{ color: "var(--ink-2)" }}>{eventSubject(payload)}</span>
                    </div>
                    <div className="call-row__meta">
                      {detail ? <span>{detail}</span> : null}
                      {detail ? " · " : ""}
                      <span>{humanMinutes(ageMin, ru)} {t("назад", "мурун")}</span>
                    </div>
                    {isTask && hint ? (
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{hint}</div>
                    ) : null}
                  </div>

                  <div className="call-row__actions">
                    {meta.goTo && onNavigate ? (
                      <button
                        className="btn btn--ghost"
                        style={{ padding: "6px 10px", fontSize: 12 }}
                        onClick={() => onNavigate(meta.goTo!)}
                      >
                        {t("Открыть", "Ачуу")}
                      </button>
                    ) : null}
                    {!n.is_read ? (
                      <button
                        className="btn"
                        style={{ padding: "6px 10px", fontSize: 12 }}
                        disabled={markRead.isPending}
                        onClick={() => markRead.mutate([n.id])}
                      >
                        <MIcon name="check" size={14} /> {t("Готово", "Бүттү")}
                      </button>
                    ) : (
                      <span className="pill pill--archived">{t("Закрыто", "Жабылды")}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};
