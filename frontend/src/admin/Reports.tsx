import { Fragment, useState, useMemo } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState, formatCurrency } from "./common";
import {
  usePayments, useChildren, useCards, usePayroll, useFreezes,
  useSalesBySection, useAttendanceByGroup, useAttendanceByChild,
  useSectionLoad, useManagerKpi, usePayrollDetail,
  type ManagerKpiRow,
} from "../shared/api/queries";
import { usePerm } from "../shared/auth/rbac";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

const downloadCsv = (rows: string[][], filename: string) => {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

type TabId = "sales" | "payroll" | "ops";

// ТЗ §11.4: «Статус: начислено / аванс выдан / выплачено».
const STATUS_LBL: Record<string, { ru: string; ky: string }> = {
  draft: { ru: "Начислено", ky: "Эсептелди" },
  advance_paid: { ru: "Аванс выдан", ky: "Аванс берилди" },
  paid: { ru: "Выплачено", ky: "Төлөндү" },
};

const CARD_TYPE_LBL: Record<string, { ru: string; ky: string }> = {
  monthly: { ru: "Месячный", ky: "Айлык" },
  quarterly: { ru: "3 месяца", ky: "3 ай" },
  nine_month: { ru: "9 месяцев", ky: "9 ай" },
  half_year: { ru: "6 месяцев", ky: "6 ай" },
  annual: { ru: "12 месяцев", ky: "12 ай" },
  personal: { ru: "Персональный", ky: "Жеке" },
  single: { ru: "Разовый", ky: "Бирдик" },
  trial: { ru: "Пробный", ky: "Сыноо" },
};

export const ReportsPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [tab, setTab] = useState<TabId>("sales");
  const allowed = usePerm("view_finance_reports");

  if (!allowed) {
    return (
      <>
        <PageHeader title={t("Финансовые отчёты", "Финансылык отчёттор")} />
        <div className="card">
          <EmptyState
            title={t("Нет доступа", "Жеткиликтүү эмес")}
            hint={t("Финансовые отчёты доступны директору, фитнес-директору и старшему менеджеру.",
                    "Финансылык отчёттор директор, фитнес-директор жана башкы менеджер үчүн.")}
          />
        </div>
      </>
    );
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "sales",   label: t("Продажи", "Сатуулар") },
    { id: "payroll", label: t("Зарплаты", "Эмгек акы") },
    { id: "ops",     label: t("Посещаемость и карты", "Катышуу жана карталар") },
  ];

  return (
    <>
      <PageHeader
        title={t("Финансовые отчёты", "Финансылык отчёттор")}
        subtitle={t("Выручка, зарплаты, посещаемость · экспорт CSV", "Кирим, эмгек акы, катышуу · CSV экспорт")}
      />

      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                className={`tabs__btn ${tab === tb.id ? "is-active" : ""}`}
                onClick={() => setTab(tb.id)}
              >
                {tb.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: 16 }}>
          {tab === "sales" && <SalesTab lang={lang} />}
          {tab === "payroll" && <PayrollTab lang={lang} />}
          {tab === "ops" && <OpsTab lang={lang} />}
        </div>
      </div>
    </>
  );
};

// ---------- Sales tab ----------
const SalesTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: payments = [] } = usePayments();
  const { data: cards = [] } = useCards();
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(ymd(new Date()));

  const filtered = useMemo(() => {
    const f = new Date(from).getTime();
    const tEnd = new Date(to).getTime() + 86399999;
    return payments.filter((p) => {
      const d = new Date(p.paid_at).getTime();
      return d >= f && d <= tEnd;
    });
  }, [payments, from, to]);

  const total = filtered.reduce((s, p) => s + Number(p.amount), 0);
  const cash = filtered.filter((p) => p.method === "cash").reduce((s, p) => s + Number(p.amount), 0);
  const term = filtered.filter((p) => p.method === "terminal").reduce((s, p) => s + Number(p.amount), 0);
  const avgCheck = filtered.length > 0 ? Math.round(total / filtered.length) : 0;

  // Group by manager (received_by) → who collected most
  const byManager = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; count: number }>();
    for (const p of filtered) {
      const key = p.received_by ?? "—";
      const name = p.receiver?.full_name ?? "—";
      const cur = map.get(key) ?? { name, amount: 0, count: 0 };
      cur.amount += Number(p.amount);
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [filtered]);

  // Group by card type
  const cardsInPeriod = useMemo(() => {
    const f = new Date(from).getTime();
    const tEnd = new Date(to).getTime() + 86399999;
    return cards.filter((c) => {
      const d = new Date(c.created_at).getTime();
      return d >= f && d <= tEnd;
    });
  }, [cards, from, to]);

  const byCardType = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const c of cardsInPeriod) {
      const cur = map.get(c.type) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += Number(c.price_paid);
      map.set(c.type, cur);
    }
    return Array.from(map.entries()).map(([type, v]) => ({ type, ...v }));
  }, [cardsInPeriod]);

  // ТЗ §11.2: разрез по дисциплине и конверсии. Конверсию «пробная →
  // продажа» и продления берём из manager_kpi — того же источника, что
  // дашборд и воронка, чтобы три экрана не показывали три разных числа.
  const { data: bySection = [] } = useSalesBySection(from, to);
  const { data: kpiRows = [] } = useManagerKpi(from, to);

  const conv = useMemo(() => {
    const sum = (f: (r: ManagerKpiRow) => number) => kpiRows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
    const attended = sum((r) => r.trial_attended_total);
    const converted = sum((r) => r.converted_total);
    const renewDue = sum((r) => r.renewals_due);
    const renewDone = sum((r) => r.renewals_done);
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
    return {
      attended, converted, renewDue, renewDone,
      trialToSale: pct(converted, attended),
      renewal: pct(renewDone, renewDue),
    };
  }, [kpiRows]);

  const exportRevenue = () => {
    const rows: string[][] = [
      ["Дата", "Ребёнок", "Метод", "Сумма (KGS)", "Комментарий"],
      ...filtered.map((p) => [
        new Date(p.paid_at).toLocaleString("ru-RU"),
        p.child?.full_name ?? p.child_id.slice(0, 8),
        p.method,
        String(p.amount),
        (p as any).comment ?? "",
      ]),
      [],
      ["Итого", "", "", String(total), ""],
    ];
    downloadCsv(rows, `revenue-${from}-${to}.csv`);
  };

  return (
    <>
      <div className="grid-2" style={{ maxWidth: 360 }}>
        <label className="field">
          <span className="field__label">{t("С", "Башт.")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{t("По", "Чейин")}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="kpi-grid" style={{ marginTop: 16 }}>
        <div className="kpi">
          <div className="kpi__label">{t("Выручка", "Кирим")}</div>
          <div className="kpi__value">{total.toLocaleString("ru-RU")} <span className="unit">KGS</span></div>
          <span className="kpi__delta">{filtered.length} {t("платежей", "төлөм")}</span>
        </div>
        <div className="kpi">
          <div className="kpi__label">{t("Средний чек", "Орт. чек")}</div>
          <div className="kpi__value">{avgCheck.toLocaleString("ru-RU")} <span className="unit">KGS</span></div>
        </div>
        <div className="kpi">
          <div className="kpi__label">{t("Наличные", "Накта")}</div>
          <div className="kpi__value">{cash.toLocaleString("ru-RU")} <span className="unit">KGS</span></div>
        </div>
        <div className="kpi">
          <div className="kpi__label">{t("Терминал", "Терминал")}</div>
          <div className="kpi__value">{term.toLocaleString("ru-RU")} <span className="unit">KGS</span></div>
        </div>
      </div>

      {/* ТЗ §11.2: конверсия «пробная → продажа» и продления */}
      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <div className="kpi">
          <div className="kpi__label">{t("Пробная → продажа", "Сыноо → сатуу")}</div>
          <div className="kpi__value">
            {conv.trialToSale == null ? "—" : <>{conv.trialToSale} <span className="unit">%</span></>}
          </div>
          <span className="kpi__delta">
            {t(`${conv.converted} из ${conv.attended} пришедших`, `${conv.attended} ичинен ${conv.converted}`)}
          </span>
        </div>
        <div className="kpi">
          <div className="kpi__label">{t("Конверсия продлений", "Узартуу конверсиясы")}</div>
          <div className="kpi__value">
            {conv.renewal == null ? "—" : <>{conv.renewal} <span className="unit">%</span></>}
          </div>
          <span className="kpi__delta">
            {t(`${conv.renewDone} из ${conv.renewDue} · цель > 80%`, `${conv.renewDue} ичинен ${conv.renewDone}`)}
          </span>
        </div>
      </div>

      {/* ТЗ §11.2: разрез по дисциплинам */}
      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("По дисциплинам", "Багыттар боюнча")}</h3>
      {bySection.length === 0 ? (
        <EmptyState title={t("Нет продаж за период", "Мезгилде сатуу жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Дисциплина", "Багыт")}</th>
                <th className="num">{t("Абонементов", "Абонемент")}</th>
                <th className="num">{t("Выручка", "Кирим")}</th>
                <th className="num">{t("Средний чек", "Орт. чек")}</th>
              </tr>
            </thead>
            <tbody>
              {bySection.map((r) => (
                <tr key={r.section_id}>
                  <td>{lang === "ru" ? r.name_ru : r.name_ky}</td>
                  <td className="num">{r.cards_sold}</td>
                  <td className="num">{formatCurrency(Number(r.revenue))}</td>
                  <td className="num">{formatCurrency(Number(r.avg_check))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ТЗ §11.2: продления в разрезе ответственных менеджеров */}
      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("Продления по менеджерам", "Менеджерлер боюнча узартуу")}</h3>
      {kpiRows.filter((r) => r.manager_id && Number(r.renewals_due) > 0).length === 0 ? (
        <EmptyState title={t("Нет абонементов, истекавших в периоде", "Мезгилде бүткөн абонемент жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Менеджер", "Менеджер")}</th>
                <th className="num">{t("Истекало", "Бүттү")}</th>
                <th className="num">{t("Продлили", "Узартты")}</th>
                <th className="num">{t("Конверсия", "Конверсия")}</th>
              </tr>
            </thead>
            <tbody>
              {kpiRows
                .filter((r) => r.manager_id && Number(r.renewals_due) > 0)
                .map((r) => {
                  const pct = Math.round((Number(r.renewals_done) / Number(r.renewals_due)) * 100);
                  return (
                    <tr key={r.manager_id!}>
                      <td>{r.manager_name}</td>
                      <td className="num">{r.renewals_due}</td>
                      <td className="num">{r.renewals_done}</td>
                      <td className="num" style={{ color: pct > 80 ? "var(--green-ink, var(--ink))" : "var(--red-600)" }}>
                        {pct}%
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("По менеджерам", "Менеджерлер боюнча")}</h3>
      {byManager.length === 0 ? (
        <EmptyState title={t("Нет данных", "Маалымат жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr><th>{t("Менеджер (id)", "Менеджер (id)")}</th><th className="num">{t("Сумма", "Жалпы")}</th><th className="num">{t("Платежи", "Төлөмдөр")}</th></tr>
            </thead>
            <tbody>
              {byManager.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td className="num">{formatCurrency(m.amount)}</td>
                  <td className="num">{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("По типам абонементов", "Абонемент түрлөрү боюнча")}</h3>
      {byCardType.length === 0 ? (
        <EmptyState title={t("Нет проданных карт за период", "Сатылган карталар жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr><th>{t("Тип", "Түрү")}</th><th className="num">{t("Кол-во", "Саны")}</th><th className="num">{t("Сумма", "Жалпы")}</th></tr>
            </thead>
            <tbody>
              {byCardType.map((c) => (
                <tr key={c.type}>
                  <td>{CARD_TYPE_LBL[c.type]?.[lang] ?? c.type}</td>
                  <td className="num">{c.count}</td>
                  <td className="num">{formatCurrency(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button className="btn btn--primary" onClick={exportRevenue} style={{ marginTop: 16 }}>
        <Icon name="download" /> {t("Скачать CSV выручки", "CSV жүктөө")}
      </button>
    </>
  );
};

// ---------- Payroll tab ----------
const monthRange = (offset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const start = new Date(d);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: ymd(start), end: ymd(end) };
};

const PayrollTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [{ start, end }, setRange] = useState(monthRange(0));
  const { data: periods = [], isLoading } = usePayroll(start, end);
  // ТЗ §11.4: детализация по занятиям и группам — по клику на тренера,
  // грузится отдельным запросом, чтобы не тянуть занятия всех сразу.
  const [openCoach, setOpenCoach] = useState<string | null>(null);

  const total = periods.reduce((s, p) => s + Number(p.computed_amount) + Number(p.manual_adjustment), 0);

  const exportPayroll = () => {
    const rows: string[][] = [
      ["Тренер", "Начислено", "Корректировка", "Причина", "Итого", "Статус"],
      ...periods.map((p) => [
        p.coach?.full_name ?? p.coach_id,
        String(p.computed_amount),
        String(p.manual_adjustment),
        p.adjustment_reason ?? "",
        String(Number(p.computed_amount) + Number(p.manual_adjustment)),
        p.status,
      ]),
      [],
      ["Итого", "", "", "", String(total), ""],
    ];
    downloadCsv(rows, `payroll-${start}-${end}.csv`);
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="btn" onClick={() => setRange(monthRange(-1))}>{t("Прошлый месяц", "Өткөн ай")}</button>
        <button className="btn" onClick={() => setRange(monthRange(0))}>{t("Текущий месяц", "Учурдагы ай")}</button>
        <div style={{ flex: 1 }} />
        <span style={{ alignSelf: "center", color: "var(--muted)", fontSize: 13 }}>{start} — {end}</span>
      </div>

      {isLoading ? (
        <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
      ) : periods.length === 0 ? (
        <EmptyState title={t("Нет начислений за период", "Эсептөөлөр жок")} hint={t("Перейдите в раздел «Зарплаты» и нажмите «Пересчитать».", "")} />
      ) : (
        <>
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Тренер", "Тренер")}</th>
                  <th className="num">{t("Начислено", "Эсептелди")}</th>
                  <th className="num">{t("Корректировка", "Оңдоо")}</th>
                  <th className="num">{t("Итого", "Жалпы")}</th>
                  <th className="num">{t("Аванс", "Аванс")}</th>
                  <th>{t("Статус", "Абалы")}</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <Fragment key={p.id ?? p.coach_id}>
                    <tr
                      style={{ cursor: "pointer" }}
                      onClick={() => setOpenCoach(openCoach === p.coach_id ? null : p.coach_id)}
                      title={t("Показать детализацию по занятиям", "Сабактар боюнча чечмелөө")}
                    >
                      <td>
                        <span style={{ display: "inline-block", width: 14, color: "var(--muted)", fontSize: 10 }}>
                          {openCoach === p.coach_id ? "▾" : "▸"}
                        </span>
                        {p.coach?.full_name ?? p.coach_id.slice(0, 8)}
                      </td>
                      <td className="num">{formatCurrency(Number(p.computed_amount))}</td>
                      <td className="num">
                        {Number(p.manual_adjustment) !== 0 ? formatCurrency(Number(p.manual_adjustment)) : "—"}
                        {/* ТЗ §11.4: история корректировок управляющего */}
                        {p.adjustment_reason && (
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.adjustment_reason}</div>
                        )}
                      </td>
                      <td className="num"><b>{formatCurrency(Number(p.computed_amount) + Number(p.manual_adjustment))}</b></td>
                      <td className="num">
                        {Number(p.advance_amount ?? 0) > 0 ? formatCurrency(Number(p.advance_amount)) : "—"}
                      </td>
                      <td>{STATUS_LBL[p.status]?.[lang] ?? p.status}</td>
                    </tr>
                    {openCoach === p.coach_id && (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--bg-soft)", padding: "6px 12px 12px" }}>
                          <PayrollDetail coachId={p.coach_id} from={start} to={end} lang={lang} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr>
                  <td><b>{t("Итого", "Жалпы")}</b></td>
                  <td colSpan={2}></td>
                  <td className="num"><b>{formatCurrency(total)}</b></td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
          <button className="btn btn--primary" onClick={exportPayroll} style={{ marginTop: 16 }}>
            <Icon name="download" /> {t("Скачать CSV", "CSV жүктөө")}
          </button>
        </>
      )}
    </>
  );
};

// ТЗ §11.4: детализация начисления — строка на занятие, свёрнутая по
// группам. Источник тот же, что у самого начисления (v_payroll_attendance),
// поэтому сумма детализации всегда сходится с «Начислено».
const PayrollDetail = ({
  coachId, from, to, lang,
}: { coachId: string; from: string; to: string; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data = [], isLoading } = usePayrollDetail(coachId, from, to);

  const byGroup = useMemo(() => {
    const m = new Map<string, { name: string; section: string; lessons: number; visits: number; amount: number }>();
    for (const r of data) {
      const cur = m.get(r.group_id) ?? { name: r.group_name, section: r.section_name, lessons: 0, visits: 0, amount: 0 };
      cur.lessons += 1;
      cur.visits += Number(r.visits);
      cur.amount += Number(r.amount);
      m.set(r.group_id, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
  }, [data]);

  if (isLoading) return <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("Загрузка…", "Жүктөлүүдө…")}</div>;
  if (data.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("Нет оплачиваемых занятий за период", "Мезгилде төлөнүүчү сабак жок")}</div>;
  }

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("По группам", "Топтор боюнча")}</div>
      {byGroup.map((g) => (
        <div key={g.name} style={{ display: "flex", gap: 8, padding: "3px 0" }}>
          <span style={{ flex: 1, minWidth: 0 }}>{g.name} <span style={{ color: "var(--muted)" }}>· {g.section}</span></span>
          <span style={{ color: "var(--muted)" }}>
            {g.lessons} {t("зан.", "саб.")} · {g.visits} {t("детей", "бала")}
          </span>
          <span style={{ fontWeight: 600, minWidth: 90, textAlign: "right" }}>{formatCurrency(g.amount)}</span>
        </div>
      ))}

      <div style={{ fontWeight: 600, margin: "10px 0 6px" }}>{t("По занятиям", "Сабактар боюнча")}</div>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {data.map((r) => (
          <div key={r.lesson_id} style={{ display: "flex", gap: 8, padding: "2px 0", color: "var(--ink-2)" }}>
            <span style={{ width: 90 }}>{r.lesson_date}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.group_name}
            </span>
            <span style={{ color: "var(--muted)" }}>{r.visits} {t("детей", "бала")}</span>
            <span style={{ minWidth: 90, textAlign: "right" }}>{formatCurrency(Number(r.amount))}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------- Ops tab (attendance + cards) ----------
const OpsTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  // ТЗ §11.3 требует период, а не «последние 30 дней» — месяц по
  // умолчанию, дальше офис двигает сам.
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(ymd(new Date()));
  const { data: byGroup = [] } = useAttendanceByGroup(from, to);
  const { data: byChild = [] } = useAttendanceByChild(from, to);
  const { data: sectionLoad = [] } = useSectionLoad();
  const { data: cards = [] } = useCards();
  const { data: freezes = [] } = useFreezes();
  const { data: kids = [] } = useChildren();

  const active = cards.filter((c) => c.status === "active").length;
  const frozen = cards.filter((c) => c.status === "frozen").length;
  const today = ymd(new Date());
  const in7 = ymd(new Date(Date.now() + 7 * 86400000));
  const expiring = cards.filter((c) => c.end_date >= today && c.end_date <= in7).length;
  const debtors = kids.filter((k) => k.status === "debtor");

  const exportDebtors = () => {
    const rows: string[][] = [
      ["ФИО", "Карта", "Семья", "Телефон отца", "Телефон матери"],
      ...debtors.map((k) => [
        k.full_name,
        k.card_number ?? "",
        [k.family?.father_name, k.family?.mother_name].filter(Boolean).join(" / "),
        k.family?.father_phone ?? "",
        k.family?.mother_phone ?? "",
      ]),
    ];
    downloadCsv(rows, `debtors-${ymd(new Date())}.csv`);
  };

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi__label">{t("Активных карт", "Активдүү карталар")}</div>
          <div className="kpi__value">{active}</div>
        </div>
        <div className="kpi">
          <div className="kpi__label">{t("Заморожено", "Тындырылган")}</div>
          <div className="kpi__value">{frozen}</div>
        </div>
        <div className="kpi">
          <div className="kpi__label">{t("Истекают за 7 дней", "7 күндө бүтөт")}</div>
          <div className="kpi__value">{expiring}</div>
        </div>
        <div className="kpi">
          <div className="kpi__label">{t("Должники", "Карыздар")}</div>
          <div className="kpi__value">{debtors.length}</div>
        </div>
      </div>

      <div className="grid-2" style={{ maxWidth: 360, marginTop: 16 }}>
        <label className="field">
          <span className="field__label">{t("С", "Башт.")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{t("По", "Чейин")}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {/* ТЗ §11.3: по группам — посещения и пропуски за период */}
      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("По группам", "Топтор боюнча")}</h3>
      {byGroup.length === 0 ? (
        <EmptyState title={t("Нет занятий за период", "Мезгилде сабак жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Группа", "Топ")}</th>
                <th>{t("Тренер", "Тренер")}</th>
                <th className="num">{t("Занятий", "Сабак")}</th>
                <th className="num">{t("Посещений", "Катышуу")}</th>
                <th className="num">{t("Пропусков", "Калтырган")}</th>
                <th className="num">{t("Посещ. %", "Катышуу %")}</th>
              </tr>
            </thead>
            <tbody>
              {byGroup.map((g) => (
                <tr key={g.group_id}>
                  <td>
                    <div className="cell-main">{g.group_name}</div>
                    <div className="cell-sub">{g.section_name}</div>
                  </td>
                  <td className="cell-sub">{g.coach_name ?? "—"}</td>
                  <td className="num">{g.lessons_held}</td>
                  <td className="num">{g.visits}</td>
                  <td className="num">{g.misses}</td>
                  <td className="num">{g.attendance_pct == null ? "—" : `${g.attendance_pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ТЗ §11.3: по клиентам — история и частота посещений */}
      <h3 style={{ marginTop: 24, fontSize: 14 }}>
        {t("По клиентам", "Кардарлар боюнча")}
        <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>
          {" "}· {t("первые 50 по числу посещений", "катышуу боюнча алгачкы 50")}
        </span>
      </h3>
      {byChild.length === 0 ? (
        <EmptyState title={t("Нет посещений за период", "Мезгилде катышуу жок")} />
      ) : (
        <>
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Клиент", "Кардар")}</th>
                  <th className="num">{t("Посещений", "Катышуу")}</th>
                  <th className="num">{t("Пропусков", "Калтырган")}</th>
                  <th className="num">{t("В неделю", "Жумасына")}</th>
                  <th>{t("Последнее", "Акыркы")}</th>
                  <th className="num">{t("Посещ. %", "Катышуу %")}</th>
                </tr>
              </thead>
              <tbody>
                {byChild.slice(0, 50).map((c) => (
                  <tr key={c.child_id}>
                    <td>{c.full_name}</td>
                    <td className="num">{c.visits}</td>
                    <td className="num">{c.misses}</td>
                    <td className="num">{Number(c.per_week).toFixed(1)}</td>
                    <td className="cell-sub">{c.last_visit ?? "—"}</td>
                    <td className="num">{c.attendance_pct == null ? "—" : `${c.attendance_pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => downloadCsv(
              [
                ["Клиент", "Посещений", "Пропусков", "В неделю", "Последнее посещение", "Посещаемость %"],
                ...byChild.map((c) => [
                  c.full_name, String(c.visits), String(c.misses),
                  String(c.per_week), c.last_visit ?? "", String(c.attendance_pct ?? ""),
                ]),
              ],
              `attendance-${from}-${to}.csv`,
            )}
          >
            <Icon name="download" /> {t("Скачать посещаемость CSV", "Катышуу CSV")}
          </button>
        </>
      )}

      {/* ТЗ §11.3: заполненность секций */}
      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("Заполненность секций", "Секциялардын толуктугу")}</h3>
      {sectionLoad.length === 0 ? (
        <EmptyState title={t("Нет активных групп", "Активдүү топтор жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Секция", "Секция")}</th>
                <th className="num">{t("Групп", "Топ")}</th>
                <th className="num">{t("Занято", "Ээленген")}</th>
                <th className="num">{t("Мест", "Орун")}</th>
                <th className="num">{t("Заполнено", "Толуктук")}</th>
              </tr>
            </thead>
            <tbody>
              {sectionLoad.map((r) => (
                <tr key={r.section_id}>
                  <td>{lang === "ru" ? r.name_ru : r.name_ky}</td>
                  <td className="num">{r.groups_count}</td>
                  <td className="num">{r.enrolled}</td>
                  <td className="num">{r.capacity}</td>
                  <td className="num">{r.fill_pct == null ? "—" : `${r.fill_pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("Заморозки", "Тындыруулар")}</h3>
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        {t(`${freezes.filter((f) => f.status === "approved").length} активных, ${freezes.filter((f) => f.status === "pending").length} ожидают одобрения`,
           `${freezes.filter((f) => f.status === "approved").length} активдүү, ${freezes.filter((f) => f.status === "pending").length} күтүүдө`)}
      </div>

      <button className="btn btn--primary" onClick={exportDebtors} disabled={debtors.length === 0} style={{ marginTop: 16 }}>
        <Icon name="download" /> {t("Скачать должников CSV", "Карыздар CSV")}
      </button>
    </>
  );
};
