import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState, formatCurrency, initialsOf } from "./common";
import { useCards, useChildren, useManagers, useCoaches, useGroups } from "../shared/api/queries";
import { SellCardModal } from "../shared/ui/forms";
import { CardPlansPanel } from "./CardPlans";
import { ChildDrawer } from "./ChildDrawer";
import { Gate } from "../shared/auth/Gate";
import { usePerm } from "../shared/auth/rbac";
import type { CardStatus } from "../shared/types/database";
import { DateInput } from "../shared/ui/DateInput";
import { SkeletonRows, SkeletonText } from "../shared/ui/Skeleton";
import { Select } from "../shared/ui/Select";

const statusLbl: Record<string, { ru: string; ky: string }> = {
  active: { ru: "Активен", ky: "Активдүү" },
  ending: { ru: "Истекает", ky: "Бүтөт" },
  expired: { ru: "Истёк", ky: "Бүттү" },
  frozen: { ru: "Заморожен", ky: "Тындырылган" },
  debt: { ru: "Долг", ky: "Карыз" },
  archived: { ru: "Архив", ky: "Архив" },
};

const cardTypeLbl: Record<string, { ru: string; ky: string }> = {
  monthly: { ru: "Месячный", ky: "Айлык" },
  quarterly: { ru: "3 месяца", ky: "3 ай" },
  nine_month: { ru: "9 месяцев", ky: "9 ай" },
  half_year: { ru: "6 месяцев", ky: "6 ай" },
  annual: { ru: "12 месяцев", ky: "12 ай" },
  personal: { ru: "Персональный", ky: "Жеке" },
  single: { ru: "Разовый", ky: "Бирдик" },
  trial: { ru: "Пробный", ky: "Сыноо" },
};

export const CardsPage = ({ lang }: { lang: Lang }) => {
  const [q, setQ] = useState("");
  // «Проданные» — таблица карт детей; «Виды абонементов» — каталог card_plans,
  // который клуб ведёт сам (создаёт директор, менеджеры выбирают при продаже).
  const [view, setView] = useState<"sold" | "plans">("sold");
  const [filter, setFilter] = useState<"all" | CardStatus>("all");
  const [sellOpen, setSellOpen] = useState(false);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const { data: cards = [], isLoading, error } = useCards();
  const { data: kids = [] } = useChildren();
  // Фильтры: ответственный менеджер ребёнка, тренер (через активные
  // группы ребёнка) и период по дате начала карты («Куплен»).
  const { data: managers = [] } = useManagers();
  const { data: coaches = [] } = useCoaches();
  const { data: groups = [] } = useGroups();
  const [managerId, setManagerId] = useState("");
  const [coachId, setCoachId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // К какой дате применяется период: продажа (created_at), старт или
  // окончание карты. При выборе статуса «Истекает»/«Истёк» автоматически
  // переключаемся на дату окончания — «что истекает в этот период».
  const [dateMode, setDateMode] = useState<"sold" | "start" | "end">("sold");
  const canSell = usePerm("sell_cards");
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  // Архивные абонементы видны только в разделе «Архив» — на главной странице
  // абонементов скрываем независимо от выбранного фильтра.
  const visible = useMemo(() => cards.filter((c) => c.status !== "archived"), [cards]);

  const kidById = useMemo(() => new Map(kids.map((k) => [k.id, k])), [kids]);
  const coachByGroupId = useMemo(
    () => new Map((groups as any[]).map((g) => [g.id, g.coach_id])),
    [groups],
  );

  const rows = useMemo(() => {
    let list = visible;
    if (filter !== "all") list = list.filter((c) => c.status === filter);
    if (managerId) {
      list = list.filter((c) => (kidById.get(c.child_id) as any)?.responsible_manager_id === managerId);
    }
    if (coachId) {
      list = list.filter((c) => {
        const k = kidById.get(c.child_id) as any;
        return (k?.enrollments ?? []).some(
          (e: any) => e.archived_at == null && coachByGroupId.get(e.group_id) === coachId,
        );
      });
    }
    // Дата для периода зависит от dateMode: «продажа» = created_at
    // (менеджеры продают задним числом, старт ≠ день оформления),
    // «старт»/«окончание» = период действия карты.
    const dateKey = (c: (typeof visible)[number]): string =>
      dateMode === "sold" ? ((c as any).created_at ?? "").slice(0, 10) :
      dateMode === "start" ? c.start_date : c.end_date;
    if (dateFrom) list = list.filter((c) => dateKey(c) >= dateFrom);
    if (dateTo) list = list.filter((c) => dateKey(c) <= dateTo);
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter((c) => c.child?.full_name.toLowerCase().includes(qq));
    return list;
  }, [q, filter, visible, managerId, coachId, dateFrom, dateTo, dateMode, kidById, coachByGroupId]);

  const totalRevenue = visible.reduce((s, c) => s + Number(c.price_paid), 0);
  // «Живые» абонементы: active + ending (5 дней до конца) + frozen (на паузе,
  // но это всё ещё подписка). Если считать только 'active', карта на
  // заморозке выпадает из счётчика — некорректно, заморозка не выкидывает
  // подписку из клуба.
  const activeCount = visible.filter((c) =>
    c.status === "active" || c.status === "ending" || c.status === "frozen",
  ).length;

  return (
    <>
      <PageHeader
        title={t("Абонементы", "Абонементтер")}
        subtitle={view === "plans"
          ? t("Виды абонементов — каталог для продажи", "Абонемент түрлөрү — сатуу каталогу")
          : isLoading ? <SkeletonText /> : t(`${activeCount} активных · ${formatCurrency(totalRevenue)} оборот`, `${activeCount} активдүү · ${formatCurrency(totalRevenue)}`)}
        actions={
          view === "sold" && (
            <Gate perm="sell_cards">
              <button className="btn btn--primary" onClick={() => setSellOpen(true)}>
                <Icon name="plus" /> {t("Продать", "Сатуу")}
              </button>
            </Gate>
          )
        }
      />

      <div className="card">
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <div className="tabs">
            <button className={`tabs__btn ${view === "sold" ? "is-active" : ""}`} onClick={() => setView("sold")}>
              {t("Проданные", "Сатылгандар")}
            </button>
            <button className={`tabs__btn ${view === "plans" ? "is-active" : ""}`} onClick={() => setView("plans")}>
              {t("Виды абонементов", "Абонемент түрлөрү")}
            </button>
          </div>
          {view === "sold" && (
            <>
              <SearchBox value={q} onChange={setQ} placeholder={t("Поиск по ребёнку…", "Бала боюнча…")} />
              <div className="tabs">
                {(["all", "active", "ending", "expired", "frozen", "debt"] as const).map((f) => (
                  <button
                    key={f}
                    className={`tabs__btn ${filter === f ? "is-active" : ""}`}
                    onClick={() => {
                      setFilter(f);
                      // «Истекает»/«Истёк» + даты почти всегда значит «истекающие
                      // в этот период» — переключаем режим дат на окончание.
                      setDateMode(f === "ending" || f === "expired" ? "end" : "sold");
                    }}
                  >
                    {f === "all" ? t("Все", "Баары") : statusLbl[f][lang]}
                  </button>
                ))}
              </div>
              <Select
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
                title={t("Фильтр по ответственному менеджеру", "Жооптуу менеджер боюнча")}
                style={{ maxWidth: 190 }}
              >
                <option value="">{t("Менеджер: все", "Менеджер: баары")}</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </Select>
              <Select
                value={coachId}
                onChange={(e) => setCoachId(e.target.value)}
                title={t("Фильтр по тренеру (по активным группам ребёнка)", "Тренер боюнча")}
                style={{ maxWidth: 190 }}
              >
                <option value="">{t("Тренер: все", "Тренер: баары")}</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </Select>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Select
                  value={dateMode}
                  onChange={(e) => setDateMode(e.target.value as "sold" | "start" | "end")}
                  title={t("К какой дате применяется период", "Мезгил кайсы күнгө колдонулат")}
                  style={{ maxWidth: 150 }}
                >
                  <option value="sold">{t("Дата продажи", "Сатуу күнү")}</option>
                  <option value="start">{t("Дата старта", "Башталуу күнү")}</option>
                  <option value="end">{t("Дата окончания", "Бүтүү күнү")}</option>
                </Select>
                <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <span style={{ color: "var(--muted)" }}>—</span>
                <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              {(managerId || coachId || dateFrom || dateTo) && (
                <button
                  className="btn btn--ghost"
                  style={{ padding: "6px 10px", fontSize: 12 }}
                  onClick={() => { setManagerId(""); setCoachId(""); setDateFrom(""); setDateTo(""); }}
                >
                  {t("Сбросить", "Тазалоо")}
                </button>
              )}
            </>
          )}
        </div>
        {view === "plans" ? <CardPlansPanel lang={lang} /> :
          error ? <EmptyState title={t("Ошибка", "Ката")} hint={error.message} /> :
          isLoading ? <SkeletonRows /> :
          rows.length === 0 ? <EmptyState title={t("Абонементов нет", "Абонементтер жок")} /> : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t("Ребёнок", "Бала")}</th>
                    <th>{t("Тип", "Түрү")}</th>
                    <th>{t("Куплен", "Сатылды")}</th>
                    <th>{t("Действует до", "Мөөнөтү")}</th>
                    <th className="num">{t("Цена", "Баасы")}</th>
                    <th>{t("Статус", "Абалы")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const isSingle = c.type === "single";
                    return (
                      <tr key={c.id} onClick={() => setActiveChildId(c.child_id)}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div className="call-row__avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                              {c.child ? initialsOf(c.child.full_name) : "?"}
                            </div>
                            <div className="cell-main">{c.child?.full_name ?? c.child_id.slice(0, 8)}</div>
                          </div>
                        </td>
                        <td>
                          {cardTypeLbl[c.type]?.[lang] ?? c.type}
                          {c.total_lessons ? ` · ${c.total_lessons}` : ""}
                          {isSingle && (
                            <span
                              className={`pill pill--${c.status === "expired" ? "expired" : "active"}`}
                              style={{ marginLeft: 6, fontSize: 10 }}
                            >
                              {c.status === "expired" ? t("сгорел", "күйдү") : t("1 раз", "1 жолу")}
                            </span>
                          )}
                        </td>
                        <td style={{ color: "var(--muted)" }}>
                          {new Date((c as any).created_at ?? c.start_date).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {t("старт", "башталышы")} {new Date(c.start_date).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}
                          </div>
                        </td>
                        <td>{new Date(c.end_date).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}</td>
                        <td className="num">{formatCurrency(Number(c.price_paid))}</td>
                        <td><span className={`pill pill--${c.status}`}>{statusLbl[c.status]?.[lang] ?? c.status}</span></td>
                        <td style={{ textAlign: "right", width: 1, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <SellCardModal open={sellOpen} onClose={() => setSellOpen(false)} lang={lang} />
      {activeChildId && (
        <ChildDrawer
          childId={activeChildId}
          child={kids.find((k) => k.id === activeChildId)}
          open={!!activeChildId}
          onClose={() => setActiveChildId(null)}
          lang={lang}
        />
      )}
    </>
  );
};
