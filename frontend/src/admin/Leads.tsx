import { useMemo, useState } from "react";
import { I18N, Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState } from "./common";
import { useLeads } from "../shared/api/queries";
import { useUpdateLeadStage } from "../shared/api/mutations";
import { AddLeadModal } from "../shared/ui/forms";
import type { LeadStage } from "../shared/types/database";
import { Gate } from "../shared/auth/Gate";
import { SkeletonRows, SkeletonText } from "../shared/ui/Skeleton";
import { Select } from "../shared/ui/Select";

const sourceColor: Record<string, string> = {
  Instagram: "var(--red)",
  WhatsApp: "var(--green)",
  "Сарафан": "var(--yellow)",
  "Google Ads": "var(--blue)",
};

export const LeadsPage = ({ lang }: { lang: Lang }) => {
  const t = I18N[lang].admin;
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | LeadStage>("all");
  const [open, setOpen] = useState(false);
  const { data: leads = [], isLoading, error } = useLeads();
  const updateStage = useUpdateLeadStage();

  const rows = useMemo(() => {
    let list = leads;
    if (filter !== "all") list = list.filter((l) => l.stage === filter);
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter((l) =>
      (l.child_name ?? "").toLowerCase().includes(qq) || (l.parent_name ?? "").toLowerCase().includes(qq)
    );
    return list;
  }, [q, filter, leads]);

  const stageLabel: Record<LeadStage, string> = { new: t.leads.new, trial: t.leads.trial, waiting: t.leads.waiting };
  const stageBg: Record<LeadStage, { bg: string; fg: string }> = {
    new: { bg: "var(--blue-50)", fg: "var(--blue-ink)" },
    trial: { bg: "var(--yellow-100)", fg: "var(--yellow-ink)" },
    waiting: { bg: "var(--bg-soft)", fg: "var(--muted)" },
  };

  return (
    <>
      <PageHeader
        title={tt("Воронка продаж", "Сатуу каналы")}
        subtitle={isLoading ? <SkeletonText /> : tt(`${leads.length} лидов`, `${leads.length} арыз`)}
        actions={
          <Gate perm="edit_leads">
            <button className="btn btn--primary" onClick={() => setOpen(true)}>
              <Icon name="plus" /> {tt("Добавить лид", "Арыз кошуу")}
            </button>
          </Gate>
        }
      />

      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder={tt("Поиск по имени…", "Аты боюнча…")} />
          <div className="tabs">
            {(["all", "new", "trial", "waiting"] as const).map((f) => (
              <button key={f} className={`tabs__btn ${filter === f ? "is-active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? tt("Все", "Баары") : stageLabel[f]}
              </button>
            ))}
          </div>
        </div>
        {error ? <EmptyState title={tt("Ошибка", "Ката")} hint={error.message} /> :
          isLoading ? <SkeletonRows /> :
          rows.length === 0 ? <EmptyState title={tt("Лидов нет", "Арыздар жок")} /> : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{tt("Ребёнок", "Бала")}</th>
                    <th>{tt("Родитель / телефон", "Ата-эне / телефон")}</th>
                    <th>{tt("Источник", "Булак")}</th>
                    <th>{tt("Стадия", "Этап")}</th>
                    <th>{tt("Когда", "Качан")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="lead-row__src" style={{ background: sourceColor[l.source ?? ""] ?? "var(--muted-2)", width: 4, height: 36 }} />
                          <div>
                            <div className="cell-main">{l.child_name ?? "—"}</div>
                            {l.child_age != null && <div className="cell-sub">{l.child_age} {tt("лет", "жаш")}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="cell-sub">{l.parent_name ?? "—"}</div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{l.phone ?? ""}</div>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{l.source ?? "—"}</td>
                      <td>
                        <Select
                          className="lead-row__stage"
                          value={l.stage}
                          onChange={(e) => updateStage.mutate({ id: l.id, stage: e.target.value as LeadStage })}
                          style={{ background: stageBg[l.stage].bg, color: stageBg[l.stage].fg, border: "none", padding: "4px 10px", borderRadius: "var(--r-pill)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                        >
                          <option value="new">{stageLabel.new}</option>
                          <option value="trial">{stageLabel.trial}</option>
                          <option value="waiting">{stageLabel.waiting}</option>
                        </Select>
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>
                        {new Date(l.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}
                      </td>
                      <td style={{ textAlign: "right", width: 1 }}>
                        <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                          {l.phone ? (
                            <>
                              <a
                                className="icon-btn"
                                title="WhatsApp"
                                href={`https://wa.me/${l.phone.replace(/[^0-9]/g, "")}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Icon name="whatsapp" />
                              </a>
                              <a className="icon-btn" title="Call" href={`tel:${l.phone}`}>
                                <Icon name="phone" />
                              </a>
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{tt("Нет тел.", "Тел жок")}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <AddLeadModal open={open} onClose={() => setOpen(false)} lang={lang} />
    </>
  );
};
