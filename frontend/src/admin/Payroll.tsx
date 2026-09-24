import { Fragment, useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState, formatCurrency } from "./common";
import { usePayroll, useLivePayroll, type PayrollPeriod } from "../shared/api/queries";
import { useRecomputePayroll, useAdjustPayroll, useAdvancePayroll, useApprovePayroll } from "../shared/api/mutations";
import { Modal, Field } from "../shared/ui/Modal";
import { Gate } from "../shared/auth/Gate";
import { usePerm } from "../shared/auth/rbac";

// First and last day of current month, ISO yyyy-mm-dd.
const monthRange = (offset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const start = new Date(d);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

const STATUS_LABEL: Record<PayrollPeriod["status"], { ru: string; ky: string; cls: string }> = {
  draft:        { ru: "Черновик",     ky: "Долбоор",     cls: "pill pill--frozen" },
  advance_paid: { ru: "Аванс выдан",  ky: "Аванс берилди", cls: "pill pill--active" },
  paid:         { ru: "Выплачено",    ky: "Төлөнгөн",    cls: "pill pill--active" },
};

export const PayrollPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [{ start, end }, setRange] = useState(monthRange(0));
  const { data: periods = [], isLoading, error } = usePayroll(start, end);
  const { data: live = [], isLoading: liveLoading } = useLivePayroll();
  const recompute = useRecomputePayroll();
  const advance = useAdvancePayroll();
  const approve = useApprovePayroll();
  const [adjustOpen, setAdjustOpen] = useState<PayrollPeriod | null>(null);
  // Раскрытая строка live-таблицы: показывает разбивку тренера по группам.
  const [openCoach, setOpenCoach] = useState<string | null>(null);
  const canApprove = usePerm("approve_payroll");

  const total = useMemo(
    () => periods.reduce((s, p) => s + Number(p.computed_amount) + Number(p.manual_adjustment), 0),
    [periods],
  );
  const liveActualTotal = useMemo(
    () => live.reduce((s, r) => s + Number(r.actual_amount), 0),
    [live],
  );
  const liveMaxTotal = useMemo(
    () => live.reduce((s, r) => s + Number((r as any).max_amount ?? r.actual_amount + r.projected_amount), 0),
    [live],
  );
  const liveVisitsTotal = useMemo(
    () => live.reduce((s, r) => s + Number(r.visits_count ?? 0), 0),
    [live],
  );
  // Факт за сегодня по всем тренерам: пришедшие дети × ставка группы.
  const todayVisitsTotal = useMemo(() => live.reduce((s, r) => s + Number(r.today_visits ?? 0), 0), [live]);
  const todayAmountTotal = useMemo(() => live.reduce((s, r) => s + Number(r.today_amount ?? 0), 0), [live]);

  return (
    <>
      <PageHeader
        title={t("Зарплаты тренеров", "Тренерлердин эмгек акысы")}
        subtitle={`${start} — ${end} · ${t("итого", "жалпы")}: ${formatCurrency(total)}`}
        actions={
          <>
            <button className="btn" onClick={() => setRange(monthRange(-1))}>
              {t("Прошлый месяц", "Өткөн ай")}
            </button>
            <button className="btn" onClick={() => setRange(monthRange(0))}>
              {t("Текущий месяц", "Учурдагы ай")}
            </button>
            <Gate perm="approve_payroll">
              <button
                className="btn btn--primary"
                onClick={() => recompute.mutate({ period_start: start, period_end: end })}
                disabled={recompute.isPending}
              >
                <Icon name="restore" /> {recompute.isPending ? t("Считаем…", "Эсептелүүдө…") : t("Пересчитать", "Кайра эсептөө")}
              </button>
            </Gate>
          </>
        }
      />

      {/* Live-сводка: «уже заработано / максимум за месяц» — две точки
          на одной шкале, не складываем (чтобы не превышать потолок). */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: "12px 16px 4px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            {t("Текущий месяц — live", "Учурдагы ай — live")}
          </h3>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            <b style={{ color: "var(--green)" }}>{t("Сегодня", "Бүгүн")}: {todayVisitsTotal} {t("детей", "бала")} · {formatCurrency(todayAmountTotal)}</b>
            {" · "}
            {t("За месяц", "Айга")}: {liveVisitsTotal} {t("посещ.", "катышуу")} · <b style={{ color: "var(--ink)" }}>{formatCurrency(liveActualTotal)}</b>
            {" · "}
            {t("потолок месяца", "айдын максимуму")}: {formatCurrency(liveMaxTotal)}
          </div>
        </div>
        {liveLoading ? (
          <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
        ) : live.length === 0 ? (
          <EmptyState title={t("Тренеров пока нет", "Тренерлер жок")} />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Тренер", "Тренер")}</th>
                  <th className="num">{t("Сегодня: детей", "Бүгүн: бала")}</th>
                  <th className="num">{t("Сегодня: заработано", "Бүгүн: табылды")}</th>
                  <th className="num">{t("Посещений за месяц", "Айга катышуу")}</th>
                  <th className="num">{t("Заработано за месяц", "Айга табылды")}</th>
                  <th className="num" title={t("Если каждый ребёнок придёт на все занятия месяца", "Ар бир бала бардык сабакка келсе")}>{t("Потолок месяца", "Айдын максимуму")}</th>
                  <th className="num">{t("Прогресс", "Прогресс")}</th>
                </tr>
              </thead>
              <tbody>
                {live.map((r) => {
                  const a = Number(r.actual_amount);
                  const m = Number((r as any).max_amount ?? a + Number(r.projected_amount));
                  const pct = m > 0 ? Math.round((a / m) * 100) : 0;
                  const groups = r.groups ?? [];
                  const open = openCoach === r.coach_id;
                  return (
                    <Fragment key={r.coach_id}>
                      <tr
                        style={{ cursor: "pointer" }}
                        onClick={() => setOpenCoach(open ? null : r.coach_id)}
                        title={t("Показать разбивку по группам", "Топтор боюнча бөлүү")}
                      >
                        <td>
                          <span style={{ display: "inline-block", width: 14, color: "var(--muted)", fontSize: 10 }}>
                            {open ? "▾" : "▸"}
                          </span>
                          {r.full_name ?? r.coach_id.slice(0, 8)}
                        </td>
                        <td className="num"><b style={{ color: "var(--green)" }}>{Number(r.today_visits ?? 0)}</b></td>
                        <td className="num"><b style={{ color: "var(--green)" }}>{formatCurrency(Number(r.today_amount ?? 0))}</b></td>
                        <td className="num">{Number(r.visits_count ?? 0)}</td>
                        <td className="num"><b>{formatCurrency(a)}</b></td>
                        <td className="num" style={{ color: "var(--muted)" }}>{formatCurrency(m)}</td>
                        <td className="num">{m > 0 ? `${pct}%` : "—"}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} style={{ background: "var(--bg-soft, var(--bg))", padding: "4px 12px 10px" }}>
                            {(r.today_groups?.length ?? 0) > 0 && (
                              <div style={{ fontSize: 12, padding: "6px 0 4px 14px" }}>
                                <b style={{ color: "var(--green)" }}>{t("Сегодня", "Бүгүн")}:</b>{" "}
                                {r.today_groups!.map((g) => `${g.name} — ${g.visits} ${t("дет.", "бала")} · ${formatCurrency(Number(g.earned))}`).join(" · ")}
                              </div>
                            )}
                            {groups.length === 0 ? (
                              <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 0 2px 14px" }}>
                                {t("В этом месяце посещений ещё не было", "Бул айда катышуу боло элек")}
                              </div>
                            ) : (
                              <table className="admin-table" style={{ margin: 0 }}>
                                <thead>
                                  <tr>
                                    <th style={{ fontSize: 11 }}>{t("Группа", "Топ")}</th>
                                    <th className="num" style={{ fontSize: 11 }}>{t("Посещений", "Катышуу")}</th>
                                    <th className="num" style={{ fontSize: 11 }}>{t("Заработано за группу", "Топ үчүн табылды")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {groups.map((g) => (
                                    <tr key={g.group_id}>
                                      <td style={{ fontSize: 12 }}>{g.name}</td>
                                      <td className="num" style={{ fontSize: 12 }}>{g.visits}</td>
                                      <td className="num" style={{ fontSize: 12 }}>{formatCurrency(Number(g.earned))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adjustOpen && (
        <AdjustModal period={adjustOpen} onClose={() => setAdjustOpen(null)} lang={lang} />
      )}

      {/* Утверждение и история — только для тех, кто может утверждать.
          Кассир видит только live-сводку выше. */}
      {canApprove && (
      <div className="card">
        {error ? (
          <EmptyState title={t("Ошибка", "Ката")} hint={(error as Error).message} />
        ) : isLoading ? (
          <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
        ) : periods.length === 0 ? (
          <EmptyState
            title={t("Нет начислений за период", "Бул мезгил үчүн эсептөөлөр жок")}
            hint={t("Нажмите «Пересчитать» — система начислит зарплату по фактической посещаемости.", "")}
          />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Тренер", "Тренер")}</th>
                  <th className="num">{t("Начислено", "Эсептелди")}</th>
                  <th className="num">{t("Корректировка", "Оңдоо")}</th>
                  <th className="num">{t("Итого", "Жалпы")}</th>
                  <th className="num">{t("Аванс", "Аванс")}</th>
                  <th className="num">{t("К доплате", "Кошумча")}</th>
                  <th>{t("Статус", "Абалы")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => {
                  const total = Number(p.computed_amount) + Number(p.manual_adjustment);
                  // ТЗ §10.2: 20-го выдан аванс, 5–10-го следующего месяца —
                  // остаток. «К доплате» — сколько ещё должны тренеру.
                  const advancePaid = Number(p.advance_amount ?? 0);
                  const lbl = STATUS_LABEL[p.status];
                  return (
                    <tr key={p.id ?? p.coach_id}>
                      <td>{p.coach?.full_name ?? p.coach_id.slice(0, 8)}</td>
                      <td className="num">{formatCurrency(Number(p.computed_amount))}</td>
                      <td className="num" style={{ color: Number(p.manual_adjustment) !== 0 ? "var(--blue-ink)" : undefined }}>
                        {Number(p.manual_adjustment) !== 0 ? formatCurrency(Number(p.manual_adjustment)) : "—"}
                        {p.adjustment_reason && (
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.adjustment_reason}</div>
                        )}
                      </td>
                      <td className="num"><b>{formatCurrency(total)}</b></td>
                      <td className="num" style={{ color: advancePaid > 0 ? "var(--ink-2)" : undefined }}>
                        {advancePaid > 0 ? formatCurrency(advancePaid) : "—"}
                      </td>
                      <td className="num">
                        {advancePaid > 0 ? formatCurrency(Math.max(0, total - advancePaid)) : "—"}
                      </td>
                      <td><span className={lbl.cls}>{lbl[lang]}</span></td>
                      <td style={{ textAlign: "right", width: 1 }}>
                        {p.status !== "paid" && canApprove && (
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                            <button className="btn" style={{ padding: "6px 10px", fontSize: 12 }}
                              onClick={() => setAdjustOpen(p)}>
                              {t("Корректировка", "Оңдоо")}
                            </button>
                            {p.status === "draft" && p.id && (
                              <button className="btn btn--ghost" style={{ padding: "6px 10px", fontSize: 12 }}
                                onClick={() => advance.mutate(p.id!)} disabled={advance.isPending}>
                                {t("Аванс", "Аванс")}
                              </button>
                            )}
                            {p.id && (
                              <button className="btn btn--primary" style={{ padding: "6px 10px", fontSize: 12 }}
                                onClick={() => approve.mutate(p.id!)} disabled={approve.isPending}>
                                <Icon name="check" size={12} /> {t("Утвердить", "Бекитүү")}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </>
  );
};

const AdjustModal = ({ period, onClose, lang }: { period: PayrollPeriod; onClose: () => void; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [amount, setAmount] = useState(String(period.manual_adjustment ?? 0));
  const [reason, setReason] = useState(period.adjustment_reason ?? "");
  const adjust = useAdjustPayroll();

  const submit = async () => {
    if (!period.id || !reason.trim()) return;
    await adjust.mutateAsync({ id: period.id, manual_adjustment: Number(amount) || 0, adjustment_reason: reason });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={t("Корректировка зарплаты", "Эмгек акыны оңдоо")}>
      <Field label={t("Корректировка (с)", "Оңдоо (с)")} hint={t("Положительная — добавить, отрицательная — вычесть", "")}>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label={t("Причина", "Себеп")}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("обязательно", "милдеттүү")} />
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={adjust.isPending || !reason.trim()}>
          {t("Сохранить", "Сактоо")}
        </button>
      </div>
    </Modal>
  );
};
