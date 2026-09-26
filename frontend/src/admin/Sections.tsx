import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang, DirectionId } from "../data";
import { PageHeader, EmptyState } from "./common";
import { useSections, useGroups } from "../shared/api/queries";
import { AddSectionModal, AddGroupModal } from "../shared/ui/forms";
import { GroupDrawer } from "./GroupDrawer";
import { Gate } from "../shared/auth/Gate";
import { usePerm } from "../shared/auth/rbac";
import { SkeletonText } from "../shared/ui/Skeleton";

type SectionRow = ReturnType<typeof useSections>["data"] extends (infer U)[] | undefined ? U : never;

const DIRECTION_INFO: Record<DirectionId, {
  ru: string; ky: string;
  ageRu: string; ageKy: string;
  color: string;
}> = {
  mart: { ru: "Единоборства", ky: "Күрөш спорттору", ageRu: "дети и взрослые", ageKy: "балдар жана чоңдор", color: "#dc2626" },
  fit:  { ru: "Фитнес-зона",  ky: "Фитнес-зона",     ageRu: "взрослые",        ageKy: "чоңдор",             color: "#2563eb" },
};

const DIRECTION_ORDER: DirectionId[] = ["mart", "fit"];

// Направление = sections.category: martial_arts (бокс, ММА, вольная борьба,
// дзюдо, кикбоксинг, таэквондо) и fitness (фитнес-зона, 20260925000001).
// Старые категории движка (gymnastics/therapy/…) считаем единоборствами.
const directionOf = (sec: { category: string }): DirectionId =>
  sec.category === "fitness" ? "fit" : "mart";

export const SectionsPage = ({ lang }: { lang: Lang }) => {
  const { data: sections = [], isLoading, error } = useSections();
  const { data: groups = [] } = useGroups();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [groupSectionId, setGroupSectionId] = useState<string | null>(null);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const editing = sections.find((s) => s.id === editId);
  const canEdit = usePerm("manage_sections");

  // Группируем секции по направлениям
  const byDirection = useMemo(() => {
    const map = new Map<DirectionId, SectionRow[]>();
    DIRECTION_ORDER.forEach((d) => map.set(d, []));
    sections.forEach((s) => {
      const d = directionOf(s);
      map.get(d)!.push(s);
    });
    return map;
  }, [sections]);

  const dirCount = DIRECTION_ORDER.filter((d) => (byDirection.get(d) || []).length > 0).length;

  return (
    <>
      <PageHeader
        title={t("Секции и группы", "Секциялар жана топтор")}
        subtitle={isLoading ? <SkeletonText /> : t(`${dirCount} направлений · ${sections.length} секций · ${groups.length} групп`, `${dirCount} багыт · ${sections.length} секция · ${groups.length} топ`)}
        actions={
          <Gate perm="manage_sections">
            <button className="btn btn--primary" onClick={() => setOpen(true)}>
              <Icon name="plus" /> {t("Новая секция", "Жаңы секция")}
            </button>
          </Gate>
        }
      />

      <AddSectionModal open={open} onClose={() => setOpen(false)} lang={lang} />
      {editing && (
        <AddSectionModal
          open={!!editId}
          onClose={() => setEditId(null)}
          lang={lang}
          initial={{
            id: editing.id,
            name_ru: editing.name_ru,
            name_ky: editing.name_ky,
            category: editing.category,
            color: editing.color,
          }}
        />
      )}
      {groupSectionId && (
        <AddGroupModal
          open={!!groupSectionId}
          onClose={() => setGroupSectionId(null)}
          lang={lang}
          defaultSectionId={groupSectionId}
        />
      )}
      {editGroupId && (
        <GroupDrawer
          groupId={editGroupId}
          open={!!editGroupId}
          onClose={() => setEditGroupId(null)}
          lang={lang}
        />
      )}

      {error ? (
        <div className="card">
          <EmptyState title={t("Ошибка загрузки", "Жүктөө катасы")} hint={error.message} />
        </div>
      ) : !isLoading && sections.length === 0 ? (
        <div className="card">
          <EmptyState title={t("Секций пока нет", "Секциялар жок")} hint={t("Создайте первую секцию через кнопку справа сверху", "Жаңы секция түзүңүз")} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {DIRECTION_ORDER.map((dirId) => {
            const dirSecs = byDirection.get(dirId) || [];
            if (dirSecs.length === 0) return null;
            const info = DIRECTION_INFO[dirId];
            const totalGroups = dirSecs.reduce((sum, s) => sum + groups.filter((g) => g.section_id === s.id).length, 0);
            return (
              <div key={dirId} className="direction-block">
                <div className="direction-block__header" style={{ borderColor: info.color }}>
                  <div className="direction-block__bar" style={{ background: info.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="direction-block__title">{lang === "ru" ? info.ru : info.ky}</div>
                    <div className="direction-block__meta">
                      {lang === "ru" ? info.ageRu : info.ageKy} · {dirSecs.length} {t("секций", "секция")} · {totalGroups} {t("групп", "топ")}
                    </div>
                  </div>
                </div>

                <div className="direction-block__sections">
                  {dirSecs.map((sec) => {
                    const name = lang === "ru" ? sec.name_ru : sec.name_ky;
                    const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                    const secGroups = groups.filter((g) => g.section_id === sec.id);
                    return (
                      <div key={sec.id} className="section-block">
                        <div className="section-block__head">
                          <div className="section-block__bubble" style={{ background: sec.color ?? info.color }}>
                            {initials}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="section-block__name">{name}</div>
                            <div className="section-block__meta">
                              {secGroups.length} {t("групп", "топ")}
                            </div>
                          </div>
                          {canEdit && (
                            <>
                              <button className="btn" onClick={() => setEditId(sec.id)}>
                                <Icon name="settings" size={14} /> {t("Изменить", "Өзгөртүү")}
                              </button>
                              <button className="btn btn--primary" onClick={() => setGroupSectionId(sec.id)}>
                                <Icon name="plus" size={14} /> {t("Группа", "Топ")}
                              </button>
                            </>
                          )}
                        </div>

                        <div className="section-block__groups">
                          {secGroups.length === 0 ? (
                            <div className="section-block__empty">
                              {t("В этой секции пока нет групп", "Бул секцияда топ жок")}
                            </div>
                          ) : (
                            <div className="group-cards">
                              {secGroups.map((g: any) => {
                                const activeKids = (g.enrollments ?? []).filter((e: any) => e.archived_at == null).length;
                                // Детали группы: возраст и уровень (20260807000003).
                                const age = g.age_min != null || g.age_max != null
                                  ? (g.age_min != null && g.age_max != null
                                      ? `${g.age_min}–${g.age_max} ${t("лет", "жаш")}`
                                      : g.age_min != null
                                        ? `${t("от", "баштап")} ${g.age_min} ${t("лет", "жаш")}`
                                        : `${t("до", "чейин")} ${g.age_max} ${t("лет", "жаш")}`)
                                  : null;
                                const details = [age, g.level].filter(Boolean).join(" · ");
                                return (
                                  <div key={g.id} className="group-mini" style={{ cursor: canEdit ? "pointer" : "default" }}
                                    onClick={canEdit ? () => setEditGroupId(g.id) : undefined}>
                                    <div className="group-mini__name">{g.name}</div>
                                    <div className="group-mini__meta">
                                      <Icon name="whistle" size={12} /> {g.coach?.full_name ?? "—"}
                                    </div>
                                    {details && (
                                      <div className="group-mini__meta">{details}</div>
                                    )}
                                    <div className="group-mini__stats">
                                      <span><b>{activeKids}/{g.max_capacity}</b> {t("детей", "бала")}</span>
                                      <span><b>{g.duration_min}</b> {t("мин", "мин")}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
