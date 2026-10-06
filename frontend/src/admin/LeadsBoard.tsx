// Канбан лидов — как воронка в amoCRM/Kommo: колонка на этап, карточка на
// сделку, переключатель воронок. Колонки берутся из kommo_statuses (этапы
// Kommo в их порядке); лиды без сделки в Kommo — отдельной «воронкой» по
// этапам ERP. Этап сделки ведёт Kommo, поэтому карточку не перетаскиваем:
// клик открывает сделку в Kommo.
import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import type { LeadWithSection } from "../shared/api/queries";
import type { KommoStatus, LeadStage } from "../shared/types/database";
import {
  FUNNEL_STAGES, DEAD_END_STAGES, stageLabel, stageTone, channelLabel, taskLabel, humanMinutes,
  type LeadTask,
} from "./leadFunnel";
import { formatCurrency } from "./common";

const PAGE = 30;
const ERP_PIPELINE = "erp";

type Column = { key: string; title: string; stage: LeadStage; leads: LeadWithSection[] };

const pipelineTitle = (name: string, ru: boolean) =>
  name === "Pipeline" ? (ru ? "Основная воронка" : "Негизги воронка") : name;

const statusTitle = (s: KommoStatus, ru: boolean) => {
  if (s.status_id === 142) return ru ? "Успешно реализовано" : "Ийгиликтүү бүттү";
  if (s.status_id === 143) return ru ? "Закрыто и не реализовано" : "Жабылды, ишке ашкан жок";
  return s.status_name;
};

const stripe = (stage: LeadStage) => {
  switch (stage) {
    case "new": return "var(--muted-2)";
    // --blue в теме Академии — фирменный красный, поэтому синий задан явно.
    case "contacted": return "oklch(0.62 0.14 245)";
    case "trial_booked": case "trial_attended": return "var(--yellow)";
    case "converted": return "var(--green, #16a34a)";
    case "no_show": case "lost": return "var(--red)";
    default: return "var(--muted-2)";
  }
};

// 1 сделка, 2 сделки, 5 сделок; по-кыргызски форма одна.
const dealsWord = (n: number, ru: boolean) => {
  if (!ru) return "бүтүм";
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "сделка";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "сделки";
  return "сделок";
};

const shortDate = (iso: string, ru: boolean) => {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString(ru ? "ru-RU" : "ky-KG", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `${ru ? "Сегодня" : "Бүгүн"} ${time}`;
  return d.toLocaleDateString(ru ? "ru-RU" : "ky-KG", { day: "2-digit", month: "2-digit" }) + ` ${time}`;
};

const LeadCard = ({
  l, task, kommoBaseUrl, ru,
}: { l: LeadWithSection; task: LeadTask | null | undefined; kommoBaseUrl: string | null; ru: boolean }) => {
  const href = l.kommo_lead_id != null && kommoBaseUrl ? `${kommoBaseUrl}/leads/detail/${l.kommo_lead_id}` : null;
  const name = l.parent_name || l.child_name || l.phone || (l.kommo_lead_id ? `#${l.kommo_lead_id}` : "—");
  const kid = [
    l.child_name && l.child_name !== name ? l.child_name : null,
    l.child_age != null ? `${l.child_age} ${ru ? "лет" : "жаш"}` : null,
    l.section ? (ru ? l.section.name_ru : l.section.name_ky) : l.kommo_section,
  ].filter(Boolean).join(" · ");
  const open = () => { if (href) window.open(href, "_blank", "noopener"); };

  return (
    <div
      className="lead-card"
      role={href ? "link" : undefined}
      tabIndex={href ? 0 : undefined}
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter") open(); }}
      style={{ cursor: href ? "pointer" : "default" }}
    >
      <div className="lead-card__top">
        <span className="lead-card__date">{shortDate(l.created_at, ru)}</span>
        {l.channel && <span className="lead-card__channel">{channelLabel(l.channel, ru)}</span>}
      </div>
      <div className="lead-card__name">{name}</div>
      {kid && <div className="lead-card__sub">{kid}</div>}
      {l.phone && l.phone !== name && <div className="lead-card__sub">{l.phone}</div>}
      {l.kommo_price != null && Number(l.kommo_price) > 0 && (
        <div className="lead-card__price">{formatCurrency(Number(l.kommo_price))}</div>
      )}
      {task && (
        <div className={`lead-card__task ${task.escalated ? "is-hot" : ""}`}>
          {taskLabel(task, ru)}
          {task.kind === "first_contact_overdue" && ` · +${humanMinutes(task.overdueMin, ru)}`}
        </div>
      )}
      <div className="lead-card__foot">
        {l.kommo_manager_tag ? <span className="lead-card__tag">{l.kommo_manager_tag}</span> : <span />}
        <span style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          {l.phone && (
            <>
              <a className="icon-btn icon-btn--sm" title="WhatsApp" target="_blank" rel="noreferrer"
                href={`https://wa.me/${l.phone.replace(/[^0-9]/g, "")}`}>
                <Icon name="whatsapp" size={14} />
              </a>
              <a className="icon-btn icon-btn--sm" title={ru ? "Позвонить" : "Чалуу"} href={`tel:${l.phone}`}>
                <Icon name="phone" size={14} />
              </a>
            </>
          )}
        </span>
      </div>
    </div>
  );
};

export const LeadsBoard = ({
  leads, statuses, tasks, kommoBaseUrl, lang,
}: {
  leads: LeadWithSection[];
  statuses: KommoStatus[];
  tasks: Map<string, LeadTask | null>;
  kommoBaseUrl: string | null;
  lang: Lang;
}) => {
  const ru = lang === "ru";

  // Воронки Kommo в их порядке + «Без Kommo» для лидов, заведённых в ERP.
  const pipelines = useMemo(() => {
    const seen = new Map<number, string>();
    for (const s of statuses) if (!seen.has(s.pipeline_id)) seen.set(s.pipeline_id, s.pipeline_name);
    const list = [...seen].map(([id, name]) => ({
      key: String(id),
      title: pipelineTitle(name, ru),
      count: leads.filter((l) => l.kommo_pipeline_id === id).length,
    }));
    const erp = leads.filter((l) => l.kommo_lead_id == null).length;
    if (erp > 0 || list.length === 0) {
      list.push({ key: ERP_PIPELINE, title: list.length ? (ru ? "Без Kommo" : "Kommo'сүз") : (ru ? "Воронка" : "Воронка"), count: erp });
    }
    return list;
  }, [statuses, leads, ru]);

  const [picked, setPicked] = useState<string | null>(null);
  const pipeline = pipelines.find((p) => p.key === picked) ?? pipelines[0];
  const [shown, setShown] = useState<Record<string, number>>({});

  const columns: Column[] = useMemo(() => {
    if (!pipeline) return [];
    const byRecent = (a: LeadWithSection, b: LeadWithSection) =>
      new Date(b.kommo_updated_at ?? b.created_at).getTime() - new Date(a.kommo_updated_at ?? a.created_at).getTime();
    if (pipeline.key === ERP_PIPELINE) {
      const own = leads.filter((l) => l.kommo_lead_id == null);
      return [...FUNNEL_STAGES, ...DEAD_END_STAGES].map((stage) => ({
        key: stage, title: stageLabel(stage, ru), stage,
        leads: own.filter((l) => l.stage === stage).sort(byRecent),
      }));
    }
    const pid = Number(pipeline.key);
    const inPipe = leads.filter((l) => l.kommo_pipeline_id === pid);
    return statuses
      .filter((s) => s.pipeline_id === pid)
      .sort((a, b) => a.sort - b.sort)
      .map((s) => ({
        key: `${pid}:${s.status_id}`, title: statusTitle(s, ru), stage: s.stage,
        leads: inPipe.filter((l) => l.kommo_status_id === s.status_id).sort(byRecent),
      }));
  }, [pipeline, leads, statuses, ru]);

  return (
    <>
      {pipelines.length > 1 && (
        <div className="tabs" style={{ margin: "0 16px 12px" }}>
          {pipelines.map((p) => (
            <button key={p.key} className={`tabs__btn ${pipeline?.key === p.key ? "is-active" : ""}`}
              onClick={() => setPicked(p.key)}>
              {p.title} · {p.count}
            </button>
          ))}
        </div>
      )}
      <div className="lead-board">
        {columns.map((c) => {
          const limit = shown[c.key] ?? PAGE;
          const sum = c.leads.reduce((a, l) => a + (Number(l.kommo_price) || 0), 0);
          return (
            <section key={c.key} className="lead-col">
              <header className="lead-col__head" style={{ borderTopColor: stripe(c.stage) }}>
                <div className="lead-col__title" title={c.title}>{c.title}</div>
                <div className="lead-col__meta">
                  {c.leads.length} {dealsWord(c.leads.length, ru)}
                  {sum > 0 && <> · {formatCurrency(sum)}</>}
                </div>
                <span className="lead-col__stage" style={{ background: stageTone(c.stage).bg, color: stageTone(c.stage).fg }}>
                  {stageLabel(c.stage, ru)}
                </span>
              </header>
              <div className="lead-col__body">
                {c.leads.slice(0, limit).map((l) => (
                  <LeadCard key={l.id} l={l} task={tasks.get(l.id)} kommoBaseUrl={kommoBaseUrl} ru={ru} />
                ))}
                {c.leads.length > limit && (
                  <button className="btn btn--ghost lead-col__more"
                    onClick={() => setShown((s) => ({ ...s, [c.key]: limit + 50 }))}>
                    {ru ? `Ещё ${c.leads.length - limit}` : `Дагы ${c.leads.length - limit}`}
                  </button>
                )}
                {c.leads.length === 0 && <div className="lead-col__empty">{ru ? "Пусто" : "Бош"}</div>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
};
