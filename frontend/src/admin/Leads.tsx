import { useEffect, useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState } from "./common";
import { useLeads, useGroups, useOrgSettings, useManagerKpi, type LeadWithSection, type ManagerKpiRow } from "../shared/api/queries";
import { useUpdateLead } from "../shared/api/mutations";
import { AddLeadModal } from "../shared/ui/forms";
import { Modal, Field } from "../shared/ui/Modal";
import type { LeadStage } from "../shared/types/database";
import { Gate } from "../shared/auth/Gate";
import { usePerm } from "../shared/auth/rbac";
import {
  FUNNEL_STAGES, DEAD_END_STAGES, DEFAULT_SLA,
  stageLabel, stageTone, sourceLabel, leadTask, taskLabel, humanMinutes,
  type LeadSla,
} from "./leadFunnel";

const sourceStripe: Record<string, string> = {
  target: "var(--red)",
  referral: "var(--green)",
  direct: "var(--blue)",
  other: "var(--muted-2)",
};

// =====================================================================
// Запись на пробную (ТЗ §8.2: «Фиксируется дата/время, секция, тренер»).
// Секция и тренер берутся из выбранной группы — отдельно их вводить
// незачем, группа их уже однозначно задаёт.
// =====================================================================
const BookTrialModal = ({
  lead, onClose, lang,
}: { lead: LeadWithSection; onClose: () => void; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const upd = useUpdateLead();
  const { data: groups = [] } = useGroups();
  const [when, setWhen] = useState(lead.trial_at ? lead.trial_at.slice(0, 16) : "");
  const [groupId, setGroupId] = useState(lead.trial_group_id ?? "");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!when) {
      setErr(t("Укажите дату и время пробной", "Сыноонун күнүн жана убактысын коюңуз"));
      return;
    }
    const group = groups.find((g) => g.id === groupId) as { coach_id?: string } | undefined;
    try {
      await upd.mutateAsync({
        id: lead.id,
        patch: {
          stage: "trial_booked",
          trial_at: new Date(when).toISOString(),
          trial_group_id: groupId || null,
          trial_coach_id: group?.coach_id ?? null,
          // Перезаписываем — при переносе пробной напоминания должны
          // уйти заново, иначе клиент останется без предупреждения.
          reminder_24h_at: null,
          reminder_2h_at: null,
          no_show_task_at: null,
        },
      });
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open onClose={onClose} title={t("Запись на пробную", "Сыноого жазуу")}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        <b>{lead.child_name ?? lead.parent_name ?? "—"}</b>
        {lead.phone && <span style={{ color: "var(--muted)" }}> · {lead.phone}</span>}
      </div>
      <Field label={t("Дата и время", "Күнү жана убактысы")}>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label={t("Группа (секция и тренер)", "Топ (секция жана тренер)")}>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">—</option>
          {groups.map((g) => {
            const row = g as { id: string; name: string; section?: { name_ru: string; name_ky: string } | null; coach?: { full_name: string } | null };
            const sec = row.section ? (lang === "ru" ? row.section.name_ru : row.section.name_ky) : "";
            return (
              <option key={row.id} value={row.id}>
                {[sec, row.name, row.coach?.full_name].filter(Boolean).join(" · ")}
              </option>
            );
          })}
        </select>
      </Field>
      <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
        {t("Напоминания за 24 часа и за 2 часа до пробной система поставит сама. Если клиент не придёт — через 3 часа появится задача позвонить.",
           "Сыноого 24 саат жана 2 саат калганда эскертүүнү система өзү коёт.")}
      </div>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={upd.isPending}>
          {upd.isPending ? "…" : t("Записать", "Жазуу")}
        </button>
      </div>
    </Modal>
  );
};

// =====================================================================
// Отказ — причина обязательна, иначе в отчёте нечего анализировать.
// =====================================================================
const LostLeadModal = ({
  lead, onClose, lang,
}: { lead: LeadWithSection; onClose: () => void; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const upd = useUpdateLead();
  const [reason, setReason] = useState(lead.lost_reason ?? "");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!reason.trim()) {
      setErr(t("Укажите причину отказа", "Баш тартуу себебин жазыңыз"));
      return;
    }
    try {
      await upd.mutateAsync({ id: lead.id, patch: { stage: "lost", lost_reason: reason.trim() } });
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open onClose={onClose} title={t("Отказ", "Баш тартуу")}>
      <Field label={t("Причина", "Себеби")}>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={t("Дорого / далеко / выбрали другой клуб…", "Кымбат / алыс / башка клуб…")} />
      </Field>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={upd.isPending}>
          {upd.isPending ? "…" : t("Сохранить", "Сактоо")}
        </button>
      </div>
    </Modal>
  );
};

export const LeadsPage = ({ lang }: { lang: Lang }) => {
  const ru = lang === "ru";
  const tt = (r: string, k: string) => (ru ? r : k);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "todo" | LeadStage>("todo");
  const [open, setOpen] = useState(false);
  const [booking, setBooking] = useState<LeadWithSection | null>(null);
  const [losing, setLosing] = useState<LeadWithSection | null>(null);
  const { data: leads = [], isLoading, error } = useLeads();
  const { data: settings } = useOrgSettings();
  const upd = useUpdateLead();
  const canEdit = usePerm("edit_leads");

  // Просрочка идёт в минутах, поэтому пересчитываем раз в минуту —
  // иначе открытая вкладка показывает время открытия страницы.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const sla: LeadSla = useMemo(() => ({
    firstContactMin: settings?.lead_first_contact_min ?? DEFAULT_SLA.firstContactMin,
    escalationMin: settings?.lead_escalation_min ?? DEFAULT_SLA.escalationMin,
    noShowHours: settings?.lead_no_show_hours ?? DEFAULT_SLA.noShowHours,
  }), [settings]);

  const tasks = useMemo(
    () => new Map(leads.map((l) => [l.id, leadTask(l, sla, now)])),
    [leads, sla, now],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length, todo: 0 };
    for (const l of leads) {
      c[l.stage] = (c[l.stage] ?? 0) + 1;
      if (tasks.get(l.id)) c.todo += 1;
    }
    return c;
  }, [leads, tasks]);

  // KPI §7.4 за текущий месяц. Период — календарный месяц, а не «по
  // фильтру списка»: иначе цифра прыгала бы от того, какую вкладку
  // открыл менеджер.
  const period = useMemo(() => {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const iso = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    return { from: iso(first), to: iso(last) };
  }, []);
  const { data: kpiRows = [] } = useManagerKpi(period.from, period.to);

  // Итог по клубу = сумма строк, включая строку без ответственного.
  const kpi = useMemo(() => {
    const sum = (f: (r: ManagerKpiRow) => number) => kpiRows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
    const contacted = sum((r) => r.first_contact_total);
    // Средняя скорость по клубу — среднее, взвешенное числом контактов,
    // а не среднее из средних: у менеджера с двумя лидами и у менеджера
    // с сотней вес разный.
    const weighted = kpiRows.reduce(
      (a, r) => a + (Number(r.avg_first_contact_min) || 0) * (Number(r.first_contact_total) || 0), 0);
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
    const total = sum((r) => r.leads_total);
    const booked = sum((r) => r.trial_booked_total);
    const attended = sum((r) => r.trial_attended_total);
    const converted = sum((r) => r.converted_total);
    const renewDue = sum((r) => r.renewals_due);
    const renewDone = sum((r) => r.renewals_done);
    const sales = sum((r) => r.sales_total);
    const days = Math.max(
      1,
      Math.round((new Date(period.to).getTime() - new Date(period.from).getTime()) / 86400000) + 1,
    );
    return {
      total, contacted, booked, attended, converted, renewDue, renewDone, sales,
      avgFirstContact: contacted > 0 ? weighted / contacted : null,
      inSla: sum((r) => r.within_sla_total),
      bookedPct: pct(booked, total),
      attendedPct: pct(attended, booked),
      convertedPct: pct(converted, attended),
      renewalPct: pct(renewDone, renewDue),
      salesPerDay: sales / days,
    };
  }, [kpiRows, period]);

  const rows = useMemo(() => {
    let list = leads;
    if (filter === "todo") list = list.filter((l) => tasks.get(l.id));
    else if (filter !== "all") list = list.filter((l) => l.stage === filter);
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter((l) =>
      (l.child_name ?? "").toLowerCase().includes(qq) ||
      (l.parent_name ?? "").toLowerCase().includes(qq) ||
      (l.phone ?? "").includes(qq) ||
      (l.instagram ?? "").toLowerCase().includes(qq)
    );
    // Сначала то, что горит: просроченное первым и по убыванию просрочки.
    return [...list].sort((a, b) => {
      const ta = tasks.get(a.id);
      const tb = tasks.get(b.id);
      if (!!ta !== !!tb) return ta ? -1 : 1;
      if (ta && tb) return tb.overdueMin - ta.overdueMin;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [q, filter, leads, tasks]);

  const setStage = (id: string, stage: LeadStage) => upd.mutate({ id, patch: { stage } });

  // Шесть метрик ТЗ §7.4. `ok` — попадание в целевое значение из ТЗ;
  // где цели нет, поле не задаём и плитка остаётся нейтральной.
  const kpiTiles: Array<{ label: string; value: string; hint: string; ok?: boolean | null }> = [
    {
      label: tt("Скорость первого контакта", "Биринчи байланыш ылдамдыгы"),
      value: kpi.avgFirstContact == null ? "—" : `${kpi.avgFirstContact.toFixed(1)} ${tt("мин", "мүн")}`,
      hint: tt(`цель меньше ${sla.firstContactMin} мин · в норме ${kpi.inSla} из ${kpi.contacted}`,
               `максат ${sla.firstContactMin} мүн · ${kpi.contacted} ичинен ${kpi.inSla}`),
      ok: kpi.avgFirstContact == null ? null : kpi.avgFirstContact < sla.firstContactMin,
    },
    {
      label: tt("Лид → запись на пробную", "Арыз → сыноого жазылуу"),
      value: kpi.bookedPct == null ? "—" : `${kpi.bookedPct}%`,
      hint: tt(`${kpi.booked} из ${kpi.total}`, `${kpi.total} ичинен ${kpi.booked}`),
    },
    {
      label: tt("Запись → приход", "Жазылуу → келүү"),
      value: kpi.attendedPct == null ? "—" : `${kpi.attendedPct}%`,
      hint: tt(`${kpi.attended} из ${kpi.booked} · цель больше 70%`, `${kpi.booked} ичинен ${kpi.attended}`),
      ok: kpi.attendedPct == null ? null : kpi.attendedPct > 70,
    },
    {
      label: tt("Пробная → продажа", "Сыноо → сатуу"),
      value: kpi.convertedPct == null ? "—" : `${kpi.convertedPct}%`,
      hint: tt(`${kpi.converted} из ${kpi.attended}`, `${kpi.attended} ичинен ${kpi.converted}`),
    },
    {
      label: tt("Конверсия продлений", "Узартуу конверсиясы"),
      value: kpi.renewalPct == null ? "—" : `${kpi.renewalPct}%`,
      hint: tt(`${kpi.renewDone} из ${kpi.renewDue} · цель больше 80%`,
               `${kpi.renewDue} ичинен ${kpi.renewDone}`),
      ok: kpi.renewalPct == null ? null : kpi.renewalPct > 80,
    },
    {
      label: tt("Продаж в день", "Күнүнө сатуу"),
      value: kpi.sales > 0 ? kpi.salesPerDay.toFixed(1) : "—",
      hint: tt(`${kpi.sales} продаж за месяц`, `айына ${kpi.sales} сатуу`),
    },
  ];

  // Строки по менеджерам: ТЗ §7.4 требует личный показатель каждого.
  // Безымянная строка — записи без ответственного, в общий итог она
  // входит, но в таблице персональных показателей ей не место.
  const namedKpiRows = kpiRows.filter((r) => r.manager_id && r.manager_name);
  const pctOf = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

  return (
    <>
      <PageHeader
        title={tt("Воронка лидов", "Арыздар каналы")}
        subtitle={isLoading
          ? tt("Загрузка…", "Жүктөлүүдө…")
          : tt(`${leads.length} лидов · ${counts.todo} требуют действия`,
               `${leads.length} арыз · ${counts.todo} аракет талап кылат`)}
        actions={
          <Gate perm="edit_leads">
            <button className="btn btn--primary" onClick={() => setOpen(true)}>
              <Icon name="plus" /> {tt("Добавить лид", "Арыз кошуу")}
            </button>
          </Gate>
        }
      />

      {/* KPI менеджеров ТЗ §7.4 — шесть метрик за текущий месяц */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: 11, color: "var(--muted)", textTransform: "uppercase",
          letterSpacing: 0.04, marginBottom: 10,
        }}>
          {tt("KPI за текущий месяц", "Ушул айдын KPI")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          {kpiTiles.map((k) => (
            <div key={k.label}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.04 }}>
                {k.label}
              </div>
              <div style={{
                fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", lineHeight: 1.2,
                color: k.ok == null ? undefined : k.ok ? "var(--green-ink, var(--ink))" : "var(--red-600)",
              }}>
                {k.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{k.hint}</div>
            </div>
          ))}
        </div>

        {namedKpiRows.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>
              {tt("По менеджерам", "Менеджерлер боюнча")} · {namedKpiRows.length}
            </summary>
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{tt("Менеджер", "Менеджер")}</th>
                    <th className="num">{tt("Лидов", "Арыз")}</th>
                    <th className="num">{tt("1-й контакт", "1-байланыш")}</th>
                    <th className="num">{tt("Лид → запись", "Арыз → жазылуу")}</th>
                    <th className="num">{tt("Запись → приход", "Жазылуу → келүү")}</th>
                    <th className="num">{tt("Пробная → продажа", "Сыноо → сатуу")}</th>
                    <th className="num">{tt("Продления", "Узартуу")}</th>
                    <th className="num">{tt("Продаж в день", "Күнүнө сатуу")}</th>
                  </tr>
                </thead>
                <tbody>
                  {namedKpiRows.map((r: ManagerKpiRow) => (
                    <tr key={r.manager_id!}>
                      <td>{r.manager_name}</td>
                      <td className="num">{r.leads_total || "—"}</td>
                      <td className="num" style={{
                        color: r.avg_first_contact_min == null ? undefined
                          : Number(r.avg_first_contact_min) < sla.firstContactMin
                            ? "var(--green-ink, var(--ink))" : "var(--red-600)",
                      }}>
                        {r.avg_first_contact_min == null
                          ? "—"
                          : `${Number(r.avg_first_contact_min).toFixed(1)} ${tt("мин", "мүн")}`}
                      </td>
                      <td className="num">{pctOf(r.trial_booked_total, r.leads_total)}</td>
                      <td className="num">{pctOf(r.trial_attended_total, r.trial_booked_total)}</td>
                      <td className="num">{pctOf(r.converted_total, r.trial_attended_total)}</td>
                      <td className="num">
                        {pctOf(r.renewals_done, r.renewals_due)}
                        {r.renewals_due > 0 && (
                          <span style={{ color: "var(--muted)", fontSize: 11 }}>
                            {" "}({r.renewals_done}/{r.renewals_due})
                          </span>
                        )}
                      </td>
                      <td className="num">{r.sales_total > 0 ? Number(r.sales_per_day).toFixed(1) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder={tt("Имя, телефон, Instagram…", "Аты, телефон, Instagram…")} />
          <div className="tabs" style={{ flexWrap: "wrap" }}>
            <button className={`tabs__btn ${filter === "todo" ? "is-active" : ""}`} onClick={() => setFilter("todo")}>
              {tt("Требуют действия", "Аракет керек")}{counts.todo ? ` · ${counts.todo}` : ""}
            </button>
            <button className={`tabs__btn ${filter === "all" ? "is-active" : ""}`} onClick={() => setFilter("all")}>
              {tt("Все", "Баары")} · {counts.all}
            </button>
            {[...FUNNEL_STAGES, ...DEAD_END_STAGES].map((f) => (
              <button key={f} className={`tabs__btn ${filter === f ? "is-active" : ""}`} onClick={() => setFilter(f)}>
                {stageLabel(f, ru)}{counts[f] ? ` · ${counts[f]}` : ""}
              </button>
            ))}
          </div>
        </div>

        {error ? <EmptyState title={tt("Ошибка", "Ката")} hint={error.message} /> :
          isLoading ? <EmptyState title={tt("Загрузка…", "Жүктөлүүдө…")} /> :
          rows.length === 0 ? (
            <EmptyState
              title={filter === "todo" ? tt("Всё отработано", "Баары аткарылды") : tt("Лидов нет", "Арыздар жок")}
              hint={filter === "todo"
                ? tt("Просроченных контактов и задач по пробным нет.", "Кечиктирилген байланыштар жок.")
                : undefined}
            />
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{tt("Ребёнок", "Бала")}</th>
                    <th>{tt("Контакты", "Байланыш")}</th>
                    <th>{tt("Источник", "Булак")}</th>
                    <th>{tt("Этап", "Этап")}</th>
                    <th>{tt("Задача", "Тапшырма")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => {
                    const task = tasks.get(l.id);
                    const tone = stageTone(l.stage);
                    return (
                      <tr key={l.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ background: sourceStripe[l.source ?? "other"] ?? "var(--muted-2)", width: 4, height: 36, borderRadius: 2 }} />
                            <div>
                              <div className="cell-main">{l.child_name ?? "—"}</div>
                              <div className="cell-sub">
                                {l.child_age != null && `${l.child_age} ${tt("лет", "жаш")}`}
                                {l.section && ` · ${ru ? l.section.name_ru : l.section.name_ky}`}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="cell-sub">{l.parent_name ?? "—"}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>
                            {l.phone ?? ""}
                            {l.instagram && <span> · @{l.instagram}</span>}
                          </div>
                        </td>
                        <td style={{ color: "var(--muted)", fontSize: 12 }}>{sourceLabel(l.source, ru)}</td>
                        <td>
                          <span style={{
                            background: tone.bg, color: tone.fg, padding: "4px 10px",
                            borderRadius: "var(--r-pill)", fontSize: 11, fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}>
                            {stageLabel(l.stage, ru)}
                          </span>
                          {l.trial_at && (l.stage === "trial_booked" || l.stage === "trial_attended") && (
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                              {new Date(l.trial_at).toLocaleString(ru ? "ru-RU" : "ky-KG", {
                                day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                              })}
                            </div>
                          )}
                          {l.stage === "lost" && l.lost_reason && (
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{l.lost_reason}</div>
                          )}
                        </td>
                        <td>
                          {task ? (
                            <div style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              fontSize: 11, fontWeight: 600,
                              color: task.escalated ? "var(--red-600)" : "var(--yellow-ink)",
                            }}>
                              <span style={{
                                width: 6, height: 6, borderRadius: "50%",
                                background: task.escalated ? "var(--red-600)" : "var(--yellow)",
                              }} />
                              {taskLabel(task, ru)}
                              {task.kind === "first_contact_overdue" && (
                                <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                                  +{humanMinutes(task.overdueMin, ru)}
                                  {task.escalated && ` · ${tt("эскалация", "эскалация")}`}
                                </span>
                              )}
                              {task.kind === "trial_reminder" && (
                                <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                                  {tt("через", "калды")} {humanMinutes(-task.overdueMin, ru)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right", width: 1 }}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
                            {l.phone && (
                              <>
                                <a className="icon-btn" title="WhatsApp" target="_blank" rel="noreferrer"
                                  href={`https://wa.me/${l.phone.replace(/[^0-9]/g, "")}`}>
                                  <Icon name="whatsapp" />
                                </a>
                                <a className="icon-btn" title={tt("Позвонить", "Чалуу")} href={`tel:${l.phone}`}>
                                  <Icon name="phone" />
                                </a>
                              </>
                            )}
                            {canEdit && (
                              <>
                                {l.stage === "new" && (
                                  <button className="btn" style={{ padding: "6px 10px", fontSize: 12 }}
                                    title={tt("Отметить, что связались — останавливает счётчик норматива", "")}
                                    onClick={() => setStage(l.id, "contacted")} disabled={upd.isPending}>
                                    {tt("Связались", "Байланыштык")}
                                  </button>
                                )}
                                {(l.stage === "new" || l.stage === "contacted" || l.stage === "waiting" ||
                                  l.stage === "no_show" || l.stage === "trial_booked") && (
                                  <button className="btn" style={{ padding: "6px 10px", fontSize: 12 }}
                                    onClick={() => setBooking(l)}>
                                    {l.stage === "trial_booked" ? tt("Перенести", "Жылдыруу") : tt("На пробную", "Сыноого")}
                                  </button>
                                )}
                                {l.stage === "trial_booked" && (
                                  <>
                                    <button className="btn btn--primary" style={{ padding: "6px 10px", fontSize: 12 }}
                                      onClick={() => setStage(l.id, "trial_attended")} disabled={upd.isPending}>
                                      {tt("Пришёл", "Келди")}
                                    </button>
                                    <button className="btn btn--ghost" style={{ padding: "6px 10px", fontSize: 12 }}
                                      onClick={() => setStage(l.id, "no_show")} disabled={upd.isPending}>
                                      {tt("Не пришёл", "Келген жок")}
                                    </button>
                                  </>
                                )}
                                {l.stage === "trial_attended" && (
                                  <button className="btn btn--primary" style={{ padding: "6px 10px", fontSize: 12 }}
                                    onClick={() => setStage(l.id, "converted")} disabled={upd.isPending}>
                                    {tt("Купил", "Сатып алды")}
                                  </button>
                                )}
                                {l.stage !== "converted" && l.stage !== "lost" && (
                                  <button className="icon-btn" title={tt("Отказ", "Баш тартуу")}
                                    onClick={() => setLosing(l)}>
                                    <Icon name="x" size={14} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <AddLeadModal open={open} onClose={() => setOpen(false)} lang={lang} />
      {booking && <BookTrialModal lead={booking} onClose={() => setBooking(null)} lang={lang} />}
      {losing && <LostLeadModal lead={losing} onClose={() => setLosing(null)} lang={lang} />}
    </>
  );
};
