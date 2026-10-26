import { useEffect, useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState, initialsOf } from "./common";
import { useChildren, useSections, useGroups } from "../shared/api/queries";
import { AddChildModal, SellCardModal } from "../shared/ui/forms";
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

const STATUS_LABEL: Record<string, { ru: string; ky: string }> = {
  active: { ru: "Занимается", ky: "Катышат" },
  frozen: { ru: "Заморозка", ky: "Тындырылган" },
  debtor: { ru: "Должник", ky: "Карыздар" },
  expired: { ru: "Абонемент закончился", ky: "Абонемент бүткөн" },
  archived: { ru: "В архиве", ky: "Архивде" },
};

// По умолчанию — те, кто занимается сейчас. После загрузки истории из Excel
// в базе ~4 000 клиентов за 15 месяцев, и бывшие заслоняли текущих.
type StatusFilter = "current" | "former" | "all";
type SortBy = "name" | "newest" | "oldest";
const PAGE_SIZE = 50;
const selectStyle = {
  height: 36, padding: "0 10px",
  border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
  background: "var(--bg-soft)", fontSize: 13, color: "var(--ink)",
} as const;
const isCurrent = (status: string) => status === "active" || status === "frozen" || status === "debtor";

export const KidsPage = ({ lang }: { lang: Lang }) => {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("current");
  const [sectionId, setSectionId] = useState<string>("all");
  const [groupId, setGroupId] = useState<string>("all");
  const [noGroupOnly, setNoGroupOnly] = useState(false);
  // Направление: единоборства или фитнес-зона (sections.category).
  const [direction, setDirection] = useState<"all" | "martial_arts" | "fitness">("all");
  const [coachId, setCoachId] = useState<string>("all");
  const [churnOnly, setChurnOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [page, setPage] = useState(0);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Новый клиент с выбранными секцией и группой — сразу продажа абонемента.
  const [sellFor, setSellFor] = useState<{ childId: string; sectionId: string; groupId: string } | null>(null);
  const { data: kids = [], isLoading, error } = useChildren();
  const { data: sections = [] } = useSections();
  const { data: groups = [] } = useGroups();

  // Для текущих клиентов — только работающие группы; архивные (бывшие тренеры)
  // нужны, только когда смотрим бывших.
  const groupsForSection = useMemo(() => {
    const pool = statusFilter === "current" ? groups.filter((g: any) => g.is_active) : groups;
    if (sectionId === "all") return pool;
    return pool.filter((g: any) => g.section_id === sectionId);
  }, [groups, sectionId, statusFilter]);

  // Группа → тренер и направление: в выборке детей у группы их нет.
  const groupInfo = useMemo(() => {
    const m = new Map<string, { coachId: string; category: string }>();
    for (const g of groups as any[]) m.set(g.id, { coachId: g.coach_id, category: g.section?.category ?? "" });
    return m;
  }, [groups]);
  const coachOptions = useMemo(() => {
    const m = new Map<string, { name: string; active: boolean }>();
    for (const g of groups as any[]) {
      if (!g.coach_id) continue;
      const cur = m.get(g.coach_id);
      m.set(g.coach_id, { name: g.coach?.full_name ?? "—", active: (cur?.active ?? false) || !!g.is_active });
    }
    return [...m.entries()]
      .filter(([, v]) => statusFilter !== "current" || v.active)
      .sort((a, b) => a[1].name.localeCompare(b[1].name, "ru"));
  }, [groups, statusFilter]);

  // Поиск по ТЗ §3.1: ФИО ученика, ФИО родителя, телефон, номер карты / ID.
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const qDigits = qq.replace(/\D/g, "");
    // Телефон сравниваем по последним 9 цифрам — «+996 555…», «0555…» и «555…» совпадут.
    const qPhone = qDigits.length >= 3 ? qDigits.slice(-9) : "";
    const phoneMatch = (ph?: string | null) => !!ph && !!qPhone && ph.replace(/\D/g, "").includes(qPhone);
    const list = kids.filter((k) => {
      // Поиск идёт по всей базе: бывшего клиента находят по имени или телефону.
      if (!qq && statusFilter === "current" && !isCurrent(k.status)) return false;
      if (!qq && statusFilter === "former" && isCurrent(k.status)) return false;
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
      // Бывших ищем и по прошлым группам — иначе «бывшие у Тургунова» не найти.
      const pool = statusFilter === "current" ? active : (k.enrollments ?? []);
      if (noGroupOnly && active.length > 0) return false;
      if (churnOnly && !k.churn_risk_at) return false;
      if (direction !== "all" && !pool.some((e) => groupInfo.get(e.group_id)?.category === direction)) return false;
      if (coachId !== "all" && !pool.some((e) => groupInfo.get(e.group_id)?.coachId === coachId)) return false;
      if (sectionId !== "all" && !pool.some((e) => e.group?.section_id === sectionId)) return false;
      if (groupId !== "all" && !pool.some((e) => e.group_id === groupId)) return false;
      return true;
    });
    if (sortBy === "name") return list;  // уже по имени с сервера
    return [...list].sort((a, b) => sortBy === "newest"
      ? b.created_at.localeCompare(a.created_at)
      : a.created_at.localeCompare(b.created_at));
  }, [q, kids, sectionId, groupId, noGroupOnly, statusFilter, direction, coachId, churnOnly, sortBy, groupInfo]);
  // Любая смена фильтра — на первую страницу.
  useEffect(() => { setPage(0); }, [q, sectionId, groupId, noGroupOnly, statusFilter, direction, coachId, churnOnly, sortBy]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const currentCount = useMemo(() => kids.filter((k) => isCurrent(k.status)).length, [kids]);

  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  return (
    <>
      <PageHeader
        title={t("Дети", "Балдар")}
        subtitle={isLoading ? <SkeletonText /> : t(
          `${currentCount} занимаются сейчас · всего в базе ${kids.length}`,
          `${currentCount} азыр катышат · базада бардыгы ${kids.length}`,
        )}
        actions={
          <Gate perm="edit_kids">
            <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" /> {t("Новый ребёнок", "Жаңы бала")}
            </button>
          </Gate>
        }
      />

      <AddChildModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        lang={lang}
        onCreated={(childId, training) => { if (training) setSellFor({ childId, ...training }); }}
      />
      {/* Монтируем только по требованию: продажа грузит все абонементы,
          а самой странице «Клиенты» они не нужны. */}
      {sellFor && (
        <SellCardModal
          open
          onClose={() => setSellFor(null)}
          lang={lang}
          presetChildId={sellFor.childId}
          initialSectionId={sellFor.sectionId}
          initialGroupId={sellFor.groupId || undefined}
        />
      )}
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
          <div className="tabs">
            {([
              ["current", t("Занимаются", "Катышат")],
              ["former", t("Бывшие", "Мурунку")],
              ["all", t("Все", "Баары")],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                className={`tabs__btn ${statusFilter === id ? "is-active" : ""}`}
                onClick={() => { setStatusFilter(id); setGroupId("all"); }}
              >
                {label}
              </button>
            ))}
          </div>
          <SearchBox value={q} onChange={setQ} placeholder={t("Имя ребёнка или родителя, телефон, номер карты…", "Баланын же ата-эненин аты, телефон, карта номери…")} />
          <Select value={direction} onChange={(e) => { setDirection(e.target.value as typeof direction); setSectionId("all"); setGroupId("all"); }} style={selectStyle}>
            <option value="all">{t("Единоборства и фитнес", "Күрөш жана фитнес")}</option>
            <option value="martial_arts">{t("Единоборства", "Күрөш өнөрлөрү")}</option>
            <option value="fitness">{t("Фитнес", "Фитнес")}</option>
          </Select>
          <Select
            value={sectionId}
            onChange={(e) => { setSectionId(e.target.value); setGroupId("all"); }}
            style={selectStyle}
          >
            <option value="all">{t("Все секции", "Бардык секциялар")}</option>
            {sections
              .filter((s: any) => direction === "all" || s.category === direction)
              .map((s) => (
                <option key={s.id} value={s.id}>{lang === "ru" ? s.name_ru : s.name_ky}</option>
              ))}
          </Select>
          <Select value={coachId} onChange={(e) => { setCoachId(e.target.value); setGroupId("all"); }} style={selectStyle}>
            <option value="all">{t("Все тренеры", "Бардык тренерлер")}</option>
            {coachOptions.map(([id, c]) => (
              <option key={id} value={id}>{c.name}{c.active ? "" : t(" (бывший)", " (мурунку)")}</option>
            ))}
          </Select>
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={selectStyle}>
            <option value="all">{t("Все группы", "Бардык топтор")}</option>
            {groupsForSection
              .filter((g: any) => (direction === "all" || g.section?.category === direction) && (coachId === "all" || g.coach_id === coachId))
              .map((g: any) => (
                <option key={g.id} value={g.id}>{g.name}{g.is_active ? "" : t(" (архив)", " (архив)")}</option>
              ))}
          </Select>
          <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} style={selectStyle}>
            <option value="name">{t("По имени", "Аты боюнча")}</option>
            <option value="newest">{t("Сначала новые", "Адегенде жаңылар")}</option>
            <option value="oldest">{t("Сначала давние", "Адегенде эскилер")}</option>
          </Select>
          <label className="check" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={noGroupOnly}
              onChange={(e) => setNoGroupOnly(e.target.checked)}
            />
            <span><b>{t("Без группы", "Топсуз")}</b></span>
          </label>
          <label className="check" style={{ margin: 0 }}>
            <input type="checkbox" checked={churnOnly} onChange={(e) => setChurnOnly(e.target.checked)} />
            <span><b>{t("Риск оттока", "Агып кетүү коркунучу")}</b></span>
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
                {pageRows.map((k) => {
                  const family = k.family;
                  // У загруженных из Excel имён родителей нет — показываем телефон.
                  const familyLabel = family
                    ? [family.father_name, family.mother_name].filter(Boolean).join(" / ")
                      || [family.father_phone, family.mother_phone].filter(Boolean).join(", ")
                      || "—"
                    : "—";
                  const activeEnroll = (k.enrollments ?? []).filter((e) => e.archived_at == null);
                  // Нет текущей группы — показываем последнюю, где занимался.
                  const lastEnroll = activeEnroll.length === 0
                    ? [...(k.enrollments ?? [])].sort((a, b) => (b.archived_at ?? "").localeCompare(a.archived_at ?? ""))[0]
                    : undefined;
                  const groupsLabel = activeEnroll.length > 0
                    ? activeEnroll.map((e) => e.group?.name).filter(Boolean).join(", ")
                    : lastEnroll?.group?.name
                      ? `${t("был:", "болгон:")} ${lastEnroll.group.name}`
                      : "—";
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
                        {k.birth_date ? `${ageFromDob(k.birth_date)} ${t("лет", "жаш")}` : <span style={{ color: "var(--muted-2)" }}>—</span>}
                      </td>
                      <td>
                        <span className={`pill pill--${k.status}`}>{STATUS_LABEL[k.status]?.[lang] ?? k.status}</span>
                        {/* ТЗ §4.5: флаг «риск оттока» — нет посещений 10+ дней */}
                        {k.churn_risk_at && (
                          <span
                            className="pill"
                            title={t("Нет посещений 10+ дней", "10+ күн катышуу жок")}
                            style={{
                              marginLeft: 4,
                              background: "var(--red-50, var(--bg-soft))",
                              color: "var(--red-600)",
                            }}
                          >
                            {t("риск оттока", "агып кетүү коркунучу")}
                          </span>
                        )}
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>
                {t(
                  `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, rows.length)} из ${rows.length}`,
                  `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, rows.length)} / ${rows.length}`,
                )}
              </span>
              {pageCount > 1 && (
                <div style={{ display: "flex", gap: 4, marginLeft: "auto", alignItems: "center" }}>
                  <button className="btn btn--ghost" style={{ padding: "4px 10px" }} disabled={page === 0} onClick={() => setPage(0)}>«</button>
                  <button className="btn btn--ghost" style={{ padding: "4px 10px" }} disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
                  <span style={{ padding: "0 8px" }}>{t(`Стр. ${page + 1} из ${pageCount}`, `${page + 1}-бет / ${pageCount}`)}</span>
                  <button className="btn btn--ghost" style={{ padding: "4px 10px" }} disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>›</button>
                  <button className="btn btn--ghost" style={{ padding: "4px 10px" }} disabled={page >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>»</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
