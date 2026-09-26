import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState, initialsOf } from "./common";
import { useChildren, useSections, useGroups } from "../shared/api/queries";
import { AddChildModal } from "../shared/ui/forms";
import { ChildAvatar } from "../shared/ui/ChildAvatar";
import { ChildDrawer } from "./ChildDrawer";
import { Gate } from "../shared/auth/Gate";
import { SkeletonRows, SkeletonText } from "../shared/ui/Skeleton";
import { Select } from "../shared/ui/Select";

const ageFromDob = (dob: string): number => {
  const d = new Date(dob);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return Math.max(0, a);
};

export const KidsPage = ({ lang }: { lang: Lang }) => {
  const [q, setQ] = useState("");
  const [sectionId, setSectionId] = useState<string>("all");
  const [groupId, setGroupId] = useState<string>("all");
  const [noGroupOnly, setNoGroupOnly] = useState(false);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const { data: kids = [], isLoading, error } = useChildren();
  const { data: sections = [] } = useSections();
  const { data: groups = [] } = useGroups();

  const groupsForSection = useMemo(() => {
    if (sectionId === "all") return groups;
    return groups.filter((g: any) => g.section_id === sectionId);
  }, [groups, sectionId]);

  // Поиск по ТЗ §3.1: ФИО ученика, ФИО родителя, телефон, номер карты / ID.
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const qDigits = qq.replace(/\D/g, "");
    // Телефон сравниваем по последним 9 цифрам — «+996 555…», «0555…» и «555…» совпадут.
    const qPhone = qDigits.length >= 3 ? qDigits.slice(-9) : "";
    const phoneMatch = (ph?: string | null) => !!ph && !!qPhone && ph.replace(/\D/g, "").includes(qPhone);
    return kids.filter((k) => {
      if (qq) {
        const f = k.family;
        const hit =
          k.full_name.toLowerCase().includes(qq) ||
          (f?.father_name ?? "").toLowerCase().includes(qq) ||
          (f?.mother_name ?? "").toLowerCase().includes(qq) ||
          phoneMatch(f?.father_phone) ||
          phoneMatch(f?.mother_phone) ||
          (k.card_number ?? "").toLowerCase().includes(qq) ||
          k.id.toLowerCase().startsWith(qq);
        if (!hit) return false;
      }
      const active = (k.enrollments ?? []).filter((e) => e.archived_at == null);
      if (noGroupOnly && active.length > 0) return false;
      if (sectionId !== "all" && !active.some((e) => e.group?.section_id === sectionId)) return false;
      if (groupId !== "all" && !active.some((e) => e.group_id === groupId)) return false;
      return true;
    });
  }, [q, kids, sectionId, groupId, noGroupOnly]);

  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  return (
    <>
      <PageHeader
        title={t("Дети", "Балдар")}
        subtitle={isLoading ? <SkeletonText /> : t(`${kids.length} активных в системе`, `${kids.length} активдүү бала`)}
        actions={
          <Gate perm="edit_kids">
            <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" /> {t("Новый ребёнок", "Жаңы бала")}
            </button>
          </Gate>
        }
      />

      <AddChildModal open={addOpen} onClose={() => setAddOpen(false)} lang={lang} />
      {activeChildId && (
        <ChildDrawer
          childId={activeChildId}
          child={kids.find((k) => k.id === activeChildId)}
          open={!!activeChildId}
          onClose={() => setActiveChildId(null)}
          lang={lang}
        />
      )}

      <div className="card">
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <SearchBox value={q} onChange={setQ} placeholder={t("Имя ребёнка или родителя, телефон, номер карты…", "Баланын же ата-эненин аты, телефон, карта номери…")} />
          <Select
            value={sectionId}
            onChange={(e) => { setSectionId(e.target.value); setGroupId("all"); }}
            style={{
              height: 36, padding: "0 10px",
              border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
              background: "var(--bg-soft)", fontSize: 13, color: "var(--ink)",
            }}
          >
            <option value="all">{t("Все секции", "Бардык секциялар")}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{lang === "ru" ? s.name_ru : s.name_ky}</option>
            ))}
          </Select>
          <Select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            style={{
              height: 36, padding: "0 10px",
              border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
              background: "var(--bg-soft)", fontSize: 13, color: "var(--ink)",
            }}
          >
            <option value="all">{t("Все группы", "Бардык топтор")}</option>
            {groupsForSection.map((g: any) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
          <label className="check" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={noGroupOnly}
              onChange={(e) => setNoGroupOnly(e.target.checked)}
            />
            <span><b>{t("Без группы", "Топсуз")}</b></span>
          </label>
        </div>
        {error ? (
          <EmptyState title={t("Ошибка загрузки", "Жүктөө катасы")} hint={error.message} />
        ) : isLoading ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <EmptyState title={t("Никто не найден", "Эч ким табылган жок")} />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Имя", "Аты")}</th>
                  <th>{t("Возраст", "Жашы")}</th>
                  <th>{t("Статус", "Статусу")}</th>
                  <th>{t("Группа", "Топ")}</th>
                  <th>{t("Карта", "Карта")}</th>
                  <th>{t("Семья", "Үй-бүлө")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => {
                  const family = k.family;
                  const familyLabel = family
                    ? [family.father_name, family.mother_name].filter(Boolean).join(" / ") || "—"
                    : "—";
                  const activeEnroll = (k.enrollments ?? []).filter((e) => e.archived_at == null);
                  const groupsLabel = activeEnroll.length === 0
                    ? "—"
                    : activeEnroll.map((e) => e.group?.name).filter(Boolean).join(", ");
                  return (
                    <tr key={k.id} onClick={() => setActiveChildId(k.id)}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <ChildAvatar
                            className="call-row__avatar"
                            style={{ width: 32, height: 32, fontSize: 11 }}
                            photoPath={(k as any).photo_path}
                            fullName={k.full_name}
                          />
                          <div>
                            <div className="cell-main">{k.full_name}</div>
                            <div className="cell-sub">ID: {k.id.slice(0, 8)}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {ageFromDob(k.birth_date)} {t("лет", "жаш")}
                      </td>
                      <td>
                        <span className={`pill pill--${k.status}`}>{k.status}</span>
                      </td>
                      <td className="cell-sub" style={{ fontSize: 12 }}>{groupsLabel}</td>
                      <td>{k.card_number ?? "—"}</td>
                      <td className="cell-sub" style={{ fontSize: 12 }}>{familyLabel}</td>
                      <td style={{ textAlign: "right", width: 1 }}>
                        <Icon name="chevron-right" size={16} style={{ color: "var(--muted-2)" }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
