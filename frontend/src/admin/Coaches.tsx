import { useEffect, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState, initialsOf } from "./common";
import { resolveAvatarUrl } from "../shared/api/avatar";
import { useCoaches } from "../shared/api/queries";
import { AddCoachModal } from "../shared/ui/forms";
import { Gate } from "../shared/auth/Gate";
import { usePerm } from "../shared/auth/rbac";

export const CoachesPage = ({ lang }: { lang: Lang }) => {
  const { data: coaches = [], isLoading, error } = useCoaches();
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const editing = coaches.find((c) => c.id === editId);
  const canEdit = usePerm("manage_coaches");
  // If user lost permission while modal was open (role change / hot reload),
  // close it. Same for archive/delete that drops the coach from the list.
  useEffect(() => {
    if (editId && (!canEdit || !editing)) setEditId(null);
  }, [canEdit, editing, editId]);

  return (
    <>
      <PageHeader
        title={t("Тренеры", "Тренерлер")}
        subtitle={isLoading ? t("Загрузка…", "Жүктөлүүдө…") : t(`${coaches.length} активных`, `${coaches.length} активдүү`)}
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
        <div className="coach-grid">
          {coaches.map((c) => (
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
                </div>
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
          ))}
        </div>
      )}
    </>
  );
};
