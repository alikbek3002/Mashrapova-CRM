import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { I18N, Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, formatCurrency } from "./common";
import { fmtD } from "../shared/lib/dates";
import {
  useStats, useLessons, useAttendanceBySection, useKidsBySection, useLivePayroll,
  useDirectorDashboard, useSectionLoad, useClientsAtRisk, useManagerKpi,
  type ClientAtRisk, type ManagerKpiRow,
} from "../shared/api/queries";
import { SellCardModal } from "../shared/ui/forms";
import { usePerm } from "../shared/auth/rbac";
import { Gate } from "../shared/auth/Gate";

// Локальная YYYY-MM-DD. toISOString() в UTC+N ночью отдаёт вчерашнюю дату —
// из-за этого в дашборде уроки не попадали в свою колонку (числа в шапке
// — локальные, а matching шёл по UTC-строке).
const ymdLocal = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const DashboardPage = ({ lang }: { lang: Lang }) => {
  const t = I18N[lang].admin;
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const stats = useStats();
  const canSeeFinance = usePerm("view_finance_reports");
  const [sellOpen, setSellOpen] = useState(false);
  // ТЗ §11.1 — дашборд директора.
  const { data: dash } = useDirectorDashboard();
  // Конверсия пробных и продления считает manager_kpi (§7.4) — тот же
  // источник, что на странице воронки, чтобы цифры не разъезжались.
  const period = useMemo(() => {
    const d = new Date();
    const iso = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    return {
      from: iso(new Date(d.getFullYear(), d.getMonth(), 1)),
      to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    };
  }, []);
  const { data: kpiRows = [] } = useManagerKpi(period.from, period.to);

  const funnel = useMemo(() => {
    const sum = (f: (r: ManagerKpiRow) => number) => kpiRows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
    const booked = sum((r) => r.trial_booked_total);
    const attended = sum((r) => r.trial_attended_total);
    const renewDue = sum((r) => r.renewals_due);
    const renewDone = sum((r) => r.renewals_done);
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
    return {
      booked, attended, renewDue, renewDone,
      trialPct: pct(attended, booked),
      renewalPct: pct(renewDone, renewDue),
    };
  }, [kpiRows]);

  // Динамика к прошлому периоду той же длины (её считает director_dashboard).
  const delta = (cur: number, prev: number): { text: string; up: boolean } | null => {
    if (!prev) return null;
    const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
    return { text: `${pct > 0 ? "+" : ""}${pct}%`, up: pct >= 0 };
  };

  const fmtSum = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}`;
    return `${n}`;
  };

  const s = stats.data;

  return (
    <>
      <PageHeader
        title={t.title}
        subtitle={`Академия Машрапова, Ош · ${new Date().toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}`}
        actions={
          <Gate perm="sell_cards">
            <button className="btn btn--primary" onClick={() => setSellOpen(true)}>
              <Icon name="plus" /> {tt("Продать абонемент", "Абонемент сатуу")}
            </button>
          </Gate>
        }
      />

      {/* ТЗ §11.1: выручка день / неделя / месяц с динамикой к прошлому
          периоду той же длины. Деньги — только тем, кому положено по §2.2. */}
      {canSeeFinance && (
        <div className="kpi-grid">
          <AdminKpi
            label={tt("Выручка за день", "Күндүк кирим")}
            value={dash ? <>{fmtSum(Number(dash.revenue_day))}<span className="unit">{Number(dash.revenue_day) >= 1_000_000 ? "" : "тыс. с"}</span></> : "—"}
            delta={dash ? (delta(Number(dash.revenue_day), Number(dash.revenue_day_prev))?.text ?? tt("вчера без выручки", "кечээ кирим жок")) : ""}
            deltaUp={dash ? delta(Number(dash.revenue_day), Number(dash.revenue_day_prev))?.up : undefined}
            deltaNeutral={!dash || !delta(Number(dash.revenue_day), Number(dash.revenue_day_prev))}
            labelDotColor="var(--green)"
            variant="accent"
          />
          <AdminKpi
            label={tt("Выручка за неделю", "Жумалык кирим")}
            value={dash ? <>{fmtSum(Number(dash.revenue_week))}<span className="unit">{Number(dash.revenue_week) >= 1_000_000 ? "" : "тыс. с"}</span></> : "—"}
            delta={dash ? (delta(Number(dash.revenue_week), Number(dash.revenue_week_prev))?.text ?? "—") : ""}
            deltaUp={dash ? delta(Number(dash.revenue_week), Number(dash.revenue_week_prev))?.up : undefined}
            deltaNeutral={!dash || !delta(Number(dash.revenue_week), Number(dash.revenue_week_prev))}
            labelDotColor="var(--green)"
          />
          <AdminKpi
            label={tt("Выручка за месяц", "Айлык кирим")}
            value={dash ? <>{fmtSum(Number(dash.revenue_month))}<span className="unit">{Number(dash.revenue_month) >= 1_000_000 ? "" : "тыс. с"}</span></> : "—"}
            delta={dash ? (delta(Number(dash.revenue_month), Number(dash.revenue_month_prev))?.text ?? "—") : ""}
            deltaUp={dash ? delta(Number(dash.revenue_month), Number(dash.revenue_month_prev))?.up : undefined}
            deltaNeutral={!dash || !delta(Number(dash.revenue_month), Number(dash.revenue_month_prev))}
            labelDotColor="var(--green)"
          />
          <AdminKpi
            label={tt("Новые клиенты за месяц", "Айдагы жаңы кардарлар")}
            value={dash ? String(dash.new_clients_month) : "—"}
            delta={dash ? (delta(Number(dash.new_clients_month), Number(dash.new_clients_month_prev))?.text ?? "—") : ""}
            deltaUp={dash ? delta(Number(dash.new_clients_month), Number(dash.new_clients_month_prev))?.up : undefined}
            deltaNeutral={!dash || !delta(Number(dash.new_clients_month), Number(dash.new_clients_month_prev))}
            labelDotColor="var(--blue)"
          />
        </div>
      )}

      <div className="kpi-grid">
        <AdminKpi
          label={t.kpi.activeKids}
          value={dash ? Number(dash.active_clients).toLocaleString("ru-RU") : (s ? s.activeKids.toLocaleString("ru-RU") : "—")}
          delta={s ? `${s.families} ${tt("семей", "үй-бүлө")} · ${s.coaches} ${tt("тренеров", "тренер")}` : ""}
          deltaNeutral
          labelDotColor="var(--blue)"
        />
        {/* Цель по ТЗ — больше 70% */}
        <AdminKpi
          label={tt("Запись → приход на пробную", "Жазылуу → сыноого келүү")}
          value={funnel.trialPct == null ? "—" : <>{funnel.trialPct}<span className="unit">%</span></>}
          delta={tt(`${funnel.attended} из ${funnel.booked} · цель > 70%`, `${funnel.booked} ичинен ${funnel.attended}`)}
          deltaNeutral
          labelDotColor={funnel.trialPct != null && funnel.trialPct > 70 ? "var(--green)" : "var(--red)"}
        />
        {/* Цель по ТЗ — больше 80% */}
        <AdminKpi
          label={tt("Продления: план и факт", "Узартуу: план жана факт")}
          value={funnel.renewalPct == null ? "—" : <>{funnel.renewalPct}<span className="unit">%</span></>}
          delta={tt(`${funnel.renewDone} из ${funnel.renewDue} · цель > 80%`, `${funnel.renewDue} ичинен ${funnel.renewDone}`)}
          deltaNeutral
          labelDotColor={funnel.renewalPct != null && funnel.renewalPct > 80 ? "var(--green)" : "var(--red)"}
        />
        <AdminKpi
          label={tt("Клиенты в зоне риска", "Тобокел зонасындагы кардарлар")}
          value={dash ? String(Number(dash.risk_no_visits) + Number(dash.risk_expiring_7)) : "—"}
          delta={dash
            ? tt(`${dash.risk_no_visits} не ходят · ${dash.risk_expiring_7} истекают`,
                 `${dash.risk_no_visits} келбейт · ${dash.risk_expiring_7} бүтөт`)
            : ""}
          deltaNeutral
          labelDotColor="var(--red)"
          variant="dark"
        />
      </div>

      <div className="dash-grid">
        <ClientsAtRiskCard lang={lang} />
        <SectionLoadCard lang={lang} />
      </div>

      <div className="dash-grid">
        <TopManagersCard lang={lang} rows={kpiRows} canSeeFinance={canSeeFinance} />
        <KidsBySectionCard lang={lang} />
      </div>

      <div className="dash-grid">
        <CoachPayrollCard lang={lang} />
        <AttendanceCard lang={lang} t={t} />
      </div>

      <div className="dash-grid">
        <ScheduleCard lang={lang} />
      </div>

      <SellCardModal open={sellOpen} onClose={() => setSellOpen(false)} lang={lang} />
    </>
  );
};

type KpiProps = {
  label: string;
  value: ReactNode;
  delta?: string;
  deltaUp?: boolean;
  deltaNeutral?: boolean;
  variant?: "accent" | "dark";
  labelDotColor?: string;
};

const AdminKpi = ({ label, value, delta, deltaUp, deltaNeutral, variant, labelDotColor }: KpiProps) => (
  <div className={`kpi ${variant === "accent" ? "kpi--accent" : variant === "dark" ? "kpi--dark" : ""}`}>
    <div className="kpi__label">
      <span className="dot" style={{ background: labelDotColor }} />
      {label}
    </div>
    <div className="kpi__value">{value}</div>
    {delta && (
      <span
        className={`kpi__delta ${deltaNeutral ? "" : deltaUp ? "kpi__delta--up" : "kpi__delta--down"}`}
        style={
          deltaNeutral
            ? { background: "rgba(255,255,255,.15)", color: variant === "dark" ? "rgba(255,255,255,.7)" : "var(--muted)" }
            : {}
        }
      >
        {deltaNeutral ? <Icon name="clock" size={12} stroke={2.2} /> : deltaUp ? "▲" : "▼"}
        {delta}
      </span>
    )}
  </div>
);

// =============================================================
// Kids per section — кол-во активных детей в каждой секции
// =============================================================
// =====================================================================
// ТЗ §11.1: клиенты в зоне риска — не приходили 10+ дней (флаг §4.5)
// или абонемент истекает через 7 дней. Два повода в одном списке, но с
// разными метками: звонки по ним разные.
// =====================================================================
const ClientsAtRiskCard = ({ lang }: { lang: Lang }) => {
  const { data = [], isLoading } = useClientsAtRisk(30);
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const noVisits = data.filter((r) => r.reason === "no_visits").length;
  const expiring = data.filter((r) => r.reason === "expiring").length;

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">
            <Icon name="warn" size={16} /> {tt("Клиенты в зоне риска", "Тобокел зонасында")}
          </div>
          <div className="card__subtitle">
            {tt(`${noVisits} не ходят · ${expiring} истекает абонемент`,
                `${noVisits} келбейт · ${expiring} абонементи бүтөт`)}
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="empty"><div className="empty__title">{tt("Загрузка…", "Жүктөлүүдө…")}</div></div>
      ) : data.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Никого в зоне риска", "Тобокелде эч ким жок")}</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.map((r: ClientAtRisk) => (
            <div key={`${r.child_id}-${r.reason}`}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: r.reason === "no_visits" ? "var(--red-600)" : "var(--yellow)",
              }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.full_name}
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {r.reason === "no_visits"
                  ? tt("не ходит 10+ дней", "10+ күн келбейт")
                  : tt(`до ${fmtD(r.card_end_date ?? "")}`, `${fmtD(r.card_end_date ?? "")} чейин`)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// =====================================================================
// ТЗ §11.1: заполненность групп в процентах по каждой секции.
// =====================================================================
const SectionLoadCard = ({ lang }: { lang: Lang }) => {
  const { data = [], isLoading } = useSectionLoad();
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const totalCap = data.reduce((a, r) => a + Number(r.capacity ?? 0), 0);
  const totalEnr = data.reduce((a, r) => a + Number(r.enrolled ?? 0), 0);

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">
            <Icon name="kids" size={16} /> {tt("Заполненность групп", "Топтордун толуктугу")}
          </div>
          <div className="card__subtitle">
            {totalCap > 0
              ? tt(`${totalEnr} из ${totalCap} мест · ${Math.round((totalEnr / totalCap) * 100)}%`,
                   `${totalCap} ичинен ${totalEnr} орун`)
              : tt("Нет активных групп", "Активдүү топтор жок")}
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="empty"><div className="empty__title">{tt("Загрузка…", "Жүктөлүүдө…")}</div></div>
      ) : data.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Нет данных", "Маалымат жок")}</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.map((r) => {
            const pct = r.fill_pct == null ? 0 : Number(r.fill_pct);
            // Перебор над вместимостью возможен: лимит группы жёсткий,
            // но §5.2 разрешает ручное превышение.
            const over = pct > 100;
            return (
              <div key={r.section_id}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span>{lang === "ru" ? r.name_ru : r.name_ky}</span>
                  <span style={{ color: over ? "var(--red-600)" : "var(--muted)" }}>
                    {r.enrolled}/{r.capacity} · {pct}%
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--bg-soft)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.min(100, pct)}%`, height: "100%",
                    background: over ? "var(--red-600)" : pct >= 80 ? "var(--green)" : "var(--blue)",
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// =====================================================================
// ТЗ §11.1: топ менеджеров по продажам и продлениям. Источник — тот же
// manager_kpi, что и на странице воронки, чтобы цифры совпадали.
// =====================================================================
const TopManagersCard = ({
  lang, rows, canSeeFinance,
}: { lang: Lang; rows: ManagerKpiRow[]; canSeeFinance: boolean }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const named = rows
    .filter((r) => r.manager_id && r.manager_name)
    .slice()
    .sort((a, b) => Number(b.sales_total) - Number(a.sales_total))
    .slice(0, 6);

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">
            <Icon name="parents" size={16} /> {tt("Топ менеджеров", "Мыкты менеджерлер")}
          </div>
          <div className="card__subtitle">{tt("Продажи и продления за месяц", "Айдагы сатуу жана узартуу")}</div>
        </div>
      </div>
      {!canSeeFinance ? (
        <div className="empty"><div className="empty__title">{tt("Доступно старшему менеджеру и выше", "Башкы менеджерден жогору")}</div></div>
      ) : named.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Нет данных за месяц", "Ай боюнча маалымат жок")}</div></div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tt("Менеджер", "Менеджер")}</th>
                <th className="num">{tt("Продаж", "Сатуу")}</th>
                <th className="num">{tt("Продления", "Узартуу")}</th>
              </tr>
            </thead>
            <tbody>
              {named.map((r) => (
                <tr key={r.manager_id!}>
                  <td>{r.manager_name}</td>
                  <td className="num">{r.sales_total || "—"}</td>
                  <td className="num">
                    {Number(r.renewals_due) > 0
                      ? `${Math.round((Number(r.renewals_done) / Number(r.renewals_due)) * 100)}%`
                      : "—"}
                    {Number(r.renewals_due) > 0 && (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        {" "}({r.renewals_done}/{r.renewals_due})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const KidsBySectionCard = ({ lang }: { lang: Lang }) => {
  const { data = [], isLoading } = useKidsBySection();
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const total = data.reduce((s, r) => s + r.count, 0);
  const max = data.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">
            <Icon name="user" size={16} /> {tt("Дети по секциям", "Балдар секциялар боюнча")}
          </div>
          <div className="card__subtitle">{tt(`Всего: ${total}`, `Жалпы: ${total}`)}</div>
        </div>
      </div>
      <div className="att-chart">
        {isLoading && <div className="empty"><div className="empty__title">{tt("Загрузка…", "Жүктөлүүдө…")}</div></div>}
        {!isLoading && data.length === 0 && <div className="empty"><div className="empty__title">{tt("Пока нет данных", "Маалымат жок")}</div></div>}
        {data.map((s) => {
          const pct = max ? Math.round((s.count / max) * 100) : 0;
          const color = s.color ?? "var(--blue)";
          return (
            <div key={s.id} className="att-bar">
              <div className="att-bar__name">
                <span className="section-dot" style={{ background: color }} />
                {lang === "ru" ? s.name_ru : s.name_ky}
              </div>
              <div className="att-bar__track">
                <div className="att-bar__fill" style={{ width: `${pct}%`, background: color }} />
              </div>
              <div className="att-bar__val">{s.count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// =============================================================
// Coach payroll — сколько каждый тренер уже заработал в этом месяце (live)
// =============================================================
const CoachPayrollCard = ({ lang }: { lang: Lang }) => {
  const { data = [], isLoading } = useLivePayroll();
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  // Сначала те, кто заработал сегодня, затем по месяцу.
  const sorted = [...data].sort((a, b) =>
    Number(b.today_amount ?? 0) - Number(a.today_amount ?? 0) || Number(b.actual_amount) - Number(a.actual_amount));
  const total = sorted.reduce((s, r) => s + Number(r.actual_amount), 0);
  const todayAmount = sorted.reduce((s, r) => s + Number(r.today_amount ?? 0), 0);
  const todayVisits = sorted.reduce((s, r) => s + Number(r.today_visits ?? 0), 0);
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">
            <Icon name="wallet" size={16} /> {tt("Зарплаты тренеров", "Тренерлердин ЭА")}
          </div>
          <div className="card__subtitle">
            {tt(`Сегодня · ${formatCurrency(todayAmount)} за ${todayVisits} детей · за месяц ${formatCurrency(total)}`,
                `Бүгүн · ${formatCurrency(todayAmount)} (${todayVisits} бала) · айга ${formatCurrency(total)}`)}
          </div>
        </div>
      </div>
      <div className="att-chart">
        {isLoading && <div className="empty"><div className="empty__title">{tt("Загрузка…", "Жүктөлүүдө…")}</div></div>}
        {!isLoading && sorted.length === 0 && <div className="empty"><div className="empty__title">{tt("Тренеров пока нет", "Тренерлер жок")}</div></div>}
        {sorted.map((r) => {
          const a = Number(r.actual_amount);
          const m = Number((r as any).max_amount ?? a + Number(r.projected_amount));
          const pct = m > 0 ? Math.round((a / m) * 100) : 0;
          return (
            <div key={r.coach_id} className="att-bar">
              <div className="att-bar__name">
                <span className="section-dot" style={{ background: "var(--green)" }} />
                {r.full_name ?? r.coach_id.slice(0, 8)}
              </div>
              <div className="att-bar__track" title={tt(`За месяц ${formatCurrency(a)} из потолка ${formatCurrency(m)}`, `Айга ${formatCurrency(a)} / ${formatCurrency(m)}`)}>
                <div className="att-bar__fill" style={{ width: `${pct}%`, background: "var(--green)" }} />
              </div>
              <div className="att-bar__val" style={{ whiteSpace: "nowrap" }}>
                <b style={{ color: "var(--green)" }}>{formatCurrency(Number(r.today_amount ?? 0))}</b>
                <span style={{ color: "var(--muted)", fontSize: 11 }}> · {Number(r.today_visits ?? 0)} {tt("дет.", "бала")}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// =============================================================
// Attendance by section — live
// =============================================================
const AttendanceCard = ({ lang, t }: { lang: Lang; t: typeof I18N["ru"]["admin"] }) => {
  const { data = [] } = useAttendanceBySection();
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">{t.attendance.title}</div>
          <div className="card__subtitle">{lang === "ru" ? "По данным за 30 дней" : "30 күндүн ичинде"}</div>
        </div>
      </div>
      <div className="att-chart">
        {data.length === 0 && <div className="empty"><div className="empty__title">{lang === "ru" ? "Пока нет данных" : "Маалымат жок"}</div></div>}
        {data.map((a) => (
          <div key={a.id} className="att-bar">
            <div className="att-bar__name">
              <span className="section-dot" style={{ background: "var(--blue)" }} />
              {a.name_ru}
            </div>
            <div className="att-bar__track">
              <div className="att-bar__fill" style={{ width: `${a.pct}%`, background: a.pct >= 85 ? "var(--green)" : "var(--blue)" }} />
            </div>
            <div className="att-bar__val">{a.pct}%</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// =============================================================
// Schedule card — live (this week's lessons)
// =============================================================
const ScheduleCard = ({ lang }: { lang: Lang }) => {
  const t = I18N[lang].admin;
  const wd = I18N[lang].weekdays;

  // Compute this week (Mon..Sun)
  const today = new Date();
  const day = (today.getDay() + 6) % 7; // 0 = Mon
  const monday = new Date(today);
  monday.setDate(today.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i); return d;
  });

  const { data: lessons = [] } = useLessons({ from: ymdLocal(monday), to: ymdLocal(sunday) });

  // Базовый диапазон 9–21 — компактный для дашборда. Расширяем по фактическим
  // занятиям: утренние группы (например, 9:00) и поздние (21:00+) должны
  // быть видны без скрытия.
  const DEFAULT_START = 9, DEFAULT_END = 21;
  let hoursStart = DEFAULT_START, hoursEnd = DEFAULT_END;
  for (const l of lessons) {
    const sh = Number(String(l.start_time).split(":")[0]);
    if (Number.isFinite(sh)) {
      if (sh < hoursStart) hoursStart = sh;
      const endH = sh + Math.ceil((l.duration_min ?? 60) / 60);
      if (endH > hoursEnd) hoursEnd = endH;
    }
  }
  const hours: number[] = [];
  for (let h = hoursStart; h < hoursEnd; h++) hours.push(h);
  const todayIdx = day;

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title"><Icon name="calendar" size={16} /> {t.calendar.title}</div>
          <div className="card__subtitle">{fmtD(ymdLocal(monday))} — {fmtD(ymdLocal(sunday))}</div>
        </div>
      </div>
      <div className="cal">
        <div className="cal__grid" style={{ marginBottom: 4 }}>
          <div />
          {wd.map((d, i) => (
            <div key={i} className={`cal__head ${i === todayIdx ? "is-today" : ""}`}>
              {d}
              <span className="d">{dates[i].getDate()}</span>
            </div>
          ))}
        </div>
        <div className="cal__grid" style={{ position: "relative" }}>
          {hours.map((h) => (
            <Row key={h} h={h} dates={dates} lessons={lessons} lang={lang} />
          ))}
        </div>
      </div>
    </div>
  );
};

const Row = ({ h, dates, lessons, lang }: {
  h: number; dates: Date[]; lessons: any[]; lang: Lang;
}) => {
  return (
    <>
      <div className="cal__hour">{h}:00</div>
      {[0, 1, 2, 3, 4, 5, 6].map((di) => {
        const dateStr = ymdLocal(dates[di]);
        const cellLessons = lessons.filter((l) => l.date === dateStr && Number(l.start_time.split(":")[0]) === h);
        return (
          <div key={di} className="cal__cell">
            {cellLessons.map((l) => {
              const startMin = Number(l.start_time.split(":")[1] ?? "0");
              const top = (startMin / 60) * 28;
              const height = Math.max(20, (l.duration_min / 60) * 28 - 2);
              const sec = l.group?.section;
              const bg = sec?.color ?? "var(--blue)";
              const title = sec ? (lang === "ru" ? sec.name_ru : sec.name_ky) : (l.group?.name ?? "—");
              return (
                <div
                  key={l.id}
                  className={`cal__event lesson-status--${l.status}`}
                  style={{ top: `${top}px`, height: `${height}px`, background: l.status === "scheduled" ? bg + "22" : undefined, color: l.status === "scheduled" ? "var(--ink-2)" : undefined }}
                  title={`${title}\n${l.start_time} · ${l.duration_min}мин`}
                >
                  {title}
                  <small>{l.coach?.full_name ?? ""}</small>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
};
