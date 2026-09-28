import { useMemo, useState } from "react";
import { MIcon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState } from "./common";
import {
  useNotificationMatrix,
  useMessageTemplates,
  useOutboundMessages,
  useSections,
  useCoaches,
  type NotificationMatrixRow,
  type MessageTemplateRow,
} from "../shared/api/queries";
import {
  useSetNotificationChannel,
  useSaveMessageTemplate,
  useBroadcast,
  useDispatchOutbound,
} from "../shared/api/mutations";
import { usePerm } from "../shared/auth/rbac";
import { EVENTS, eventLabel, eventMeta } from "./notificationEvents";
import { Select } from "../shared/ui/Select";
import { DateInput } from "../shared/ui/DateInput";
import { SkeletonRows } from "../shared/ui/Skeleton";

// =====================================================================
// Модуль «Уведомления» — ТЗ §9.
//
// Транспортный слой был построен миграцией 20260926000012, но интерфейса
// к нему не существовало: матрица каналов §9.1 и шаблоны сообщений
// правились только SQL-запросом, а массовая рассылка §9.2 имела рабочий
// эндпоинт, до которого невозможно было добраться из админки.
//
// Права повторяют RLS, а не придумывают свои:
//   • матрицу пишет директор           (notification_matrix_director_write)
//   • шаблоны — от старшего менеджера  (message_templates_manage_write)
//   • очередь читают те же роли        (outbound_staff_read)
//   • рассылку §9.2 бэкенд пускает от старшего менеджера
// Поэтому страница целиком закрыта правом view_finance_reports, а вкладка
// матрицы внутри доступна на запись только директору — остальным видна
// только для чтения. Иначе кнопка сохраняла бы вид работающей, а база
// отвечала бы отказом.
// =====================================================================

type Tab = "broadcast" | "matrix" | "templates" | "queue";

const CHANNELS = ["push", "sms", "inapp"] as const;
type Channel = (typeof CHANNELS)[number];

const channelLabel = (c: Channel, ru: boolean): string => {
  switch (c) {
    case "push":  return ru ? "В приложении" : "Колдонмодо";
    case "sms":   return "SMS";
    case "inapp": return ru ? "В системе" : "Системада";
  }
};

export const NotificationsPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [tab, setTab] = useState<Tab>("broadcast");
  const allowed = usePerm("view_finance_reports");

  if (!allowed) {
    return (
      <>
        <PageHeader title={t("Уведомления", "Эскертүүлөр")} />
        <div className="card">
          <EmptyState
            title={t("Нет доступа", "Жеткиликтүү эмес")}
            hint={t(
              "Раздел доступен старшему менеджеру и выше (ТЗ §9.2).",
              "Бөлүм улук менеджерден жогору (ТЗ §9.2).",
            )}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("Уведомления", "Эскертүүлөр")}
        subtitle={t(
          "Рассылка, каналы событий, тексты сообщений и очередь отправок",
          "Жөнөтүү, окуя каналдары, билдирүү тексттери жана кезек",
        )}
      />

      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            <button className={`tabs__btn ${tab === "broadcast" ? "is-active" : ""}`} onClick={() => setTab("broadcast")}>
              {t("Рассылка", "Жөнөтүү")}
            </button>
            <button className={`tabs__btn ${tab === "matrix" ? "is-active" : ""}`} onClick={() => setTab("matrix")}>
              {t("Каналы событий", "Окуя каналдары")}
            </button>
            <button className={`tabs__btn ${tab === "templates" ? "is-active" : ""}`} onClick={() => setTab("templates")}>
              {t("Шаблоны", "Калыптар")}
            </button>
            <button className={`tabs__btn ${tab === "queue" ? "is-active" : ""}`} onClick={() => setTab("queue")}>
              {t("Очередь отправок", "Жөнөтүү кезеги")}
            </button>
          </div>
        </div>

        <div style={{ padding: 16 }}>
          {tab === "broadcast" && <BroadcastTab lang={lang} />}
          {tab === "matrix" && <MatrixTab lang={lang} />}
          {tab === "templates" && <TemplatesTab lang={lang} />}
          {tab === "queue" && <QueueTab lang={lang} />}
        </div>
      </div>
    </>
  );
};

// =====================================================================
// Рассылка — ТЗ §9.2
//
// «Массовая рассылка по фильтрам: секция, тренер, статус абонемента,
//  дата окончания.» Фильтры здесь ровно те, что перечислены в ТЗ, и ровно
// те, что принимает бэкенд — придумывать свои значило бы отправить
// запрос, который сервер молча проигнорирует.
// =====================================================================
const BroadcastTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: sections = [] } = useSections();
  const { data: coaches = [] } = useCoaches();
  const broadcast = useBroadcast();

  const [text, setText] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [coachId, setCoachId] = useState("");
  const [cardStatus, setCardStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Сколько получателей под фильтром. null — ещё не считали: показывать
  // «0» до проверки нельзя, это разные состояния.
  const [preview, setPreview] = useState<number | null>(null);

  const filters = () => ({
    section_id: sectionId || null,
    coach_id: coachId || null,
    card_status: (cardStatus || null) as never,
    end_date_from: from || null,
    end_date_to: to || null,
  });

  const check = async () => {
    const res = await broadcast.mutateAsync({ text: text || "—", ...filters(), dry_run: true });
    setPreview(res.recipients);
  };

  const send = async () => {
    const n = preview;
    const ok = window.confirm(
      n === null
        ? t("Отправить рассылку?", "Жөнөтүүнү баштайсызбы?")
        : t(`Отправить сообщение ${n} получателям?`, `${n} алуучуга билдирүү жөнөтүлсүнбү?`),
    );
    if (!ok) return;
    await broadcast.mutateAsync({ text, ...filters(), dry_run: false });
    setText("");
    setPreview(null);
  };

  const tooLong = text.length > 480;

  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 320px)" }}>
      <div>
        <label className="field">
          <span className="field__label">{t("Текст сообщения", "Билдирүүнүн тексти")}</span>
          <textarea
            rows={5}
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); }}
            placeholder={t(
              "Например: Академия Машрапова: набор в группу бокса, первое занятие бесплатно.",
              "Мисалы: Машрапов Академиясы: бокс группасына кабыл алуу.",
            )}
          />
          <span className="field__hint">
            {t(
              "Подстановка {child_name} заменяется именем ребёнка. Один телефон получит одно сообщение, даже если в семье несколько детей.",
              "{child_name} баланын аты менен алмашат. Бир телефон бир билдирүү алат.",
            )}
          </span>
          {tooLong && (
            <span className="field__error">
              {t(`Слишком длинно: ${text.length} из 480 знаков`, `Өтө узун: 480дөн ${text.length}`)}
            </span>
          )}
        </label>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button className="btn" onClick={check} disabled={broadcast.isPending}>
            <MIcon name="groups" size={16} /> {t("Сколько получателей", "Канча алуучу")}
          </button>
          <button
            className="btn btn--primary"
            onClick={send}
            disabled={broadcast.isPending || text.trim() === "" || tooLong || preview === 0}
          >
            <MIcon name="send" size={16} /> {t("Отправить", "Жөнөтүү")}
          </button>
          {preview !== null && (
            <span className={preview > 0 ? "pill pill--active" : "pill pill--expired"}>
              {preview > 0
                ? t(`${preview} получателей`, `${preview} алуучу`)
                : t("Никто не подходит под фильтр", "Фильтрге эч ким туура келбейт")}
            </span>
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          {t(
            "Сообщения ставятся в ту же очередь, что и автоматические. Пока SMS-провайдер не подключён (ТЗ §13), они получают статус «пропущено» с причиной — видно, сколько ушло бы.",
            "Билдирүүлөр автоматтык менен бир кезекке турат. SMS провайдер жок болгондо (ТЗ §13) «өткөрүлдү» статусу коюлат.",
          )}
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
          {t("Кому — фильтры §9.2", "Кимге — фильтрлер §9.2")}
        </div>

        <label className="field">
          <span className="field__label">{t("Дисциплина", "Дисциплина")}</span>
          <Select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setPreview(null); }}>
            <option value="">{t("Любая", "Баары")}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{lang === "ru" ? s.name_ru : s.name_ky}</option>
            ))}
          </Select>
        </label>

        <label className="field">
          <span className="field__label">{t("Тренер", "Машыктыруучу")}</span>
          <Select value={coachId} onChange={(e) => { setCoachId(e.target.value); setPreview(null); }}>
            <option value="">{t("Любой", "Баары")}</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
          </Select>
        </label>

        <label className="field">
          <span className="field__label">{t("Статус абонемента", "Абонемент абалы")}</span>
          <Select value={cardStatus} onChange={(e) => { setCardStatus(e.target.value); setPreview(null); }}>
            <option value="">{t("Действующие (активный, истекает, заморожен)", "Колдонулуучу")}</option>
            <option value="active">{t("Активный", "Активдүү")}</option>
            <option value="ending">{t("Истекает", "Бүтүп жатат")}</option>
            <option value="frozen">{t("Заморожен", "Тындырылган")}</option>
            <option value="expired">{t("Истёк", "Бүттү")}</option>
            <option value="debt">{t("Долг", "Карыз")}</option>
          </Select>
        </label>

        <label className="field">
          <span className="field__label">{t("Срок заканчивается с", "Мөөнөтү бүтөт")}</span>
          <DateInput value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} />
        </label>
        <label className="field">
          <span className="field__label">{t("по", "чейин")}</span>
          <DateInput value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} />
        </label>
      </div>
    </div>
  );
};

// =====================================================================
// Матрица каналов — ТЗ §9.1
//
// Таблица из ТЗ один в один: событие × канал. Строки матрицы в базе есть
// не для всех событий (её засеяли ровно по §9.1), поэтому чекбокс без
// строки означает «выключено», а не «сломано» — upsert создаст строку при
// первом включении.
// =====================================================================
const MatrixTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: rows = [], isLoading, error } = useNotificationMatrix();
  const setChannel = useSetNotificationChannel();
  const canWrite = usePerm("system_settings");

  const byKey = useMemo(() => {
    const m = new Map<string, NotificationMatrixRow>();
    for (const r of rows) m.set(`${r.event_type}/${r.channel}`, r);
    return m;
  }, [rows]);

  // Порядок как в справочнике: сначала клиентские события, потом
  // служебные — в ТЗ §9.1 таблица разделена так же.
  const eventTypes = useMemo(() => {
    const known = Object.keys(EVENTS);
    const extra = rows.map((r) => r.event_type).filter((e) => !known.includes(e));
    return [...known, ...Array.from(new Set(extra))].sort((a, b) => {
      const aa = eventMeta(a).audience === "staff" ? 1 : 0;
      const bb = eventMeta(b).audience === "staff" ? 1 : 0;
      return aa - bb;
    });
  }, [rows]);

  if (error) return <EmptyState title={t("Ошибка", "Ката")} hint={error.message} />;
  if (isLoading) return <SkeletonRows />;

  return (
    <>
      {!canWrite && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {t(
            "Только просмотр: каналы меняет директор (ТЗ §2.2, «Настройки системы»).",
            "Көрүү гана: каналдарды директор өзгөртөт (ТЗ §2.2).",
          )}
        </div>
      )}

      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Событие", "Окуя")}</th>
              <th>{t("Кому", "Кимге")}</th>
              {CHANNELS.map((c) => (
                <th key={c} style={{ textAlign: "center" }}>{channelLabel(c, lang === "ru")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eventTypes.map((type) => {
              const meta = eventMeta(type);
              return (
                <tr key={type}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <MIcon name={meta.icon} size={18} style={{ color: "var(--muted)" }} />
                      <div>
                        <div className="cell-main">{eventLabel(type, lang)}</div>
                        <div className="cell-sub" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{type}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={meta.audience === "staff" ? "pill pill--frozen" : "pill pill--active"}>
                      {meta.audience === "staff" ? t("Сотруднику", "Кызматкерге") : t("Клиенту", "Кардарга")}
                    </span>
                  </td>
                  {CHANNELS.map((channel) => {
                    const row = byKey.get(`${type}/${channel}`);
                    return (
                      <td key={channel} style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={row?.enabled ?? false}
                          disabled={!canWrite || setChannel.isPending}
                          onChange={(e) =>
                            setChannel.mutate({
                              event_type: type,
                              channel,
                              audience: row?.audience ?? meta.audience,
                              enabled: e.target.checked,
                            })
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
        {t(
          "«В приложении» — событие видно родителю в его приложении. Системного уведомления при закрытом приложении пока нет. «SMS» уходит наружу через провайдера. «В системе» — задача сотруднику в разделе «Задачи».",
          "«Колдонмодо» — ата-энеге колдонмодо көрүнөт. «SMS» провайдер аркылуу кетет. «Системада» — кызматкерге тапшырма.",
        )}
      </div>
    </>
  );
};

// =====================================================================
// Шаблоны сообщений
//
// По ТЗ §9 тексты правит Академия «без деплоя». Правка тут же, в строке:
// отдельная форма на 16 шаблонов означала бы 16 переходов туда-обратно.
// =====================================================================
const TemplatesTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: rows = [], isLoading, error } = useMessageTemplates();
  const save = useSaveMessageTemplate();
  const [draft, setDraft] = useState<Record<string, { ru: string; ky: string }>>({});

  const key = (r: MessageTemplateRow) => `${r.event_type}/${r.channel}`;
  const valueOf = (r: MessageTemplateRow) =>
    draft[key(r)] ?? { ru: r.body_ru, ky: r.body_ky ?? "" };
  const dirty = (r: MessageTemplateRow) => {
    const d = draft[key(r)];
    return !!d && (d.ru !== r.body_ru || d.ky !== (r.body_ky ?? ""));
  };

  if (error) return <EmptyState title={t("Ошибка", "Ката")} hint={error.message} />;
  if (isLoading) return <SkeletonRows />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title={t("Шаблонов нет", "Калыптар жок")}
        hint={t(
          "Шаблоны заводит миграция при создании организации. Если список пуст — организация создана раньше, чем появился триггер.",
          "Калыптарды миграция түзөт.",
        )}
      />
    );
  }

  return (
    <>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        {t(
          "Подстановки в фигурных скобках заменяются на данные события: {child_name}, {end_date}, {trial_at}, {date}, {reason}. Кыргызский текст необязателен — если пусто, уйдёт русский.",
          "Кашаадагы орундар окуянын маалыматы менен алмашат: {child_name}, {end_date}, {trial_at}. Кыргызча текст милдеттүү эмес.",
        )}
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {rows.map((r) => {
          const v = valueOf(r);
          const isDirty = dirty(r);
          return (
            <div key={key(r)} style={{ border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <MIcon name={eventMeta(r.event_type).icon} size={18} style={{ color: "var(--muted)" }} />
                <div style={{ fontWeight: 600, fontSize: 13 }}>{eventLabel(r.event_type, lang)}</div>
                <span className="pill pill--archived">{channelLabel(r.channel, lang === "ru")}</span>
                <div style={{ flex: 1 }} />
                <button
                  className="btn btn--primary"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  disabled={!isDirty || save.isPending || v.ru.trim() === ""}
                  onClick={() =>
                    save.mutate({
                      event_type: r.event_type,
                      channel: r.channel,
                      body_ru: v.ru,
                      body_ky: v.ky || null,
                    })
                  }
                >
                  {t("Сохранить", "Сактоо")}
                </button>
              </div>

              <label className="field">
                <span className="field__label">{t("Русский", "Орусча")}</span>
                <textarea
                  rows={2}
                  value={v.ru}
                  onChange={(e) => setDraft((d) => ({ ...d, [key(r)]: { ...v, ru: e.target.value } }))}
                />
              </label>
              <label className="field">
                <span className="field__label">{t("Кыргызский", "Кыргызча")}</span>
                <textarea
                  rows={2}
                  value={v.ky}
                  onChange={(e) => setDraft((d) => ({ ...d, [key(r)]: { ...v, ky: e.target.value } }))}
                  placeholder={t("Необязательно", "Милдеттүү эмес")}
                />
              </label>
            </div>
          );
        })}
      </div>
    </>
  );
};

// =====================================================================
// Очередь отправок
//
// Статус skipped при выключенном провайдере — норма, а не сбой, поэтому
// он показан отдельным нейтральным цветом, а причина видна в строке.
// Иначе половина очереди выглядела бы как ошибка (именно так и было,
// пока push тоже ставился в очередь — см. миграцию 20260926000014).
// =====================================================================
const statusPill: Record<string, { ru: string; ky: string; cls: string }> = {
  queued:  { ru: "В очереди", ky: "Кезекте",     cls: "pill pill--frozen" },
  sent:    { ru: "Отправлено", ky: "Жөнөтүлдү",  cls: "pill pill--active" },
  failed:  { ru: "Ошибка",    ky: "Ката",        cls: "pill pill--expired" },
  skipped: { ru: "Пропущено", ky: "Өткөрүлдү",   cls: "pill pill--archived" },
};

const QueueTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: rows = [], isLoading, error } = useOutboundMessages(200);
  const dispatch = useDispatchOutbound();
  const [status, setStatus] = useState<string>("");

  const shown = status ? rows.filter((r) => r.status === status) : rows;
  const counts = useMemo(() => {
    const c: Record<string, number> = { queued: 0, sent: 0, failed: 0, skipped: 0 };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  if (error) return <EmptyState title={t("Ошибка", "Ката")} hint={error.message} />;
  if (isLoading) return <SkeletonRows />;

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">{t("Все статусы", "Бардык статустар")}</option>
          {Object.keys(statusPill).map((s) => (
            <option key={s} value={s}>
              {statusPill[s]![lang === "ru" ? "ru" : "ky"]} · {counts[s] ?? 0}
            </option>
          ))}
        </Select>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => dispatch.mutate()} disabled={dispatch.isPending}>
          <MIcon name="outbox" size={16} /> {t("Разобрать очередь", "Кезекти иштетүү")}
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={t("Очередь пуста", "Кезек бош")}
          hint={t(
            "Сообщения появятся здесь, когда сработает событие из матрицы или будет отправлена рассылка.",
            "Билдирүүлөр окуя болгондо же жөнөтүү болгондо чыгат.",
          )}
        />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Создано", "Түзүлдү")}</th>
                <th>{t("Событие", "Окуя")}</th>
                <th>{t("Канал", "Канал")}</th>
                <th>{t("Кому", "Кимге")}</th>
                <th>{t("Текст", "Текст")}</th>
                <th>{t("Статус", "Абалы")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const badge = statusPill[r.status] ?? statusPill.queued!;
                return (
                  <tr key={r.id}>
                    <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {new Date(r.created_at).toLocaleString(lang === "ru" ? "ru-RU" : "ky-KG", {
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td>
                      <div className="cell-main">{eventLabel(r.event_type, lang)}</div>
                      {r.attempts > 0 && (
                        <div className="cell-sub">{t(`попыток: ${r.attempts}`, `аракет: ${r.attempts}`)}</div>
                      )}
                    </td>
                    <td>{r.channel === "sms" ? "SMS" : channelLabel("push", lang === "ru")}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.to_phone ?? "—"}</td>
                    <td style={{ fontSize: 12, maxWidth: 380 }}>{r.body}</td>
                    <td>
                      <span className={badge.cls}>{badge[lang === "ru" ? "ru" : "ky"]}</span>
                      {r.last_error && (
                        <div className="cell-sub" style={{ maxWidth: 260 }}>{r.last_error}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
