// Админ-модуль «Персональные тренировки» (ПТ для ERP.docx).
// Вкладки: Услуги (§2) · Пакеты (§3, §8, §21) · Записи (§4–6, §9, §10, §15)
// · Журнал (§14) · Замены (§20) · Отчёты (§13).
import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState, formatCurrency } from "./common";
import { Modal, Field } from "../shared/ui/Modal";
import { useChildren, useCoaches, useSections } from "../shared/api/queries";
import {
  usePtServices,
  usePtPackages,
  usePtSessions,
  usePtSubstitutions,
  usePtPayroll,
  usePtSummary,
  usePtCreateService,
  usePtUpdateService,
  usePtDeleteService,
  usePtSetCoachRates,
  usePtSellPackages,
  usePtPayPackage,
  usePtActivatePackage,
  usePtBlockPackage,
  usePtUnblockPackage,
  usePtExtendPackage,
  usePtAnnulPackage,
  usePtChangeCoach,
  usePtRefundPackage,
  usePtBookSession,
  usePtUpdateSession,
  usePtCompleteSession,
  usePtCancelSession,
  usePtRescheduleSession,
  usePtSubstitute,
  usePtSetLessonStatus,
  type PtServiceWithRates,
  type PtPackageFull,
  type PtSessionFull,
} from "../shared/api/pt";
import { usePerm } from "../shared/auth/rbac";
import type { PtPackageStatus, PtSessionStatus, PtVisitStatus } from "../shared/types/database";

// ============================================================
// Словари статусов
// ============================================================
const PKG_STATUS: Record<PtPackageStatus, { ru: string; ky: string; cls: string }> = {
  purchased: { ru: "Куплен (долг)", ky: "Сатылды (карыз)", cls: "debt" },
  awaiting_activation: { ru: "Ожидает активации", ky: "Активацияны күтөт", cls: "pending" },
  active: { ru: "Действующий", ky: "Активдүү", cls: "active" },
  completed: { ru: "Завершен", ky: "Аяктады", cls: "expired" },
  expired: { ru: "Истек срок", ky: "Мөөнөтү бүттү", cls: "expired" },
  blocked: { ru: "Заблокирован", ky: "Бөгөттөлгөн", cls: "frozen" },
  refunded: { ru: "Возвращен", ky: "Кайтарылды", cls: "archived" },
  annulled: { ru: "Аннулирован", ky: "Жокко чыгарылды", cls: "archived" },
};

const SES_STATUS: Record<PtSessionStatus, { ru: string; ky: string; cls: string }> = {
  scheduled: { ru: "Запланирована", ky: "Пландалган", cls: "pending" },
  completed: { ru: "Проведена", ky: "Өткөрүлдү", cls: "active" },
  cancelled: { ru: "Отменена", ky: "Жокко чыгарылды", cls: "expired" },
  rescheduled: { ru: "Перенесена", ky: "Которулду", cls: "frozen" },
};

// §14: символы журнала
const VISIT_SYMBOL = (status: PtVisitStatus, charged: boolean): { sym: string; title: string; color: string } => {
  if (status === "attended") return { sym: "✓", title: "Присутствовал", color: "var(--green-600, #15803d)" };
  if (status === "missed" && charged) return { sym: "С", title: "Списано (неявка)", color: "var(--red-600)" };
  if (status === "missed") return { sym: "Н", title: "Неявка", color: "var(--red-600)" };
  if (status === "cancelled") return { sym: "О", title: "Отмена", color: "var(--muted)" };
  if (status === "rescheduled") return { sym: "П", title: "Перенос", color: "var(--blue)" };
  return { sym: "•", title: "Запланирована", color: "var(--muted)" };
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const monthEnd = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
};
const fmtDate = (iso: string, lang: Lang) =>
  new Date(iso + "T00:00:00").toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", {
    day: "numeric",
    month: "short",
  });

type TabId = "services" | "packages" | "sessions" | "journal" | "subs" | "reports";

export const PersonalTrainingsPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [tab, setTab] = useState<TabId>("sessions");
  const canManage = usePerm("manage_pt");
  const canSell = usePerm("sell_pt");

  const tabs: { id: TabId; label: string }[] = [
    { id: "sessions", label: t("Записи", "Жазуулар") },
    { id: "packages", label: t("Пакеты", "Пакеттер") },
    { id: "services", label: t("Услуги", "Кызматтар") },
    { id: "journal", label: t("Журнал", "Журнал") },
    { id: "subs", label: t("Замены", "Алмаштыруулар") },
    { id: "reports", label: t("Отчёты", "Отчёттор") },
  ];

  return (
    <>
      <PageHeader
        title={t("Персональные тренировки", "Жеке машыгуулар")}
        subtitle={t("Услуги, пакеты, записи, журнал, замены и отчёты", "Кызматтар, пакеттер, жазуулар, журнал жана отчёттор")}
      />
      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            {tabs.map((tt) => (
              <button key={tt.id} className={`tabs__btn ${tab === tt.id ? "is-active" : ""}`} onClick={() => setTab(tt.id)}>
                {tt.label}
              </button>
            ))}
          </div>
        </div>
        {tab === "services" && <ServicesTab lang={lang} canManage={canManage} />}
        {tab === "packages" && <PackagesTab lang={lang} canSell={canSell} canManage={canManage} />}
        {tab === "sessions" && <SessionsTab lang={lang} canManage={canManage || canSell} />}
        {tab === "journal" && <JournalTab lang={lang} />}
        {tab === "subs" && <SubsTab lang={lang} />}
        {tab === "reports" && <ReportsTab lang={lang} />}
      </div>
    </>
  );
};

// ============================================================
// Период (фильтры §13: день / неделя / месяц / произвольный)
// ============================================================
const PeriodPicker = ({
  from,
  to,
  setFrom,
  setTo,
  lang,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  lang: Lang;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const setRange = (kind: "day" | "week" | "month") => {
    const now = new Date();
    if (kind === "day") {
      setFrom(todayIso());
      setTo(todayIso());
    } else if (kind === "week") {
      const dow = (now.getDay() + 6) % 7;
      const start = new Date(now);
      start.setDate(now.getDate() - dow);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      setFrom(start.toISOString().slice(0, 10));
      setTo(end.toISOString().slice(0, 10));
    } else {
      setFrom(monthStart());
      setTo(monthEnd());
    }
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setRange("day")}>
        {t("День", "Күн")}
      </button>
      <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setRange("week")}>
        {t("Неделя", "Жума")}
      </button>
      <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setRange("month")}>
        {t("Месяц", "Ай")}
      </button>
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <span style={{ color: "var(--muted)" }}>—</span>
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
};

// ============================================================
// УСЛУГИ (§2)
// ============================================================
const ServicesTab = ({ lang, canManage }: { lang: Lang; canManage: boolean }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: services = [], isLoading } = usePtServices(true);
  const [editing, setEditing] = useState<PtServiceWithRates | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const del = usePtDeleteService();

  return (
    <>
      {canManage && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn--primary" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={14} /> {t("Новая услуга", "Жаңы кызмат")}
          </button>
        </div>
      )}
      {isLoading ? (
        <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
      ) : services.length === 0 ? (
        <EmptyState
          title={t("Услуг пока нет", "Кызматтар жок")}
          // Менеджер/кассир видят каталог, но не правят его (§19: номенклатура —
          // директор, фитнес-директор, ст. менеджер). Раньше им предлагали
          // «создайте», хотя кнопки у них нет — тупик.
          hint={canManage
            ? t("Создайте первую услугу: персональная тренировка или мини-группа", "Биринчи кызматты түзүңүз")
            : t("Услуги ПТ создаёт директор, фитнес-директор или старший менеджер — попросите их добавить каталог", "ЖМ кызматтарын директор же улук менеджер түзөт")}
        />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Название", "Аталышы")}</th>
                <th>{t("Тип", "Түрү")}</th>
                <th className="num">{t("Цена", "Баасы")}</th>
                <th className="num">{t("Тренировок", "Машыгуу")}</th>
                <th className="num">{t("Срок, дн.", "Мөөнөт, күн")}</th>
                <th className="num">{t("Длит., мин", "Узакт., мүн")}</th>
                <th className="num">%</th>
                <th>{t("Статус", "Абалы")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="cell-main">{s.name}</div>
                    {s.coach_category && <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.coach_category}</div>}
                  </td>
                  <td>
                    {s.type === "personal"
                      ? t("Персональная", "Жеке")
                      : `${t("Мини-группа", "Мини-топ")} ×${s.capacity}`}
                  </td>
                  <td className="num">{formatCurrency(Number(s.price))}</td>
                  <td className="num">{s.lessons_count}</td>
                  <td className="num">{s.validity_days}</td>
                  <td className="num">{s.duration_min}</td>
                  <td className="num">{s.coach_percent_default}%</td>
                  <td>
                    <span className={`pill pill--${s.is_active ? "active" : "archived"}`}>
                      {s.is_active ? t("Активна", "Активдүү") : t("Отключена", "Өчүрүлгөн")}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {canManage && (
                      <>
                        <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setEditing(s)}>
                          {t("Изменить", "Өзгөртүү")}
                        </button>{" "}
                        <button
                          className="btn btn--ghost"
                          style={{ padding: "5px 10px", fontSize: 12, color: "var(--red-600)" }}
                          onClick={() => {
                            if (confirm(t("Удалить услугу?", "Кызматты өчүрөсүзбү?"))) del.mutate(s.id);
                          }}
                        >
                          {t("Удалить", "Өчүрүү")}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(createOpen || editing) && (
        <ServiceModal
          open
          onClose={() => {
            setCreateOpen(false);
            setEditing(null);
          }}
          lang={lang}
          service={editing}
        />
      )}
    </>
  );
};

const ServiceModal = ({
  open,
  onClose,
  lang,
  service,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  service: PtServiceWithRates | null;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: sections = [] } = useSections();
  const { data: coaches = [] } = useCoaches();
  const create = usePtCreateService();
  const update = usePtUpdateService();
  const setRates = usePtSetCoachRates();

  const [name, setName] = useState(service?.name ?? "");
  const [sectionId, setSectionId] = useState(service?.section_id ?? "");
  const [type, setType] = useState<"personal" | "mini_group">(service?.type ?? "personal");
  const [capacity, setCapacity] = useState(service?.capacity ?? 2);
  const [price, setPrice] = useState(service ? Number(service.price) : 0);
  const [durationMin, setDurationMin] = useState(service?.duration_min ?? 60);
  const [lessonsCount, setLessonsCount] = useState(service?.lessons_count ?? 10);
  const [validityDays, setValidityDays] = useState(service?.validity_days ?? 30);
  const [activationDays, setActivationDays] = useState(service?.activation_deadline_days ?? 30);
  const [reschedH, setReschedH] = useState(service?.reschedule_limit_hours ?? 24);
  const [cancelH, setCancelH] = useState(service?.cancel_limit_hours ?? 24);
  const [editH, setEditH] = useState(service?.coach_edit_limit_hours ?? 2);
  const [markH, setMarkH] = useState(service?.mark_deadline_hours ?? 24);
  const [freezeAllowed, setFreezeAllowed] = useState(service?.freeze_allowed ?? false);
  const [refundable, setRefundable] = useState(service?.refundable ?? true);
  const [blockable, setBlockable] = useState(service?.blockable ?? true);
  const [coachCategory, setCoachCategory] = useState(service?.coach_category ?? "");
  const [pctDefault, setPctDefault] = useState(service?.coach_percent_default ?? 50);
  const [comment, setComment] = useState(service?.comment ?? "");
  const [isActive, setIsActive] = useState(service?.is_active ?? true);
  const [rates, setRatesState] = useState<{ coach_id: string; price: string; percent: string }[]>(
    (service?.rates ?? []).map((r) => ({
      coach_id: r.coach_id,
      price: r.price != null ? String(r.price) : "",
      percent: r.percent != null ? String(r.percent) : "",
    }))
  );
  const [err, setErr] = useState<string | null>(null);

  const busy = create.isPending || update.isPending || setRates.isPending;

  const submit = async () => {
    setErr(null);
    if (name.trim().length < 2) {
      setErr(t("Укажите название услуги", "Кызматтын атын жазыңыз"));
      return;
    }
    const body = {
      name: name.trim(),
      section_id: sectionId || null,
      type,
      capacity: type === "mini_group" ? capacity : 1,
      price,
      duration_min: durationMin,
      lessons_count: lessonsCount,
      validity_days: validityDays,
      activation_deadline_days: activationDays,
      reschedule_limit_hours: reschedH,
      cancel_limit_hours: cancelH,
      coach_edit_limit_hours: editH,
      mark_deadline_hours: markH,
      freeze_allowed: freezeAllowed,
      refundable,
      blockable,
      coach_category: coachCategory.trim() || null,
      coach_percent_default: pctDefault,
      comment: comment.trim() || null,
      is_active: isActive,
    };
    try {
      let serviceId = service?.id;
      if (service) {
        await update.mutateAsync({ id: service.id, ...body });
      } else {
        const res = await create.mutateAsync(body);
        serviceId = res.service.id;
      }
      if (serviceId) {
        await setRates.mutateAsync({
          service_id: serviceId,
          rates: rates
            .filter((r) => r.coach_id)
            .map((r) => ({
              coach_id: r.coach_id,
              price: r.price === "" ? null : Number(r.price),
              percent: r.percent === "" ? null : Number(r.percent),
            })),
        });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(Number(e.target.value) || 0);

  return (
    <Modal open={open} onClose={onClose} title={service ? t("Изменить услугу", "Кызматты өзгөртүү") : t("Новая услуга", "Жаңы кызмат")} width={640}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("Название услуги", "Аталышы")}>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </Field>
        <Field label={t("Вид спорта (секция)", "Спорт түрү")}>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={busy}>
            <option value="">{t("— не указан —", "— жок —")}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {lang === "ru" ? s.name_ru : s.name_ky}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Тип услуги", "Кызмат түрү")}>
          <select value={type} onChange={(e) => setType(e.target.value as "personal" | "mini_group")} disabled={busy}>
            <option value="personal">{t("Персональная тренировка", "Жеке машыгуу")}</option>
            <option value="mini_group">{t("Мини-группа", "Мини-топ")}</option>
          </select>
        </Field>
        {type === "mini_group" && (
          <Field label={t("Человек в группе", "Топтогу адам саны")}>
            <input type="number" min={2} max={50} value={capacity} onChange={num(setCapacity)} disabled={busy} />
          </Field>
        )}
        <Field label={t("Стоимость пакета (на участника), сом", "Баасы, сом")}>
          <input type="number" min={0} value={price} onChange={num(setPrice)} disabled={busy} />
        </Field>
        <Field label={t("Тренировок в пакете", "Пакеттеги машыгуулар")}>
          <input type="number" min={1} value={lessonsCount} onChange={num(setLessonsCount)} disabled={busy} />
        </Field>
        <Field label={t("Продолжительность, мин", "Узактыгы, мүн")}>
          <input type="number" min={15} value={durationMin} onChange={num(setDurationMin)} disabled={busy} />
        </Field>
        <Field label={t("Срок действия пакета, дней", "Мөөнөтү, күн")}>
          <input type="number" min={1} value={validityDays} onChange={num(setValidityDays)} disabled={busy} />
        </Field>
        <Field label={t("Срок активации после покупки, дней", "Активация мөөнөтү, күн")}>
          <input type="number" min={1} value={activationDays} onChange={num(setActivationDays)} disabled={busy} />
        </Field>
        <Field label={t("Перенос: минимум часов до начала", "Которуу: саат")}>
          <input type="number" min={0} value={reschedH} onChange={num(setReschedH)} disabled={busy} />
        </Field>
        <Field label={t("Отмена: минимум часов до начала", "Жокко чыгаруу: саат")}>
          <input type="number" min={0} value={cancelH} onChange={num(setCancelH)} disabled={busy} />
        </Field>
        <Field label={t("Тренер меняет запись за, часов", "Тренер өзгөртөт, саат")}>
          <input type="number" min={0} value={editH} onChange={num(setEditH)} disabled={busy} />
        </Field>
        <Field label={t("Окно отметки после тренировки, часов", "Белгилөө терезеси, саат")}>
          <input type="number" min={1} value={markH} onChange={num(setMarkH)} disabled={busy} />
        </Field>
        <Field label={t("Категория тренеров", "Тренер категориясы")}>
          <input value={coachCategory} onChange={(e) => setCoachCategory(e.target.value)} disabled={busy} />
        </Field>
        <Field label={t("Процент тренера по умолчанию, %", "Тренер пайызы, %")}>
          <input type="number" min={0} max={100} value={pctDefault} onChange={num(setPctDefault)} disabled={busy} />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
        <label className="check">
          <input type="checkbox" checked={freezeAllowed} onChange={(e) => setFreezeAllowed(e.target.checked)} disabled={busy} />
          <span><b>{t("Заморозка разрешена", "Тоңдурууга болот")}</b></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={refundable} onChange={(e) => setRefundable(e.target.checked)} disabled={busy} />
          <span><b>{t("Возврат возможен", "Кайтарууга болот")}</b></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={blockable} onChange={(e) => setBlockable(e.target.checked)} disabled={busy} />
          <span><b>{t("Блокировка возможна", "Бөгөттөөгө болот")}</b></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={busy} />
          <span><b>{t("Услуга активна", "Кызмат активдүү")}</b></span>
        </label>
      </div>

      <Field label={t("Комментарий", "Комментарий")}>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} disabled={busy} />
      </Field>

      {/* §2: стоимость и % по каждому тренеру */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
          {t("Ставки по тренерам (цена / % тренера)", "Тренерлер боюнча ставкалар")}
        </div>
        {rates.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <select
              value={r.coach_id}
              onChange={(e) => setRatesState((x) => x.map((y, j) => (j === i ? { ...y, coach_id: e.target.value } : y)))}
              disabled={busy}
              style={{ flex: 2 }}
            >
              <option value="">{t("— тренер —", "— тренер —")}</option>
              {coaches.map((c: { id: string; full_name: string }) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder={t("Цена", "Баасы")}
              value={r.price}
              onChange={(e) => setRatesState((x) => x.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)))}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              placeholder="%"
              value={r.percent}
              onChange={(e) => setRatesState((x) => x.map((y, j) => (j === i ? { ...y, percent: e.target.value } : y)))}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <button className="icon-btn" onClick={() => setRatesState((x) => x.filter((_, j) => j !== i))} disabled={busy}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setRatesState((x) => [...x, { coach_id: "", price: "", percent: "" }])} disabled={busy}>
          <Icon name="plus" size={12} /> {t("Добавить тренера", "Тренер кошуу")}
        </button>
      </div>

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={busy}>
          {t("Отмена", "Жокко чыгаруу")}
        </button>
        <button className="btn btn--primary" onClick={submit} disabled={busy}>
          {busy ? t("Сохраняем…", "Сакталууда…") : t("Сохранить", "Сактоо")}
        </button>
      </div>
    </Modal>
  );
};

// ============================================================
// ПАКЕТЫ (§3, §8, §21)
// ============================================================
const PackagesTab = ({ lang, canSell, canManage }: { lang: Lang; canSell: boolean; canManage: boolean }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PtPackageStatus>("all");
  const [sellOpen, setSellOpen] = useState(false);
  const [actionPkg, setActionPkg] = useState<PtPackageFull | null>(null);
  const { data: packages = [], isLoading, error } = usePtPackages();

  const rows = useMemo(() => {
    let list = packages;
    if (statusFilter !== "all") list = list.filter((p) => p.status === statusFilter);
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter((p) => (p.child?.full_name ?? "").toLowerCase().includes(qq));
    return list;
  }, [packages, statusFilter, q]);

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <SearchBox value={q} onChange={setQ} placeholder={t("Поиск по клиенту…", "Кардар боюнча…")} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | PtPackageStatus)}>
          <option value="all">{t("Все статусы", "Бардык абалдар")}</option>
          {(Object.keys(PKG_STATUS) as PtPackageStatus[]).map((s) => (
            <option key={s} value={s}>
              {PKG_STATUS[s][lang]}
            </option>
          ))}
        </select>
        {canSell && (
          <button className="btn btn--primary" onClick={() => setSellOpen(true)}>
            <Icon name="plus" size={14} /> {t("Продать пакет", "Пакет сатуу")}
          </button>
        )}
      </div>
      {error ? (
        <EmptyState title={t("Ошибка", "Ката")} hint={(error as Error).message} />
      ) : isLoading ? (
        <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("Пакетов нет", "Пакеттер жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Клиент", "Кардар")}</th>
                <th>{t("Услуга", "Кызмат")}</th>
                <th>{t("Тренер", "Тренер")}</th>
                <th className="num">{t("Остаток", "Калдык")}</th>
                <th className="num">{t("Цена", "Баасы")}</th>
                <th className="num">{t("Оплачено", "Төлөндү")}</th>
                <th className="num">{t("Долг", "Карыз")}</th>
                <th>{t("Действует до", "Мөөнөтү")}</th>
                <th>{t("Статус", "Абалы")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const debt = Math.max(0, Number(p.price) - Number(p.paid));
                const st = PKG_STATUS[p.status];
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="cell-main">{p.child?.full_name ?? "—"}</div>
                      {p.group_id && <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("мини-группа", "мини-топ")}</div>}
                    </td>
                    <td>{p.service?.name ?? "—"}</td>
                    <td>{p.coach?.full_name ?? "—"}</td>
                    <td className="num">
                      <b>{p.lessons_total - p.lessons_used}</b> / {p.lessons_total}
                    </td>
                    <td className="num">{formatCurrency(Number(p.price))}</td>
                    <td className="num">{formatCurrency(Number(p.paid))}</td>
                    <td className="num" style={debt > 0 ? { color: "var(--red-600)", fontWeight: 600 } : undefined}>
                      {debt > 0 ? formatCurrency(debt) : "—"}
                    </td>
                    <td>{p.expires_at ?? t("не активирован", "активацияланган эмес")}</td>
                    <td>
                      <span className={`pill pill--${st.cls}`}>{st[lang]}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {(canSell || canManage) && (
                        <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setActionPkg(p)}>
                          {t("Действия", "Аракеттер")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {sellOpen && <SellModal open onClose={() => setSellOpen(false)} lang={lang} />}
      {actionPkg && <PackageActionsModal open pkg={actionPkg} onClose={() => setActionPkg(null)} lang={lang} canManage={canManage} />}
    </>
  );
};

const SellModal = ({ open, onClose, lang }: { open: boolean; onClose: () => void; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: services = [] } = usePtServices();
  const { data: coaches = [] } = useCoaches();
  const { data: kids = [] } = useChildren();
  const sell = usePtSellPackages();

  const [serviceId, setServiceId] = useState("");
  const [coachId, setCoachId] = useState("");
  const [method, setMethod] = useState<"cash" | "terminal">("cash");
  const [groupName, setGroupName] = useState("");
  const [items, setItems] = useState<
    { child_id: string; price: string; pay_cash: string; pay_deposit: string; in_debt: boolean; debt_comment: string }[]
  >([{ child_id: "", price: "", pay_cash: "", pay_deposit: "", in_debt: false, debt_comment: "" }]);
  const [err, setErr] = useState<string | null>(null);

  const svc = services.find((s) => s.id === serviceId) ?? null;
  const isMini = svc?.type === "mini_group";
  const coachRate = svc?.rates.find((r) => r.coach_id === coachId);
  const basePrice = coachRate?.price != null ? Number(coachRate.price) : svc ? Number(svc.price) : 0;

  const setItem = (i: number, patch: Partial<(typeof items)[number]>) =>
    setItems((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)));

  const submit = async () => {
    setErr(null);
    if (!svc || !coachId) {
      setErr(t("Выберите услугу и тренера", "Кызмат жана тренерди тандаңыз"));
      return;
    }
    const filled = items.filter((i) => i.child_id);
    if (filled.length === 0) {
      setErr(t("Выберите клиента", "Кардарды тандаңыз"));
      return;
    }
    for (const it of filled) {
      const price = it.price === "" ? basePrice : Number(it.price);
      const paid = Number(it.pay_cash || 0) + Number(it.pay_deposit || 0);
      if (paid < price && (!it.in_debt || !it.debt_comment.trim())) {
        setErr(t("Оплата не полная: отметьте «в долг» и обязательно укажите комментарий", "Толук эмес төлөм: «карызга» белгилеп, комментарий жазыңыз"));
        return;
      }
    }
    try {
      await sell.mutateAsync({
        service_id: svc.id,
        coach_id: coachId,
        payment_method: method,
        group_name: isMini ? groupName.trim() || null : null,
        items: filled.map((it) => ({
          child_id: it.child_id,
          price: it.price === "" ? basePrice : Number(it.price),
          pay_cash: Number(it.pay_cash || 0),
          pay_deposit: Number(it.pay_deposit || 0),
          in_debt: it.in_debt,
          debt_comment: it.debt_comment.trim() || null,
        })),
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const total = items.filter((i) => i.child_id).reduce((s, i) => s + (i.price === "" ? basePrice : Number(i.price)), 0);

  return (
    <Modal open={open} onClose={onClose} title={t("Продажа пакета ПТ", "ПТ пакетин сатуу")} width={640}>
      {/* Пустой каталог — самая частая причина «не могу продать ПТ»: менеджер
          видит пустой список услуг и не понимает, что делать. */}
      {services.length === 0 && (
        <div style={{
          marginBottom: 10, padding: "8px 12px", fontSize: 12.5,
          background: "var(--yellow-100)", border: "1px solid oklch(0.92 0.10 90)", borderRadius: "var(--r-sm)",
        }}>
          {t(
            "Каталог услуг ПТ пуст — продавать нечего. Услуги создаёт директор, фитнес-директор или старший менеджер: Персональные → Услуги → «Новая услуга».",
            "ЖМ кызматтарынын каталогу бош. Кызматтарды директор же улук менеджер түзөт: Жеке машыгуулар → Кызматтар.",
          )}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("Услуга", "Кызмат")}>
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">{t("— выбрать —", "— тандоо —")}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {formatCurrency(Number(s.price))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Тренер", "Тренер")}>
          <select value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            <option value="">{t("— выбрать —", "— тандоо —")}</option>
            {coaches.map((c: { id: string; full_name: string }) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Способ оплаты", "Төлөм ыкмасы")}>
          <select value={method} onChange={(e) => setMethod(e.target.value as "cash" | "terminal")}>
            <option value="cash">{t("Наличные", "Накталай")}</option>
            <option value="terminal">{t("Терминал", "Терминал")}</option>
          </select>
        </Field>
        {isMini && (
          <Field label={t("Название мини-группы", "Мини-топтун аты")}>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
          </Field>
        )}
      </div>

      <div style={{ marginTop: 10, fontWeight: 600, fontSize: 13 }}>
        {t("Участники", "Катышуучулар")}
        {isMini && svc && ` (${t("до", "чейин")} ${svc.capacity})`}
      </div>
      {items.map((it, i) => (
        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8 }}>
            <select value={it.child_id} onChange={(e) => setItem(i, { child_id: e.target.value })}>
              <option value="">{t("— клиент —", "— кардар —")}</option>
              {kids.map((k: { id: string; full_name: string }) => (
                <option key={k.id} value={k.id}>
                  {k.full_name}
                </option>
              ))}
            </select>
            <input type="number" placeholder={`${t("Цена", "Баасы")} (${basePrice})`} value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} />
            <input type="number" placeholder={t("Оплата", "Төлөм")} value={it.pay_cash} onChange={(e) => setItem(i, { pay_cash: e.target.value })} />
            <input type="number" placeholder={t("С депозита", "Депозиттен")} value={it.pay_deposit} onChange={(e) => setItem(i, { pay_deposit: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
            <label className="check" style={{ whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={it.in_debt} onChange={(e) => setItem(i, { in_debt: e.target.checked })} />
              <span><b>{t("В долг", "Карызга")}</b></span>
            </label>
            {it.in_debt && (
              <input
                style={{ flex: 1 }}
                placeholder={t("Обязательный комментарий к долгу", "Карыз боюнча милдеттүү комментарий")}
                value={it.debt_comment}
                onChange={(e) => setItem(i, { debt_comment: e.target.value })}
              />
            )}
            {items.length > 1 && (
              <button className="icon-btn" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}>
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        </div>
      ))}
      {isMini && svc && items.length < svc.capacity && (
        <button
          className="btn"
          style={{ marginTop: 8, padding: "5px 10px", fontSize: 12 }}
          onClick={() => setItems((x) => [...x, { child_id: "", price: "", pay_cash: "", pay_deposit: "", in_debt: false, debt_comment: "" }])}
        >
          <Icon name="plus" size={12} /> {t("Добавить участника", "Катышуучу кошуу")}
        </button>
      )}

      <div style={{ marginTop: 10, fontSize: 13 }}>
        {t("Общая стоимость:", "Жалпы баасы:")} <b>{formatCurrency(total)}</b>
      </div>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={sell.isPending}>
          {t("Отмена", "Жокко чыгаруу")}
        </button>
        <button className="btn btn--primary" onClick={submit} disabled={sell.isPending}>
          {sell.isPending ? t("Продаём…", "Сатылууда…") : t("Продать", "Сатуу")}
        </button>
      </div>
    </Modal>
  );
};

const PackageActionsModal = ({
  open,
  onClose,
  pkg,
  lang,
  canManage,
}: {
  open: boolean;
  onClose: () => void;
  pkg: PtPackageFull;
  lang: Lang;
  canManage: boolean;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: coaches = [] } = useCoaches();
  const pay = usePtPayPackage();
  const activate = usePtActivatePackage();
  const block = usePtBlockPackage();
  const unblock = usePtUnblockPackage();
  const extend = usePtExtendPackage();
  const annul = usePtAnnulPackage();
  const changeCoach = usePtChangeCoach();
  const refund = usePtRefundPackage();

  const [mode, setMode] = useState<"menu" | "pay" | "block" | "extend" | "annul" | "refund" | "coach">("menu");
  const [amount, setAmount] = useState("");
  const [useDeposit, setUseDeposit] = useState("");
  const [method, setMethod] = useState<"cash" | "terminal">("cash");
  const [reason, setReason] = useState("");
  const [newDate, setNewDate] = useState(pkg.expires_at ?? todayIso());
  const [newCoach, setNewCoach] = useState(pkg.coach_id);
  const [refundKind, setRefundKind] = useState<"partial" | "full">("full");
  const [toDeposit, setToDeposit] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const debt = Math.max(0, Number(pkg.price) - Number(pkg.paid));
  const busy =
    pay.isPending || activate.isPending || block.isPending || unblock.isPending ||
    extend.isPending || annul.isPending || changeCoach.isPending || refund.isPending;

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`${pkg.child?.full_name ?? ""} · ${pkg.service?.name ?? ""}`} width={520}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
        {t("Остаток", "Калдык")}: <b>{pkg.lessons_total - pkg.lessons_used}/{pkg.lessons_total}</b> ·{" "}
        {t("Оплачено", "Төлөндү")}: <b>{formatCurrency(Number(pkg.paid))}</b>
        {debt > 0 && (
          <>
            {" "}· <span style={{ color: "var(--red-600)" }}>{t("Долг", "Карыз")}: <b>{formatCurrency(debt)}</b></span>
          </>
        )}
        {pkg.expires_at && <> · {t("До", "Чейин")}: <b>{pkg.expires_at}</b></>}
        <br />
        {t("Продал(а)", "Саткан")}: {pkg.seller?.full_name ?? "—"} · {t("Тренер", "Тренер")}: {pkg.coach?.full_name ?? "—"}
      </div>

      {mode === "menu" && (
        <div style={{ display: "grid", gap: 8 }}>
          {debt > 0 && (
            <button className="btn btn--primary" onClick={() => setMode("pay")}>{t("Принять оплату", "Төлөм кабыл алуу")}</button>
          )}
          {["purchased", "awaiting_activation"].includes(pkg.status) && canManage && (
            <button className="btn" onClick={() => run(() => activate.mutateAsync({ package_id: pkg.id }))}>
              {t("Активировать вручную", "Кол менен активациялоо")}
            </button>
          )}
          {canManage && pkg.status !== "blocked" && ["purchased", "awaiting_activation", "active"].includes(pkg.status) && (
            <button className="btn" onClick={() => setMode("block")}>{t("Заблокировать", "Бөгөттөө")}</button>
          )}
          {canManage && pkg.status === "blocked" && (
            <button className="btn" onClick={() => run(() => unblock.mutateAsync({ package_id: pkg.id }))}>
              {t("Разблокировать", "Бөгөттү алуу")}
            </button>
          )}
          {canManage && (
            <button className="btn" onClick={() => setMode("extend")}>
              {t("Продлить / сократить срок", "Мөөнөттү өзгөртүү")}
            </button>
          )}
          {canManage && (
            <button className="btn" onClick={() => setMode("coach")}>{t("Сменить тренера", "Тренерди алмаштыруу")}</button>
          )}
          {canManage && (
            <button className="btn" onClick={() => setMode("refund")}>{t("Возврат (частичный / полный)", "Кайтаруу")}</button>
          )}
          {canManage && (
            <button className="btn btn--ghost" style={{ color: "var(--red-600)" }} onClick={() => setMode("annul")}>
              {t("Аннулировать", "Жокко чыгаруу")}
            </button>
          )}
        </div>
      )}

      {mode === "pay" && (
        <>
          <Field label={`${t("Сумма (наличные/терминал)", "Сумма")} · ${t("долг", "карыз")} ${formatCurrency(debt)}`}>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t("Списать с депозита", "Депозиттен алуу")}>
            <input type="number" value={useDeposit} onChange={(e) => setUseDeposit(e.target.value)} />
          </Field>
          <Field label={t("Способ", "Ыкма")}>
            <select value={method} onChange={(e) => setMethod(e.target.value as "cash" | "terminal")}>
              <option value="cash">{t("Наличные", "Накталай")}</option>
              <option value="terminal">{t("Терминал", "Терминал")}</option>
            </select>
          </Field>
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("menu")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                run(() =>
                  pay.mutateAsync({
                    package_id: pkg.id,
                    amount: Number(amount || 0),
                    use_deposit: Number(useDeposit || 0),
                    method,
                  })
                )
              }
            >
              {t("Принять", "Кабыл алуу")}
            </button>
          </div>
        </>
      )}

      {(mode === "block" || mode === "annul") && (
        <>
          <Field label={t("Причина (обязательно)", "Себеби (милдеттүү)")}>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("menu")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy || !reason.trim()}
              onClick={() =>
                run(() =>
                  (mode === "block" ? block : annul).mutateAsync({ package_id: pkg.id, body: { reason: reason.trim() } })
                )
              }
            >
              {mode === "block" ? t("Заблокировать", "Бөгөттөө") : t("Аннулировать", "Жокко чыгаруу")}
            </button>
          </div>
        </>
      )}

      {mode === "extend" && (
        <>
          <Field label={t("Новая дата окончания", "Жаңы аяктоо күнү")}>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </Field>
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("menu")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() => run(() => extend.mutateAsync({ package_id: pkg.id, body: { new_expires_at: newDate } }))}
            >
              {t("Сохранить", "Сактоо")}
            </button>
          </div>
        </>
      )}

      {mode === "coach" && (
        <>
          <Field label={t("Новый тренер", "Жаңы тренер")}>
            <select value={newCoach} onChange={(e) => setNewCoach(e.target.value)}>
              {coaches.map((c: { id: string; full_name: string }) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </Field>
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("menu")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() => run(() => changeCoach.mutateAsync({ package_id: pkg.id, body: { coach_id: newCoach } }))}
            >
              {t("Сменить", "Алмаштыруу")}
            </button>
          </div>
        </>
      )}

      {mode === "refund" && (
        <>
          <Field label={t("Тип возврата", "Кайтаруу түрү")}>
            <select value={refundKind} onChange={(e) => setRefundKind(e.target.value as "partial" | "full")}>
              <option value="full">{t("Полный", "Толук")}</option>
              <option value="partial">{t("Частичный", "Жарым-жартылай")}</option>
            </select>
          </Field>
          <Field label={`${t("Сумма возврата", "Сумма")} (${t("доступно", "мүмкүн")} ${formatCurrency(Number(pkg.paid) - Number(pkg.refund_amount))})`}>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t("Причина (обязательно)", "Себеби (милдеттүү)")}>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={toDeposit} onChange={(e) => setToDeposit(e.target.checked)} />
            <span><b>{t("Зачислить на депозит клиента", "Кардардын депозитине")}</b></span>
          </label>
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("menu")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy || !reason.trim() || !Number(amount)}
              onClick={() =>
                run(() =>
                  refund.mutateAsync({
                    package_id: pkg.id,
                    kind: refundKind,
                    amount: Number(amount),
                    reason: reason.trim(),
                    to_deposit: toDeposit,
                    method,
                  })
                )
              }
            >
              {t("Вернуть", "Кайтаруу")}
            </button>
          </div>
        </>
      )}

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
    </Modal>
  );
};

// ============================================================
// ЗАПИСИ / СЕССИИ (§4–6, §9, §10, §15)
// ============================================================
const SessionsTab = ({ lang, canManage }: { lang: Lang; canManage: boolean }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [coachFilter, setCoachFilter] = useState("");
  const [bookOpen, setBookOpen] = useState(false);
  const [active, setActive] = useState<PtSessionFull | null>(null);
  const { data: coaches = [] } = useCoaches();
  const { data: sessions = [], isLoading } = usePtSessions({ from, to, coach_id: coachFilter || undefined });

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} lang={lang} />
        <select value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)}>
          <option value="">{t("Все тренеры", "Бардык тренерлер")}</option>
          {coaches.map((c: { id: string; full_name: string }) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
        {canManage && (
          <button className="btn btn--primary" onClick={() => setBookOpen(true)}>
            <Icon name="plus" size={14} /> {t("Записать", "Жазуу")}
          </button>
        )}
      </div>
      {isLoading ? (
        <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
      ) : sessions.length === 0 ? (
        <EmptyState title={t("Записей нет", "Жазуулар жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Дата", "Күнү")}</th>
                <th>{t("Время", "Убакыт")}</th>
                <th>{t("Тренер", "Тренер")}</th>
                <th>{t("Клиенты", "Кардарлар")}</th>
                <th>{t("Услуга", "Кызмат")}</th>
                <th className="num">{t("Длит.", "Узакт.")}</th>
                <th>{t("Статус", "Абалы")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const st = SES_STATUS[s.status];
                return (
                  <tr key={s.id} onClick={() => setActive(s)} style={{ cursor: "pointer" }}>
                    <td>{fmtDate(s.date, lang)}</td>
                    <td>{s.start_time.slice(0, 5)}</td>
                    <td>
                      {s.coach?.full_name ?? "—"}
                      {s.actual_coach_id && (
                        <div style={{ fontSize: 11, color: "var(--blue)" }}>
                          {t("замена:", "алмаштыруу:")} {s.actual_coach?.full_name}
                        </div>
                      )}
                    </td>
                    <td>{s.lessons.map((l) => l.child?.full_name ?? "").join(", ")}</td>
                    <td>{s.service?.name ?? "—"}</td>
                    <td className="num">{s.duration_min}′</td>
                    <td>
                      <span className={`pill pill--${st.cls}`}>{st[lang]}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Icon name="chevron_right" size={14} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {bookOpen && <BookModal open onClose={() => setBookOpen(false)} lang={lang} />}
      {active && <SessionDetailModal open session={active} onClose={() => setActive(null)} lang={lang} canManage={canManage} />}
    </>
  );
};

export const BookModal = ({
  open,
  onClose,
  lang,
  fixedCoachId,
  fixedChildId,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  fixedCoachId?: string;
  fixedChildId?: string;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: services = [] } = usePtServices();
  const { data: coaches = [] } = useCoaches();
  const { data: packages = [] } = usePtPackages();
  const book = usePtBookSession();

  const [serviceId, setServiceId] = useState("");
  const [coachId, setCoachId] = useState(fixedCoachId ?? "");
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState("10:00");
  const [selected, setSelected] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const svc = services.find((s) => s.id === serviceId) ?? null;
  const bookable = useMemo(
    () =>
      packages.filter(
        (p) =>
          p.service_id === serviceId &&
          ["purchased", "awaiting_activation", "active"].includes(p.status) &&
          p.lessons_used < p.lessons_total &&
          (!fixedCoachId || p.coach_id === fixedCoachId) &&
          (!fixedChildId || p.child_id === fixedChildId)
      ),
    [packages, serviceId, fixedCoachId, fixedChildId]
  );

  const toggle = (id: string) =>
    setSelected((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  const submit = async () => {
    setErr(null);
    if (!svc || !coachId || selected.length === 0) {
      setErr(t("Выберите услугу, тренера и пакеты", "Кызмат, тренер жана пакеттерди тандаңыз"));
      return;
    }
    try {
      await book.mutateAsync({
        service_id: svc.id,
        coach_id: coachId,
        date,
        start_time: time,
        package_ids: selected,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Запись на тренировку", "Машыгууга жазуу")} width={560}>
      {services.length === 0 && (
        <div style={{
          marginBottom: 10, padding: "8px 12px", fontSize: 12.5,
          background: "var(--yellow-100)", border: "1px solid oklch(0.92 0.10 90)", borderRadius: "var(--r-sm)",
        }}>
          {t(
            "Каталог услуг ПТ пуст — записывать не на что. Сначала директор или старший менеджер создаёт услуги, затем продаётся пакет.",
            "ЖМ кызматтарынын каталогу бош. Адегенде директор кызматтарды түзөт, андан кийин пакет сатылат.",
          )}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("Услуга", "Кызмат")}>
          <select
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setSelected([]);
            }}
          >
            <option value="">{t("— выбрать —", "— тандоо —")}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Тренер", "Тренер")}>
          <select value={coachId} onChange={(e) => setCoachId(e.target.value)} disabled={!!fixedCoachId}>
            <option value="">{t("— выбрать —", "— тандоо —")}</option>
            {coaches.map((c: { id: string; full_name: string }) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Дата", "Күнү")}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("Время", "Убакыт")}>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>

      {serviceId && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            {t("Пакеты клиентов", "Кардар пакеттери")}
            {svc?.type === "mini_group" && ` (${t("одна мини-группа", "бир мини-топ")})`}
          </div>
          {bookable.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              {t("Нет доступных пакетов по этой услуге", "Бул кызмат боюнча пакеттер жок")}
            </div>
          ) : (
            bookable.map((p) => (
              <label key={p.id} className="check" style={{ display: "flex", marginBottom: 4 }}>
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                <span>
                  <b>{p.child?.full_name}</b>
                  <small>
                    {" "}
                    {t("остаток", "калдык")} {p.lessons_total - p.lessons_used}/{p.lessons_total}
                    {Number(p.paid) < Number(p.price) && (
                      <span style={{ color: "var(--red-600)" }}> · {t("долг", "карыз")} {formatCurrency(Number(p.price) - Number(p.paid))}</span>
                    )}
                  </small>
                </span>
              </label>
            ))
          )}
        </div>
      )}

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={book.isPending}>
          {t("Отмена", "Жокко чыгаруу")}
        </button>
        <button className="btn btn--primary" onClick={submit} disabled={book.isPending}>
          {book.isPending ? t("Записываем…", "Жазылууда…") : t("Записать", "Жазуу")}
        </button>
      </div>
    </Modal>
  );
};

// Экспортируется: та же карточка записи открывается из общего расписания,
// чтобы ПТ управлялись оттуда без перехода в раздел «Персональные».
export const SessionDetailModal = ({
  open,
  onClose,
  session,
  lang,
  canManage,
}: {
  open: boolean;
  onClose: () => void;
  session: PtSessionFull;
  lang: Lang;
  canManage: boolean;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: coaches = [] } = useCoaches();
  const complete = usePtCompleteSession();
  const cancel = usePtCancelSession();
  const reschedule = usePtRescheduleSession();
  const substitute = usePtSubstitute();
  const updateSession = usePtUpdateSession();
  const setLessonStatus = usePtSetLessonStatus();

  const [mode, setMode] = useState<"view" | "complete" | "cancel" | "reschedule" | "substitute" | "edit">("view");
  const [marks, setMarks] = useState<Record<string, "attended" | "missed">>(
    Object.fromEntries(session.lessons.map((l) => [l.id, "attended" as const]))
  );
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState(false);
  const [newDate, setNewDate] = useState(session.date);
  const [newTime, setNewTime] = useState(session.start_time.slice(0, 5));
  const [subCoach, setSubCoach] = useState("");
  const [subComment, setSubComment] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const busy =
    complete.isPending || cancel.isPending || reschedule.isPending ||
    substitute.isPending || updateSession.isPending || setLessonStatus.isPending;

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const st = SES_STATUS[session.status];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${fmtDate(session.date, lang)} ${session.start_time.slice(0, 5)} · ${session.service?.name ?? ""}`}
      width={560}
    >
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
        {t("Тренер", "Тренер")}: <b>{session.coach?.full_name}</b>
        {session.actual_coach_id && (
          <>
            {" "}· {t("фактически провёл", "иш жүзүндө өткөргөн")}: <b>{session.actual_coach?.full_name}</b>
          </>
        )}{" "}
        · <span className={`pill pill--${st.cls}`}>{st[lang]}</span>
        {session.cancel_reason && (
          <div>{t("Причина отмены", "Себеби")}: {session.cancel_reason}</div>
        )}
        {session.reschedule_reason && (
          <div>{t("Причина переноса", "Которуу себеби")}: {session.reschedule_reason}</div>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        {session.lessons.map((l) => {
          const v = VISIT_SYMBOL(l.status, l.charged);
          return (
            <div
              key={l.id}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)" }}
            >
              <div>
                <b>{l.child?.full_name}</b>{" "}
                <span title={v.title} style={{ color: v.color, fontWeight: 700 }}>{v.sym}</span>
                {l.entry_time && (
                  <small style={{ color: "var(--muted)" }}>
                    {" "}
                    {t("вход", "кирүү")} {new Date(l.entry_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    {l.exit_time && ` · ${t("выход", "чыгуу")} ${new Date(l.exit_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`}
                  </small>
                )}
              </div>
              {canManage && session.status === "completed" && l.charged && (
                <button
                  className="btn btn--ghost"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  title={t("Вернуть тренировку в пакет (отменить списание)", "Машыгууну пакетке кайтаруу")}
                  onClick={() =>
                    run(() =>
                      setLessonStatus.mutateAsync({ lesson_id: l.id, status: "cancelled", charge: false, reason: t("Возврат тренировки администратором", "Администратор кайтарды") })
                    )
                  }
                >
                  {t("Вернуть", "Кайтаруу")}
                </button>
              )}
              {canManage && session.status === "completed" && !l.charged && l.status !== "attended" && (
                <button
                  className="btn btn--ghost"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  onClick={() => run(() => setLessonStatus.mutateAsync({ lesson_id: l.id, status: "attended", charge: true }))}
                >
                  {t("Отметить ✓", "Белгилөө ✓")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {mode === "view" && canManage && (
        <div style={{ display: "grid", gap: 8 }}>
          {session.status === "scheduled" && (
            <>
              <button className="btn btn--primary" onClick={() => setMode("complete")}>
                {t("Провести тренировку", "Машыгууну өткөрүү")}
              </button>
              <button className="btn" onClick={() => setMode("edit")}>{t("Изменить дату/время", "Күн/убакытты өзгөртүү")}</button>
              <button className="btn" onClick={() => setMode("reschedule")}>{t("Перенести", "Которуу")}</button>
              <button className="btn btn--ghost" style={{ color: "var(--red-600)" }} onClick={() => setMode("cancel")}>
                {t("Отменить", "Жокко чыгаруу")}
              </button>
            </>
          )}
          {["scheduled", "completed"].includes(session.status) && (
            <button className="btn" onClick={() => setMode("substitute")}>
              {t("Оформить замену тренера", "Тренер алмаштырууну каттоо")}
            </button>
          )}
        </div>
      )}

      {mode === "complete" && (
        <>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{t("Отметьте посещение", "Катышууну белгилеңиз")}</div>
          {session.lessons.map((l) => (
            <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{l.child?.full_name}</span>
              <select
                value={marks[l.id]}
                onChange={(e) => setMarks((m) => ({ ...m, [l.id]: e.target.value as "attended" | "missed" }))}
              >
                <option value="attended">{t("✓ Присутствовал", "✓ Катышты")}</option>
                <option value="missed">{t("Неявка (списать)", "Келген жок (алынат)")}</option>
              </select>
            </div>
          ))}
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("view")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                run(() =>
                  complete.mutateAsync({
                    session_id: session.id,
                    attendance: session.lessons.map((l) => ({
                      lesson_id: l.id,
                      status: marks[l.id] ?? "attended",
                      charge: true,
                    })),
                    source: "admin",
                  })
                )
              }
            >
              {t("Провести", "Өткөрүү")}
            </button>
          </div>
        </>
      )}

      {mode === "cancel" && (
        <>
          <Field label={t("Причина отмены (обязательно)", "Себеби (милдеттүү)")}>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
            <span>
              <b>{t("Списать тренировку из пакета", "Машыгууну пакеттен алуу")}</b>
              <small>{t("поздняя отмена без предупреждения", "эскертүүсүз кеч жокко чыгаруу")}</small>
            </span>
          </label>
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("view")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy || !reason.trim()}
              onClick={() => run(() => cancel.mutateAsync({ session_id: session.id, reason: reason.trim(), charge }))}
            >
              {t("Отменить тренировку", "Жокко чыгаруу")}
            </button>
          </div>
        </>
      )}

      {mode === "reschedule" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("Новая дата", "Жаңы күн")}>
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </Field>
            <Field label={t("Новое время", "Жаңы убакыт")}>
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            </Field>
          </div>
          <Field label={t("Причина переноса (обязательно)", "Себеби (милдеттүү)")}>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("view")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy || !reason.trim()}
              onClick={() =>
                run(() => reschedule.mutateAsync({ session_id: session.id, new_date: newDate, new_time: newTime, reason: reason.trim() }))
              }
            >
              {t("Перенести", "Которуу")}
            </button>
          </div>
        </>
      )}

      {mode === "edit" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("Дата", "Күнү")}>
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </Field>
            <Field label={t("Время", "Убакыт")}>
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            </Field>
          </div>
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("view")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() => run(() => updateSession.mutateAsync({ session_id: session.id, date: newDate, start_time: newTime }))}
            >
              {t("Сохранить", "Сактоо")}
            </button>
          </div>
        </>
      )}

      {mode === "substitute" && (
        <>
          <Field label={t("Тренер, который фактически провёл / проведёт", "Иш жүзүндө өткөргөн тренер")}>
            <select value={subCoach} onChange={(e) => setSubCoach(e.target.value)}>
              <option value="">{t("— выбрать —", "— тандоо —")}</option>
              {coaches
                .filter((c: { id: string }) => c.id !== session.coach_id)
                .map((c: { id: string; full_name: string }) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t("Комментарий", "Комментарий")}>
            <textarea rows={2} value={subComment} onChange={(e) => setSubComment(e.target.value)} />
          </Field>
          <div className="modal__foot">
            <button className="btn" onClick={() => setMode("view")}>{t("Назад", "Артка")}</button>
            <button
              className="btn btn--primary"
              disabled={busy || !subCoach}
              onClick={() =>
                run(() => substitute.mutateAsync({ session_id: session.id, actual_coach_id: subCoach, comment: subComment.trim() || undefined }))
              }
            >
              {t("Оформить замену", "Каттоо")}
            </button>
          </div>
        </>
      )}

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
    </Modal>
  );
};

// ============================================================
// ЖУРНАЛ (§14) — школьный журнал: строки клиенты, столбцы даты
// ============================================================
const JournalTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [coachFilter, setCoachFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [clientQ, setClientQ] = useState("");
  const { data: coaches = [] } = useCoaches();
  const { data: services = [] } = usePtServices(true);
  const { data: sessions = [], isLoading } = usePtSessions({
    from,
    to,
    coach_id: coachFilter || undefined,
    service_id: serviceFilter || undefined,
  });

  const { dates, rows } = useMemo(() => {
    const dateSet = new Set<string>();
    const byChild = new Map<string, { name: string; cells: Map<string, { sym: string; title: string; color: string }> }>();
    for (const s of sessions) {
      for (const l of s.lessons) {
        const name = l.child?.full_name ?? l.child_id;
        if (clientQ && !name.toLowerCase().includes(clientQ.toLowerCase())) continue;
        dateSet.add(s.date);
        const row = byChild.get(l.child_id) ?? { name, cells: new Map() };
        row.cells.set(s.date, VISIT_SYMBOL(l.status, l.charged));
        byChild.set(l.child_id, row);
      }
    }
    return {
      dates: Array.from(dateSet).sort(),
      rows: Array.from(byChild.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [sessions, clientQ]);

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} lang={lang} />
        <select value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)}>
          <option value="">{t("Все тренеры", "Бардык тренерлер")}</option>
          {coaches.map((c: { id: string; full_name: string }) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
        <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
          <option value="">{t("Все услуги", "Бардык кызматтар")}</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <SearchBox value={clientQ} onChange={setClientQ} placeholder={t("Клиент…", "Кардар…")} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
        ✓ {t("Присутствовал", "Катышты")} · <b style={{ color: "var(--red-600)" }}>Н</b> {t("Неявка", "Келген жок")} ·{" "}
        <b style={{ color: "var(--blue)" }}>П</b> {t("Перенос", "Которуу")} · <b>О</b> {t("Отмена", "Жокко чыгаруу")} ·{" "}
        <b style={{ color: "var(--red-600)" }}>С</b> {t("Списано", "Алынды")}
      </div>
      {isLoading ? (
        <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("Нет данных за период", "Бул мезгилде маалымат жок")} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table" style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th>{t("Клиент", "Кардар")}</th>
                {dates.map((d) => (
                  <th key={d} style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    {fmtDate(d, lang)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="cell-main">{r.name}</td>
                  {dates.map((d) => {
                    const c = r.cells.get(d);
                    return (
                      <td key={d} style={{ textAlign: "center" }}>
                        {c ? (
                          <span title={c.title} style={{ color: c.color, fontWeight: 700 }}>
                            {c.sym}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ============================================================
// РЕЕСТР ЗАМЕН (§20)
// ============================================================
const SubsTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const { data: subs = [], isLoading } = usePtSubstitutions(from, to);

  const totals = useMemo(
    () => ({
      count: subs.filter((s) => s.status === "completed").length,
      amount: subs.filter((s) => s.status === "completed").reduce((sum, s) => sum + Number(s.accrual), 0),
    }),
    [subs]
  );

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} lang={lang} />
      </div>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        {t("Замен проведено", "Алмаштыруулар")}: <b>{totals.count}</b> · {t("Сумма начислений", "Сумма")}:{" "}
        <b>{formatCurrency(Math.round(totals.amount))}</b>
      </div>
      {isLoading ? (
        <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
      ) : subs.length === 0 ? (
        <EmptyState title={t("Замен за период нет", "Алмаштыруулар жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Дата", "Күнү")}</th>
                <th>{t("Клиент", "Кардар")}</th>
                <th>{t("Услуга", "Кызмат")}</th>
                <th>{t("Основной тренер", "Негизги тренер")}</th>
                <th>{t("Заменяющий", "Алмаштыруучу")}</th>
                <th className="num">{t("Стоимость трен.", "Баасы")}</th>
                <th className="num">%</th>
                <th className="num">{t("Начисление", "Эсептөө")}</th>
                <th>{t("Статус", "Абалы")}</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => {
                const st = SES_STATUS[s.status];
                return (
                  <tr key={s.session_id}>
                    <td>{fmtDate(s.date, lang)} {s.start_time.slice(0, 5)}</td>
                    <td>{s.client_names ?? "—"}</td>
                    <td>{s.service_name}</td>
                    <td>{s.main_coach_name}</td>
                    <td><b>{s.sub_coach_name}</b></td>
                    <td className="num">{formatCurrency(Math.round(Number(s.lesson_value)))}</td>
                    <td className="num">{Number(s.coach_percent)}%</td>
                    <td className="num"><b>{formatCurrency(Math.round(Number(s.accrual)))}</b></td>
                    <td><span className={`pill pill--${st.cls}`}>{st[lang]}</span></td>
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

// ============================================================
// ОТЧЁТЫ (§13) + итоговый блок зарплаты (§20)
// ============================================================
const ReportsTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const { data: payroll, isLoading } = usePtPayroll(from, to);
  const { data: summary } = usePtSummary(from, to);
  // Бэк отдаёт всех тренеров (25 строк по нулям) — без фильтра таблица
  // рисовалась с шапкой и без строк, выглядело как сломанная.
  const rows = useMemo(
    () => (payroll?.items ?? [])
      .filter((r) => r.total_sessions > 0)
      .sort((a, b) => Number(b.total_amount) - Number(a.total_amount)),
    [payroll],
  );

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} lang={lang} />
      </div>

      {summary && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14, fontSize: 13 }}>
          <div>
            {t("Проведено тренировок", "Өткөрүлгөн машыгуулар")}: <b>{summary.completed_sessions}</b>
          </div>
          <div>
            {t("Отмены", "Жокко чыгаруулар")}: <b>{summary.cancelled_sessions}</b>
          </div>
          <div>
            {t("Переносы", "Которуулар")}: <b>{summary.rescheduled_sessions}</b>
          </div>
          <div>
            {t("Начисления тренерам", "Тренерлерге эсептөөлөр")}: <b>{formatCurrency(Math.round(summary.coach_accruals))}</b>
          </div>
        </div>
      )}

      {isLoading ? (
        <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("Нет проведённых персональных за период", "Бул мезгилде өткөрүлгөн жеке машыгуу жок")}
          hint={t("Начисления появятся после отметки «Провести тренировку»", "Эсептөөлөр машыгуу өткөрүлгөндөн кийин пайда болот")}
        />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Тренер", "Тренер")}</th>
                <th className="num">{t("Свои трен.", "Өз машыгуулары")}</th>
                <th className="num">{t("Сумма (свои)", "Сумма (өз)")}</th>
                <th className="num">{t("Замены", "Алмаштыруулар")}</th>
                <th className="num">{t("Сумма (замены)", "Сумма (алмашт.)")}</th>
                <th className="num">{t("Всего трен.", "Бардыгы")}</th>
                <th className="num">{t("Итого к начислению", "Жыйынтык")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                  <tr key={r.coach_id}>
                    <td className="cell-main">{r.coach_name}</td>
                    <td className="num">{r.own_sessions}</td>
                    <td className="num">{formatCurrency(Math.round(Number(r.own_amount)))}</td>
                    <td className="num">{r.sub_sessions}</td>
                    <td className="num">{formatCurrency(Math.round(Number(r.sub_amount)))}</td>
                    <td className="num">{r.total_sessions}</td>
                    <td className="num">
                      <b>{formatCurrency(Math.round(Number(r.total_amount)))}</b>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
