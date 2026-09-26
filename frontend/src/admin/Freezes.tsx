import { useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState, initialsOf } from "./common";
import { fmtD } from "../shared/lib/dates";
import { useFreezes } from "../shared/api/queries";
import { useApproveFreeze, useRejectFreeze, useEndFreeze } from "../shared/api/mutations";
import { CreateFreezeModal } from "../shared/ui/forms";
import { Gate } from "../shared/auth/Gate";
import { usePerm } from "../shared/auth/rbac";
import { freezeOutcome } from "../shared/types/database";
import { SkeletonRows, SkeletonText } from "../shared/ui/Skeleton";

// Заморозка, закрытая по истечении срока, и отклонённая заявка лежат в
// одном статусе 'rejected' — раньше обе показывались как «Отклонено», хотя
// первая честно отработала и продлила абонемент. Различаем по approved_at.
const statusBadge: Record<string, { ru: string; ky: string; cls: string }> = {
  pending: { ru: "Ожидает", ky: "Күтүүдө", cls: "pill pill--frozen" },
  active: { ru: "Действует", ky: "Колдонулууда", cls: "pill pill--active" },
  finished: { ru: "Завершена", ky: "Аяктады", cls: "pill pill--archived" },
  rejected: { ru: "Отклонено", ky: "Четке кагылды", cls: "pill pill--expired" },
};

export const FreezesPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: freezes = [], isLoading, error } = useFreezes();
  const approve = useApproveFreeze();
  const reject = useRejectFreeze();
  const endFreeze = useEndFreeze();
  const [open, setOpen] = useState(false);
  const canApprove = usePerm("approve_freezes");

  return (
    <>
      <PageHeader
        title={t("Заморозки", "Тындыруулар")}
        subtitle={isLoading ? <SkeletonText /> : t(`${freezes.length} записей`, `${freezes.length} жазуу`)}
        actions={
          <Gate perm="create_freeze">
            <button className="btn btn--primary" onClick={() => setOpen(true)}>
              <Icon name="plus" /> {t("Новая заморозка", "Тындыруу")}
            </button>
          </Gate>
        }
      />

      <div className="card">
        {error ? <EmptyState title={t("Ошибка", "Ката")} hint={error.message} /> :
          isLoading ? <SkeletonRows /> :
          freezes.length === 0 ? <EmptyState title={t("Заморозок нет", "Тындыруулар жок")} /> : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t("Ребёнок", "Бала")}</th>
                    <th>{t("Период", "Мезгил")}</th>
                    <th>{t("Инициатор", "Демилгечи")}</th>
                    <th>{t("Создано", "Түзүлдү")}</th>
                    <th>{t("Причина", "Себеп")}</th>
                    <th>{t("Статус", "Абалы")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {freezes.map((f) => {
                    const outcome = freezeOutcome(f);
                    const badge = statusBadge[outcome]!;
                    return (
                    <tr key={f.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="call-row__avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                            {f.child ? initialsOf(f.child.full_name) : "?"}
                          </div>
                          <div className="cell-main">{f.child?.full_name ?? f.child_id.slice(0, 8)}</div>
                        </div>
                      </td>
                      <td>
                        {f.start_date && f.end_date ? `${fmtD(f.start_date)} → ${fmtD(f.end_date)}` : "—"}
                        {f.applied_days ? (
                          <div className="cell-sub">+{f.applied_days} {t("дн. к абонементу", "күн абонементке")}</div>
                        ) : null}
                      </td>
                      <td>{f.initiator?.full_name ?? f.initiator_role}</td>
                      <td style={{ color: "var(--muted)" }}>{new Date(f.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}</td>
                      <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 280 }}>{f.reason ?? "—"}</td>
                      <td><span className={badge.cls}>{badge[lang]}</span></td>
                      <td style={{ textAlign: "right", width: 1 }}>
                        {outcome === "pending" && canApprove && (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn--primary" style={{ padding: "6px 10px", fontSize: 12 }}
                              onClick={() => approve.mutate(f.id)} disabled={approve.isPending}>
                              <Icon name="check" size={12} /> {t("Одобрить", "Жактыруу")}
                            </button>
                            <button className="btn" style={{ padding: "6px 10px", fontSize: 12 }}
                              onClick={() => reject.mutate(f.id)} disabled={reject.isPending}>
                              {t("Отклонить", "Четке кагуу")}
                            </button>
                          </div>
                        )}
                        {outcome === "active" && canApprove && (
                          <button className="btn" style={{ padding: "6px 10px", fontSize: 12 }}
                            title={t("Снять заморозку досрочно — абонемент пересчитается", "Мөөнөтүнөн мурда токтотуу")}
                            onClick={() => {
                              if (confirm(t("Снять заморозку досрочно?", "Тындырууну мөөнөтүнөн мурда токтотуу?"))) {
                                endFreeze.mutate(f.id);
                              }
                            }}
                            disabled={endFreeze.isPending}>
                            {t("Снять", "Алып салуу")}
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
      </div>

      <CreateFreezeModal open={open} onClose={() => setOpen(false)} lang={lang} />
    </>
  );
};
