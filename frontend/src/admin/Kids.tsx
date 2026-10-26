import { useMemo, useState } from "react";
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
const isCurrent = (status: string) => status === "active" || status === "frozen" || status === "debtor";

export const KidsPage = ({ lang }: { lang: Lang }) => {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("current");
  const [sectionId, setSectionId] = useState<string>("all");
  const [groupId, setGroupId] = useState<string>("all");
  const [noGroupOnly, setNoGroupOnly] = useState(false);
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

  // Поиск по ТЗ §3.1: ФИО ученика, ФИО родителя, телефон, номер карты / ID.
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const qDigits = qq.replace(/\D/g, "");
    // Телефон сравниваем по последним 9 цифрам — «+996 555…», «0555…» и «555…» совпадут.
    const qPhone = qDigits.length >= 3 ? qDigits.slice(-9) : "";
    const phoneMatch = (ph?: string | null) => !!ph && !!qPhone && ph.replace(/\D/g, "").includes(qPhone);
    return kids.filter((k) => {
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
      if (sectionId !== "all" && !pool.some((e) => e.group?.section_id === sectionId)) return false;
      if (groupId !== "all" && !pool.some((e) => e.group_id === groupId)) return false;
      return true;
    });
  }, [q, kids, sectionId, groupId, noGroupOnly, statusFilter]);
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
              <option key={g.id} value={g.id}>{g.name}{g.is_active ? "" : t(" (архив)", " (архив)")}</option>
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
          </div>
        )}
      </div>
    </>
  );
};
