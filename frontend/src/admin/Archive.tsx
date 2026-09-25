import { useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState } from "./common";
import {
  useArchivedChildren,
  useArchivedFamilies,
  useArchivedCoaches,
  useArchivedSections,
  useArchivedGroups,
} from "../shared/api/queries";
import { useRestore, type ArchivableTable } from "../shared/api/mutations";
import { usePerm } from "../shared/auth/rbac";
import { ChildDrawer } from "./ChildDrawer";
import { GroupDrawer } from "./GroupDrawer";
import { AddFamilyModal, AddCoachModal, AddSectionModal } from "../shared/ui/forms";

type TabId = "kids" | "families" | "coaches" | "sections" | "groups";

const TABLE_BY_TAB: Record<TabId, ArchivableTable> = {
  kids: "children",
  families: "families",
  coaches: "profiles",
  sections: "sections",
  groups: "groups",
};

const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
};

export const ArchivePage = ({ lang }: { lang: Lang }) => {
  const [tab, setTab] = useState<TabId>("kids");
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const allowed = usePerm("view_archive");

  if (!allowed) {
    return (
      <>
        <PageHeader title={t("Архив", "Архив")} />
        <div className="card">
          <EmptyState
            title={t("Нет доступа", "Жеткиликтүү эмес")}
            hint={t("Архив доступен только директору и фитнес-директору.", "Архив директорго жана фитнес-директорго гана.")}
          />
        </div>
      </>
    );
  }

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: "kids", label: t("Дети", "Балдар"), icon: "kids" },
    { id: "families", label: t("Семьи", "Үй-бүлөлөр"), icon: "parents" },
    { id: "coaches", label: t("Тренеры", "Тренерлер"), icon: "whistle" },
    { id: "sections", label: t("Секции", "Секциялар"), icon: "tag" },
    { id: "groups", label: t("Группы", "Топтор"), icon: "dashboard" },
  ];

  return (
    <>
      <PageHeader
        title={t("Архив", "Архив")}
        subtitle={t("Восстановите запись или удалите навсегда", "Жазууну калыбына келтириңиз же биротоло өчүрүңүз")}
      />

      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                className={`tabs__btn ${tab === tb.id ? "is-active" : ""}`}
                onClick={() => setTab(tb.id)}
              >
                <Icon name={tb.icon} size={14} />
                <span style={{ marginLeft: 6 }}>{tb.label}</span>
              </button>
            ))}
          </div>
        </div>

        {tab === "kids" && <KidsTable lang={lang} table={TABLE_BY_TAB[tab]} />}
        {tab === "families" && <FamiliesTable lang={lang} table={TABLE_BY_TAB[tab]} />}
        {tab === "coaches" && <CoachesTable lang={lang} table={TABLE_BY_TAB[tab]} />}
        {tab === "sections" && <SectionsTable lang={lang} table={TABLE_BY_TAB[tab]} />}
        {tab === "groups" && <GroupsTable lang={lang} table={TABLE_BY_TAB[tab]} />}
      </div>
    </>
  );
};

// ---------- Row actions ----------
// Только восстановление: по ТЗ (§2.2, §12.3) удалять данные не может никто —
// архивная запись хранится вместе со всей историей.
const RowActions = ({
  id,
  table,
  lang,
}: {
  id: string;
  table: ArchivableTable;
  lang: Lang;
}) => {
  const restore = useRestore(table);
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
      <button
        className="btn btn--ghost"
        disabled={restore.isPending}
        onClick={(e) => { e.stopPropagation(); restore.mutate(id); }}
      >
        <Icon name="restore" size={14} /> {t("Восстановить", "Калыбына келтирүү")}
      </button>
    </div>
  );
};

// ---------- Per-tab tables ----------
const Loading = ({ lang }: { lang: Lang }) => (
  <EmptyState title={lang === "ru" ? "Загрузка…" : "Жүктөлүүдө…"} />
);

const Empty = ({ lang }: { lang: Lang }) => (
  <EmptyState
    title={lang === "ru" ? "В архиве пусто" : "Архив бош"}
    hint={lang === "ru" ? "Здесь появятся записи, которые вы отправите в архив." : "Бул жерде архивге жөнөтүлгөн жазуулар көрүнөт."}
  />
);

const KidsTable = ({ lang, table }: { lang: Lang; table: ArchivableTable }) => {
  const { data = [], isLoading, error } = useArchivedChildren();
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [openChildId, setOpenChildId] = useState<string | null>(null);
  if (error) return <EmptyState title={t("Ошибка", "Ката")} hint={error.message} />;
  if (isLoading) return <Loading lang={lang} />;
  if (data.length === 0) return <Empty lang={lang} />;
  return (
    <>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Имя", "Аты")}</th>
              <th>{t("Семья", "Үй-бүлө")}</th>
              <th>{t("Архивирован", "Архивделген")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((k) => {
              const fam = k.family;
              const famLabel = fam
                ? [fam.father_name, fam.mother_name].filter(Boolean).join(" / ") || "—"
                : "—";
              return (
                <tr key={k.id} style={{ cursor: "pointer" }} onClick={() => setOpenChildId(k.id)}>
                  <td>{k.full_name}</td>
                  <td>{famLabel}</td>
                  <td>{fmtDate(k.deleted_at)}</td>
                  <td>
                    <RowActions id={k.id} table={table} lang={lang} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {openChildId && (
        <ChildDrawer
          open
          onClose={() => setOpenChildId(null)}
          childId={openChildId}
          child={data.find((k) => k.id === openChildId) as any}
          lang={lang}
        />
      )}
    </>
  );
};

const FamiliesTable = ({ lang, table }: { lang: Lang; table: ArchivableTable }) => {
  const { data = [], isLoading, error } = useArchivedFamilies();
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [openId, setOpenId] = useState<string | null>(null);
  const active = data.find((f) => f.id === openId) ?? null;
  if (error) return <EmptyState title={t("Ошибка", "Ката")} hint={error.message} />;
  if (isLoading) return <Loading lang={lang} />;
  if (data.length === 0) return <Empty lang={lang} />;
  return (
    <>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Родители", "Ата-эне")}</th>
              <th>{t("Телефоны", "Телефондор")}</th>
              <th>{t("Архивирован", "Архивделген")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((f) => {
              const names = [f.father_name, f.mother_name].filter(Boolean).join(" / ") || "—";
              const phones = [f.father_phone, f.mother_phone].filter(Boolean).join(", ") || "—";
              return (
                <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(f.id)}>
                  <td>{names}</td>
                  <td>{phones}</td>
                  <td>{fmtDate(f.deleted_at)}</td>
                  <td>
                    <RowActions id={f.id} table={table} lang={lang} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AddFamilyModal
        open={!!openId}
        onClose={() => setOpenId(null)}
        lang={lang}
        initial={active ? {
          id: active.id,
          father_name: active.father_name,
          father_phone: active.father_phone,
          mother_name: active.mother_name,
          mother_phone: active.mother_phone,
          comment: (active as any).comment,
          responsible_manager_id: (active as any).responsible_manager_id ?? null,
        } : undefined}
      />
    </>
  );
};

const CoachesTable = ({ lang, table }: { lang: Lang; table: ArchivableTable }) => {
  const { data = [], isLoading, error } = useArchivedCoaches();
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [openId, setOpenId] = useState<string | null>(null);
  const active = data.find((c) => c.id === openId) ?? null;
  if (error) return <EmptyState title={t("Ошибка", "Ката")} hint={error.message} />;
  if (isLoading) return <Loading lang={lang} />;
  if (data.length === 0) return <Empty lang={lang} />;
  return (
    <>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Имя", "Аты")}</th>
              <th>{t("Телефон", "Телефон")}</th>
              <th>{t("Архивирован", "Архивделген")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(c.id)}>
                <td>{c.full_name}</td>
                <td>{c.phone || "—"}</td>
                <td>{fmtDate(c.deleted_at)}</td>
                <td>
                  <RowActions id={c.id} table={table} lang={lang} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddCoachModal
        open={!!openId}
        onClose={() => setOpenId(null)}
        lang={lang}
        initial={active ? {
          id: active.id,
          email: (active as any).email,
          full_name: active.full_name,
          phone: active.phone,
          bio: (active as any).coach?.bio ?? null,
          achievements: (active as any).coach?.achievements ?? null,
          experience_years: (active as any).coach?.experience_years ?? null,
          is_active: (active as any).coach?.is_active ?? true,
          avatar_url: (active as any).coach?.avatar_url ?? null,
        } : undefined}
      />
    </>
  );
};

const SectionsTable = ({ lang, table }: { lang: Lang; table: ArchivableTable }) => {
  const { data = [], isLoading, error } = useArchivedSections();
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [openId, setOpenId] = useState<string | null>(null);
  const active = data.find((s) => s.id === openId) ?? null;
  if (error) return <EmptyState title={t("Ошибка", "Ката")} hint={error.message} />;
  if (isLoading) return <Loading lang={lang} />;
  if (data.length === 0) return <Empty lang={lang} />;
  return (
    <>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Название", "Аталышы")}</th>
              <th>{t("Категория", "Категория")}</th>
              <th>{t("Архивирована", "Архивделген")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(s.id)}>
                <td>{lang === "ru" ? s.name_ru : s.name_ky}</td>
                <td>{s.category}</td>
                <td>{fmtDate(s.deleted_at)}</td>
                <td>
                  <RowActions id={s.id} table={table} lang={lang} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddSectionModal
        open={!!openId}
        onClose={() => setOpenId(null)}
        lang={lang}
        initial={active ? {
          id: active.id,
          name_ru: active.name_ru,
          name_ky: active.name_ky,
          category: active.category,
          color: (active as any).color,
        } : undefined}
      />
    </>
  );
};

const GroupsTable = ({ lang, table }: { lang: Lang; table: ArchivableTable }) => {
  const { data = [], isLoading, error } = useArchivedGroups();
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  if (error) return <EmptyState title={t("Ошибка", "Ката")} hint={error.message} />;
  if (isLoading) return <Loading lang={lang} />;
  if (data.length === 0) return <Empty lang={lang} />;
  return (
    <>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Группа", "Топ")}</th>
              <th>{t("Секция", "Секция")}</th>
              <th>{t("Тренер", "Тренер")}</th>
              <th>{t("Архивирована", "Архивделген")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((g: any) => (
              <tr key={g.id} style={{ cursor: "pointer" }} onClick={() => setOpenGroupId(g.id)}>
                <td>{g.name}</td>
                <td>{g.section ? (lang === "ru" ? g.section.name_ru : g.section.name_ky) : "—"}</td>
                <td>{g.coach?.full_name || "—"}</td>
                <td>{fmtDate(g.deleted_at)}</td>
                <td>
                  <RowActions id={g.id} table={table} lang={lang} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openGroupId && (
        <GroupDrawer
          open
          onClose={() => setOpenGroupId(null)}
          groupId={openGroupId}
          lang={lang}
        />
      )}
    </>
  );
};
