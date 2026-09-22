// RBAC matrix — single source of truth for UI gating.
// Mirrors the matrix described in ТЗ §2 and the Postgres helpers in
// supabase/migrations/20260510000002_rls_helpers_v2.sql.

import { useAuth } from "./AuthProvider";

export type AppRole =
  | "director"
  | "fitness_director"
  | "senior_manager"
  | "manager"
  | "cashier"
  | "coach"
  | "parent";

export type Permission =
  // Clients
  | "view_kids"
  | "edit_kids"
  | "view_parents"
  | "edit_parents"
  // Schedule
  | "view_schedule"
  | "manage_schedule"
  // Sales / payments
  | "sell_cards"
  | "receive_payment"
  // Сверка по кассе: исправить нал/безнал у уже принятого платежа
  // (зеркало PATCH /v1/payments/:id/method на бэкенде)
  | "correct_payments"
  // Снять тренировки с абонемента (POST /v1/cards/remove-lessons): старший
  // менеджер и выше — решение офиса 2026-09-02
  | "remove_card_lessons"
  | "refund_with_30pct"
  | "cancel_30pct"
  // Freezes
  | "approve_freezes"
  | "create_freeze"
  // Sales funnel
  | "view_leads"
  | "edit_leads"
  // Coaches & payroll
  | "manage_coaches"
  | "manage_coach_rates"
  | "view_payroll"
  | "approve_payroll"
  | "view_own_payroll"
  // Reports
  | "view_finance_reports"
  // Personal trainings (ПТ)
  | "view_pt"
  | "manage_pt"
  | "sell_pt"
  // Admin
  | "manage_sections"
  | "manage_card_plans"
  | "view_archive"
  | "system_settings"
  | "manage_users"
  // Проходная: страница турникетов + команды двери + лица (зеркало SALES_ROLES
  // бэкенда hik.ts; 09-22 — решение директора: менеджеры тоже)
  | "manage_turnstiles"
  // Тумблер/параметры «Доступ по расписанию» — политика на всё здание,
  // только старшие (зеркало SCHEDULE_ROLES в PATCH /v1/hik/settings)
  | "manage_access_settings";

const ALL_OFFICE: Permission[] = [
  "view_kids", "view_parents", "view_schedule",
  "view_leads",
];

export const RBAC: Record<AppRole, Permission[]> = {
  // Director — owns everything.
  director: [
    "view_kids", "edit_kids",
    "view_parents", "edit_parents",
    "view_schedule", "manage_schedule",
    "sell_cards", "receive_payment", "correct_payments", "remove_card_lessons",
    "refund_with_30pct", "cancel_30pct",
    "approve_freezes", "create_freeze",
    "view_leads", "edit_leads",
    "manage_coaches", "manage_coach_rates",
    "view_payroll", "approve_payroll",
    "view_finance_reports",
    // Каталог видов абонементов правит только директор — зеркало RLS
    // (card_plans_director_*: is_director()).
    "manage_sections", "manage_card_plans", "view_archive",
    "system_settings",
    "manage_users",
    "view_pt", "manage_pt", "sell_pt",
    "manage_turnstiles", "manage_access_settings",
  ],

  // Fitness Director — everything except system settings.
  fitness_director: [
    "view_kids", "edit_kids",
    "view_parents", "edit_parents",
    "view_schedule", "manage_schedule",
    "sell_cards", "receive_payment", "correct_payments", "remove_card_lessons",
    "refund_with_30pct", "cancel_30pct",
    "approve_freezes", "create_freeze",
    "view_leads", "edit_leads",
    "manage_coaches", "manage_coach_rates",
    "view_payroll", "approve_payroll",
    "view_finance_reports",
    "manage_sections", "view_archive",
    "view_pt", "manage_pt", "sell_pt",
    "manage_turnstiles", "manage_access_settings",
  ],

  // Senior Manager — sales, schedule, freezes, refunds (incl. cancel 30%),
  // finance reports. Can create coach + parent accounts (per user request).
  senior_manager: [
    "view_kids", "edit_kids",
    "view_parents", "edit_parents",
    "view_schedule", "manage_schedule",
    "sell_cards", "receive_payment", "correct_payments", "remove_card_lessons",
    "refund_with_30pct", "cancel_30pct",
    "approve_freezes",
    "view_leads", "edit_leads",
    "view_finance_reports",
    "manage_coaches",
    "view_pt", "manage_pt", "sell_pt",
    "manage_turnstiles", "manage_access_settings",
  ],

  // Manager — clients/sales/leads. Cannot cancel 30%.
  // Видит ВСЮ базу детей (решение директора 08-20: can_see_all_children()
  // включает manager) — создаёт клиентов, продаёт и записывает в группы
  // любому ребёнку; responsible_manager_id остался как учётная привязка.
  // 08-22: + manage_schedule — правит тренировки (создание/перенос/отмена),
  // зеркало бэкенда lessons.ts / lessons-bulk.ts. + manage_sections —
  // редактирует секции и группы (RLS и так пускал весь staff).
  manager: [
    "view_kids", "edit_kids",
    "view_parents", "edit_parents",
    "view_schedule", "manage_schedule",
    "sell_cards", "receive_payment",
    "refund_with_30pct",
    "view_leads", "edit_leads",
    "manage_coaches", "manage_sections",
    "approve_freezes", "create_freeze",
    "view_pt", "sell_pt",
    "manage_turnstiles",
  ],

  // Cashier — read-only on clients + receive payment. Видит live-зарплаты
  // тренеров (просмотр без правок).
  cashier: [
    ...ALL_OFFICE,
    "receive_payment", "correct_payments",
    "view_payroll",
    "view_pt", "sell_pt",
  ],

  // Coach — own schedule + see own payroll. Заморозки у тренера НЕТ
  // (решение клиента 2026-08-04, бэкенд тоже не пускает).
  coach: [
    "view_schedule",
    "view_own_payroll",
  ],

  // Parent — own data + own schedule. Заморозку запрашивает через офис.
  parent: [
    "view_schedule",
  ],
};

export const can = (role: AppRole | undefined, perm: Permission): boolean => {
  if (!role) return false;
  return RBAC[role].includes(perm);
};

export const canAny = (role: AppRole | undefined, perms: Permission[]): boolean =>
  perms.some((p) => can(role, p));

// React hook — easy to drop into any component
export const usePerm = (perm: Permission): boolean => {
  const { user } = useAuth();
  return can(user?.role, perm);
};
