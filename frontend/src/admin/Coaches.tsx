import { useEffect, useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState, initialsOf } from "./common";
import { resolveAvatarUrl } from "../shared/api/avatar";
import { useCoaches, useGroups } from "../shared/api/queries";
import { AddCoachModal } from "../shared/ui/forms";
import { Gate } from "../shared/auth/Gate";
import { usePerm } from "../shared/auth/rbac";
import { SkeletonText } from "../shared/ui/Skeleton";

export const CoachesPage = ({ lang }: { lang: Lang }) => {
  const { data: coaches = [], isLoading, error } = useCoaches();
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const editing = coaches.find((c) => c.id === editId);
  const canEdit = usePerm("manage_coaches");
  // Группы тренера и сколько в них занимается сейчас — чтобы по карточке было
  // видно, кто что ведёт. Бывшие тренеры (история из Excel) — отдельным блоком.
  const { data: groups = [] } = useGroups();
  const groupsByCoach = useMemo(() => {
    const m = new Map<string, { name: string; active: boolean; kids: number }[]>();
    for (const g of groups as any[]) {
      const list = m.get(g.coach_id) ?? [];
      list.push({
        name: g.name,
        active: !!g.is_active,
        kids: (g.enrollments ?? []).filter((e: any) => e.archived_at == null).length,
      });
      m.set(g.coach_id, list);
    }
    return m;
  }, [groups]);
  const working = coaches.filter((c) => c.is_active);
  const former = coaches.filter((c) => !c.is_active);
  // If user lost permission while modal was open (role change / hot reload),
  // close it. Same for archive/delete that drops the coach from the list.
  useEffect(() => {
    if (editId && (!canEdit || !editing)) setEditId(null);
  }, [canEdit, editing, editId]);

  const renderCard = (c: (typeof coaches)[number]) => {
    const cg = (groupsByCoach.get(c.id) ?? []).sort((a, b) => Number(b.active) - Number(a.active) || b.kids - a.kids);
    return (
      <div key={c.id} className="coach-card" style={{ cursor: canEdit ? "pointer" : "default" }}
        onClick={canEdit ? () => setEditId(c.id) : undefined}>
        <div className="coach-card__av" style={{ background: "var(--blue)", position: "relative", overflow: "hidden" }}>
          {initialsOf(c.full_name)}
          {c.avatar_url && (
            <img
              src={resolveAvatarUrl(c.avatar_url) ?? c.avatar_url}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                objectFit: "cover", objectPosition: "center",
              }}
            />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="coach-card__name">{c.full_name}</div>
          <div className="coach-card__sub">
            {c.coach?.experience_years ?? 0} {t("лет опыта", "жыл тажрыйба")}
            {!c.phone && <> · <span style={{ color: "var(--red-600)" }}>{t("нет телефона для входа", "кирүү үчүн телефон жок")}</span></>}
          </div>
          {cg.length > 0 && (
            <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
              {cg.map((g) => (
                <div key={g.name} style={{ color: g.active ? "var(--ink-2)" : "var(--muted)" }}>
                  {g.name.replace(/ — .*$/, "")}
                  {g.active ? <> · <b>{g.kids}</b> {t("занимаются", "катышат")}</> : <> · {t("архив", "архив")}</>}
                </div>
              ))}
            </div>
          )}
          {c.coach?.bio && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.45 }}>
              {c.coach.bio}
            </div>
          )}
          {c.coach?.achievements && (
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 6, fontWeight: 500 }}>
              {c.coach.achievements}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title={t("Тренеры", "Тренерлер")}
        subtitle={isLoading ? <SkeletonText /> : t(
          `${working.length} работают · ${former.length} бывших`,
          `${working.length} иштейт · ${former.length} мурунку`,
        )}
        actions={
          <Gate perm="manage_coaches">
            <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" /> {t("Добавить тренера", "Тренер кошуу")}
            </button>
          </Gate>
        }
      />

      <AddCoachModal open={addOpen} onClose={() => setAddOpen(false)} lang={lang} />
      {editing && (
        <AddCoachModal
          open={!!editId}
          onClose={() => setEditId(null)}
          lang={lang}
          initial={{
            id: editing.id,
            email: editing.email,
            full_name: editing.full_name,
            phone: editing.phone,
            bio: editing.coach?.bio,
            achievements: editing.coach?.achievements,
            experience_years: editing.coach?.experience_years,
            is_active: editing.is_active,
            avatar_url: editing.avatar_url,
            pay_mode: editing.coach?.pay_mode,
            percent_rate: editing.coach?.percent_rate,
            fixed_monthly: editing.coach?.fixed_monthly,
          }}
        />
      )}

      {error ? (
        <div className="card">
          <EmptyState title={t("Ошибка загрузки", "Жүктөө катасы")} hint={error.message} />
        </div>
      ) : !isLoading && coaches.length === 0 ? (
        <div className="card">
          <EmptyState title={t("Тренеров пока нет", "Тренерлер жок")} />
        </div>
      ) : (
        <>
          <div className="coach-grid">
            {working.map(renderCard)}
          </div>
          {former.length > 0 && (
            <>
              <div className="form-sec" style={{ margin: "20px 0 8px" }}>
                {t(`Бывшие тренеры (${former.length})`, `Мурунку тренерлер (${former.length})`)}
              </div>
              <div className="coach-grid" style={{ opacity: 0.75 }}>
                {former.map(renderCard)}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
};
