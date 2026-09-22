import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState } from "./common";
import { useGroups, useSections } from "../shared/api/queries";
import { GroupDrawer } from "./GroupDrawer";
import { AddGroupModal } from "../shared/ui/forms";
import { Gate } from "../shared/auth/Gate";

export const GroupsPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [q, setQ] = useState("");
  const [sectionId, setSectionId] = useState<string>("all");
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: groups = [], isLoading, error } = useGroups();
  const { data: sections = [] } = useSections();

  const sectionName = (sec: any) => (lang === "ru" ? sec?.name_ru : sec?.name_ky) ?? "—";

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const filtered = groups.filter((g: any) => {
      if (sectionId !== "all" && g.section_id !== sectionId) return false;
      if (qq && !g.name.toLowerCase().includes(qq)) return false;
      return true;
    });
    // Сортировка: сначала по секции (RU), потом по имени группы.
    return [...filtered].sort((a: any, b: any) => {
      const sa = sectionName(a.section);
      const sb = sectionName(b.section);
      if (sa !== sb) return sa.localeCompare(sb, "ru");
      return a.name.localeCompare(b.name, "ru");
    });
  }, [groups, q, sectionId, lang]);

  const totalKids = useMemo(
    () => rows.reduce((sum: number, g: any) => sum + (g.enrollments ?? []).filter((e: any) => e.archived_at == null).length, 0),
    [rows],
  );

  return (
    <>
      <PageHeader
        title={t("Группы", "Топтор")}
        subtitle={
          isLoading
            ? t("Загрузка…", "Жүктөлүүдө…")
            : t(`${rows.length} групп · ${totalKids} детей`, `${rows.length} топ · ${totalKids} бала`)
        }
        actions={
          <Gate perm="manage_sections">
            <button
              className="btn btn--primary"
              onClick={() => setCreateOpen(true)}
              disabled={sections.length === 0}
              title={sections.length === 0 ? t("Сначала создайте секцию", "Адегенде секция түзүңүз") : undefined}
            >
              <Icon name="plus" /> {t("Новая группа", "Жаңы топ")}
            </button>
          </Gate>
        }
      />

      {openGroupId && (
        <GroupDrawer
          groupId={openGroupId}
          open={!!openGroupId}
          onClose={() => setOpenGroupId(null)}
          lang={lang}
        />
      )}

      <AddGroupModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        lang={lang}
        defaultSectionId={sectionId !== "all" ? sectionId : undefined}
      />

      <div className="card">
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <SearchBox value={q} onChange={setQ} placeholder={t("Поиск по названию группы…", "Топ атын издөө…")} />
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
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
          </select>
        </div>

        {error ? (
          <EmptyState title={t("Ошибка загрузки", "Жүктөө катасы")} hint={error.message} />
        ) : isLoading ? (
          <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t("Групп нет", "Топтор жок")}
            hint={t("Создайте группу со страницы «Секции»", "«Секциялар» бетинен топ түзүңүз")}
          />
        ) : (
          <div className="group-cards" style={{ padding: 12 }}>
            {rows.map((g: any) => {
              const activeKids = (g.enrollments ?? []).filter((e: any) => e.archived_at == null).length;
              const color = g.section?.color ?? "var(--blue)";
              // Срок жизни группы: истёкшую подсвечиваем — по ней уже не
              // генерируются занятия.
              const today = new Date().toISOString().slice(0, 10);
              const expired = g.ends_on && g.ends_on < today;
              const notStarted = g.starts_on && g.starts_on > today;
              return (
                <div
                  key={g.id}
                  className="group-mini"
                  style={{ cursor: "pointer" }}
                  onClick={() => setOpenGroupId(g.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 8, height: 8, borderRadius: "50%",
                        background: color, flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.04 }}>
                      {sectionName(g.section)}
                    </span>
                  </div>
                  <div className="group-mini__name">{g.name}</div>
                  <div className="group-mini__meta">
                    <Icon name="whistle" size={12} /> {g.coach?.full_name ?? "—"}
                  </div>
                  <div className="group-mini__stats">
                    <span><b>{activeKids}/{g.max_capacity}</b> {t("детей", "бала")}</span>
                    <span><b>{g.duration_min}</b> {t("мин", "мин")}</span>
                  </div>
                  {(g.starts_on || g.ends_on) && (
                    <div style={{ marginTop: 6, fontSize: 11, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--muted)" }}>
                        {g.starts_on ?? "…"} → {g.ends_on ?? "∞"}
                      </span>
                      {expired && <span className="pill pill--expired" style={{ fontSize: 10 }}>{t("срок истёк", "мөөнөтү бүттү")}</span>}
                      {notStarted && <span className="pill pill--frozen" style={{ fontSize: 10 }}>{t("ещё не началась", "башталган жок")}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};
