import { useState } from "react";
import type { ReactNode } from "react";
import { I18N, Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, formatCurrency } from "./common";
import { fmtD } from "../shared/lib/dates";
import { useStats, useLessons, useAttendanceBySection, useKidsBySection, useLivePayroll } from "../shared/api/queries";
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
        subtitle={`Uniqum Sport, Бишкек · ${new Date().toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}`}
        actions={
          <Gate perm="sell_cards">
            <button className="btn btn--primary" onClick={() => setSellOpen(true)}>
              <Icon name="plus" /> {tt("Продать абонемент", "Абонемент сатуу")}
            </button>
          </Gate>
        }
      />

      <div className="kpi-grid">
        <AdminKpi
          label={t.kpi.activeKids}
          value={s ? s.activeKids.toLocaleString("ru-RU") : "—"}
          delta={s ? `${s.families} ${tt("семей", "үй-бүлө")} · ${s.coaches} ${tt("тренеров", "тренер")}` : ""}
          deltaNeutral
          labelDotColor="var(--blue)"
        />
        {canSeeFinance ? (
          <AdminKpi
            label={tt("Выручка, 30 дней", "Кирим, 30 күн")}
            value={s ? <>{fmtSum(s.revenue30d)}<span className="unit">{s.revenue30d >= 1_000_000 ? "" : "тыс. с"}</span></> : "—"}
            delta={s ? tt(`${s.cardsActive} активных карт`, `${s.cardsActive} активдүү карта`) : ""}
            deltaNeutral
            labelDotColor="var(--green)"
            variant="accent"
          />
        ) : (
          <AdminKpi
            label={tt("Активные абонементы", "Активдүү абонементтер")}
            value={s ? s.cardsActive.toLocaleString("ru-RU") : "—"}
            delta={s ? tt(`${s.cardsExpiring.length} истекают на этой неделе`, `${s.cardsExpiring.length} ушул жумада бүтөт`) : ""}
            deltaNeutral
            labelDotColor="var(--green)"
            variant="accent"
          />
        )}
        <AdminKpi
          label={t.kpi.attendance}
          value={s ? <>{s.attendancePct}<span className="unit">%</span></> : "—"}
          delta={tt("за 30 дней", "30 күндө")}
          deltaNeutral
          labelDotColor="var(--ink)"
          variant="dark"
        />
        <AdminKpi
          label={t.kpi.expiring}
          value={s ? `${s.cardsExpiring.length}` : "—"}
          delta={s && s.cardsExpiring.length ? tt("звонят на этой неделе", "ушул жумада чалат") : tt("на этой неделе", "ушул жумада")}
          deltaNeutral
          labelDotColor="var(--red)"
        />
      </div>

      <div className="dash-grid">
        <KidsBySectionCard lang={lang} />
        <CoachPayrollCard lang={lang} />
      </div>

      <div className="dash-grid">
        <ScheduleCard lang={lang} />
        <AttendanceCard lang={lang} t={t} />
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
