import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import type { ComponentType } from "react";
import { I18N, MIcon } from "./data";
import type { Lang } from "./data";
// Каждая admin-страница — отдельный чанк: грузится только открытая, остальные
// подгружаются по клику. Резко уменьшает начальный бандл админки.
const DashboardPage = lazy(() => import("./admin/Dashboard").then((m) => ({ default: m.DashboardPage })));
const KidsPage = lazy(() => import("./admin/Kids").then((m) => ({ default: m.KidsPage })));
const ParentsPage = lazy(() => import("./admin/Parents").then((m) => ({ default: m.ParentsPage })));
const SchedulePage = lazy(() => import("./admin/Schedule").then((m) => ({ default: m.SchedulePage })));
const CardsPage = lazy(() => import("./admin/Cards").then((m) => ({ default: m.CardsPage })));
const FreezesPage = lazy(() => import("./admin/Freezes").then((m) => ({ default: m.FreezesPage })));
const PaymentsPage = lazy(() => import("./admin/Payments").then((m) => ({ default: m.PaymentsPage })));
const LeadsPage = lazy(() => import("./admin/Leads").then((m) => ({ default: m.LeadsPage })));
const CoachesPage = lazy(() => import("./admin/Coaches").then((m) => ({ default: m.CoachesPage })));
const SectionsPage = lazy(() => import("./admin/Sections").then((m) => ({ default: m.SectionsPage })));
const GroupsPage = lazy(() => import("./admin/Groups").then((m) => ({ default: m.GroupsPage })));
const SettingsPage = lazy(() => import("./admin/Settings").then((m) => ({ default: m.SettingsPage })));
const ReportsPage = lazy(() => import("./admin/Reports").then((m) => ({ default: m.ReportsPage })));
const ArchivePage = lazy(() => import("./admin/Archive").then((m) => ({ default: m.ArchivePage })));
const CoachRatesPage = lazy(() => import("./admin/CoachRates").then((m) => ({ default: m.CoachRatesPage })));
const PayrollPage = lazy(() => import("./admin/Payroll").then((m) => ({ default: m.PayrollPage })));
const RefundsPage = lazy(() => import("./admin/Refunds").then((m) => ({ default: m.RefundsPage })));
const UsersPage = lazy(() => import("./admin/Users").then((m) => ({ default: m.UsersPage })));
const PersonalTrainingsPage = lazy(() => import("./admin/PersonalTrainings").then((m) => ({ default: m.PersonalTrainingsPage })));
const DebtorsPage = lazy(() => import("./admin/Debtors").then((m) => ({ default: m.DebtorsPage })));
import { useStats, useAllCardDebts } from "./shared/api/queries";
import { useAuth } from "./shared/auth/AuthProvider";
import { can, type Permission } from "./shared/auth/rbac";
import { SkeletonPage } from "./shared/ui/Skeleton";

type NavId =
  | "dash"
  | "kids"
  | "parents"
  | "schedule"
  | "cards"
  | "pt"
  | "payments"
  | "debtors"
  | "freezes"
  | "leads"
  | "reports"
  | "coaches"
  | "coachRates"
  | "payroll"
  | "refunds"
  | "sections"
  | "groups"
  | "archive"
  | "users"
  | "settings";

const PAGES: Record<NavId, ComponentType<{ lang: Lang }>> = {
  dash: DashboardPage,
  kids: KidsPage,
  parents: ParentsPage,
  schedule: SchedulePage,
  cards: CardsPage,
  pt: PersonalTrainingsPage,
  payments: PaymentsPage,
  debtors: DebtorsPage,
  freezes: FreezesPage,
  leads: LeadsPage,
  reports: ReportsPage,
  coaches: CoachesPage,
  coachRates: CoachRatesPage,
  payroll: PayrollPage,
  refunds: RefundsPage,
  sections: SectionsPage,
  groups: GroupsPage,
  archive: ArchivePage,
  users: UsersPage,
  settings: SettingsPage,
};

// `dash` always visible — every office role sees a (role-filtered) dashboard.
// [id, materialIconName, label, permission, badge?]
type NavItem = [NavId, string, string, Permission | null, number?];

const SIDEBAR_COLLAPSED_KEY = "uq_sidebar_collapsed";

export const AdminDashboard = ({ lang }: { lang: Lang }) => {
  const t = I18N[lang].admin;
  const { user } = useAuth();
  const [activeNav, setActiveNav] = useState<NavId>("dash");
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  const { data: stats } = useStats();
  const { data: debtors } = useAllCardDebts();
  const debtorsCount = (debtors ?? []).filter((d) => d.known && d.total > 0).length;

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  const NAV_RAW: { group: string; items: NavItem[] }[] = useMemo(() => [
    {
      group: t.section.operations,
      items: [
        ["dash",     "space_dashboard",    t.nav.dash,      null],
        ["kids",     "child_care",         t.nav.kids,      "view_kids",     stats?.activeKids],
        ["parents",  "family_restroom",    t.nav.parents,   "view_parents",  stats?.families],
        ["schedule", "calendar_month",     t.nav.schedule,  "view_schedule"],
        ["cards",    "credit_card",        t.nav.cards,     "sell_cards",    stats?.cardsActive],
        ["pt",       "fitness_center",     lang === "ru" ? "Персональные" : "Жеке машыгуу", "view_pt"],
        ["payments", "payments",           t.nav.payments,  "receive_payment"],
        // Должники по абонементам — просьба офиса 2026-09-18. Бейдж = число
        // детей с подтверждённым долгом.
        ["debtors",  "report",             lang === "ru" ? "Должники" : "Карызкорлор", "receive_payment", debtorsCount || undefined],
        // Страница существовала с самого начала, но пункта в меню не было —
        // офис не мог оформить возврат (жалоба 2026-08-27).
        ["refunds",  "currency_exchange",  lang === "ru" ? "Возвраты" : "Кайтаруулар", "refund_with_30pct"],
      ],
    },
    {
      group: t.section.analytics,
      items: [
        ["leads",   "filter_alt",  t.nav.leads,    "view_leads",            stats?.leadsNew || undefined],
        ["reports", "bar_chart",   lang === "ru" ? "Отчёты" : "Отчёттор", "view_finance_reports"],
      ],
    },
    {
      group: t.section.setup,
      items: [
        ["coaches",    "sports",                  t.nav.coaches,    "manage_coaches", stats?.coaches],
        ["payroll",    "account_balance_wallet",  (t.nav as any).payroll,    "view_payroll"],
        ["sections",   "category",                t.nav.sections,   "manage_sections"],
        ["groups",     "groups",                  (t.nav as any).groups, "manage_sections"],
        ["users",      "badge",                   lang === "ru" ? "Сотрудники" : "Кызматкерлер", "manage_users"],
        ["archive",    "inventory_2",             t.nav.archive,    "view_archive"],
        ["settings",   "settings",                t.nav.settings,   "system_settings"],
      ],
    },
  ], [t, stats, lang, debtorsCount]);

  const NAV = useMemo(() => NAV_RAW
    .map((g) => ({
      ...g,
      items: g.items.filter(([, , , perm]) => perm === null || can(user?.role, perm)),
    }))
    .filter((g) => g.items.length > 0), [NAV_RAW, user?.role]);

  // If user lost access to the active tab (role change / hot-reload), fall back to dash.
  useEffect(() => {
    const allIds = NAV.flatMap((g) => g.items.map((i) => i[0]));
    if (!allIds.includes(activeNav)) setActiveNav("dash");
  }, [NAV, activeNav]);

  const Page = PAGES[activeNav];

  return (
    <div className={`admin ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Главное меню">
        <button
          type="button"
          className="sidebar__toggle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? (lang === "ru" ? "Развернуть меню" : "Менюну ачуу") : (lang === "ru" ? "Свернуть меню" : "Менюну жабуу")}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        >
          <MIcon name={collapsed ? "menu" : "menu_open"} size={22} />
        </button>

        <nav className="sidebar__nav">
          {NAV.map((g, gi) => (
            <div key={gi} className="sidebar__group">
              {!collapsed && <div className="sidebar__section">{g.group}</div>}
              {g.items.map(([id, icon, label, , badge]) => {
                const isActive = activeNav === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`nav-item ${isActive ? "is-active" : ""}`}
                    onClick={() => setActiveNav(id)}
                    title={collapsed ? label : undefined}
                  >
                    <span className="nav-item__icon">
                      <MIcon name={icon} size={22} fill={isActive} weight={isActive ? 500 : 400} />
                    </span>
                    {!collapsed && <span className="nav-item__label">{label}</span>}
                    {typeof badge === "number" && badge > 0 && !collapsed && (
                      <span
                        className="nav-item__badge"
                        style={
                          id === "leads"
                            ? { background: "var(--red-50)", color: "var(--red-600)" }
                            : { background: "var(--bg-soft)", color: "var(--muted)" }
                        }
                      >
                        {badge}
                      </span>
                    )}
                    {typeof badge === "number" && badge > 0 && collapsed && (
                      <span className="nav-item__dot" style={{ background: id === "leads" ? "var(--red-600)" : "var(--blue)" }} />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main">
        <Suspense fallback={<SkeletonPage />}>
          <Page lang={lang} />
        </Suspense>
      </div>
    </div>
  );
};
