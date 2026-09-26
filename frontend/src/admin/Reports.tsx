import { useState, useMemo } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState, formatCurrency } from "./common";
import {
  usePayments, useChildren, useCards, usePayroll, useAttendanceBySection, useFreezes,
} from "../shared/api/queries";
import { usePerm } from "../shared/auth/rbac";
import { DateInput } from "../shared/ui/DateInput";
import { SkeletonRows } from "../shared/ui/Skeleton";

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
          <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{t("По", "Чейин")}</span>
          <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
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
        <SkeletonRows />
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
                  <th>{t("Статус", "Абалы")}</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id ?? p.coach_id}>
                    <td>{p.coach?.full_name ?? p.coach_id.slice(0, 8)}</td>
                    <td className="num">{formatCurrency(Number(p.computed_amount))}</td>
                    <td className="num">{Number(p.manual_adjustment) !== 0 ? formatCurrency(Number(p.manual_adjustment)) : "—"}</td>
                    <td className="num"><b>{formatCurrency(Number(p.computed_amount) + Number(p.manual_adjustment))}</b></td>
                    <td>{p.status}</td>
                  </tr>
                ))}
                <tr>
                  <td><b>{t("Итого", "Жалпы")}</b></td>
                  <td colSpan={2}></td>
                  <td className="num"><b>{formatCurrency(total)}</b></td>
                  <td></td>
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

// ---------- Ops tab (attendance + cards) ----------
const OpsTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: attBySec = [] } = useAttendanceBySection();
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

      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("Посещаемость по секциям (30 дней)", "30 күн боюнча катышуу")}</h3>
      {attBySec.length === 0 ? (
        <EmptyState title={t("Нет данных", "Маалымат жок")} />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead><tr><th>{t("Секция", "Секция")}</th><th className="num">{t("Посещ. %", "Катышуу %")}</th></tr></thead>
            <tbody>
              {attBySec.map((s) => (
                <tr key={s.id}>
                  <td>{s.name_ru}</td>
                  <td className="num">{s.pct}%</td>
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
