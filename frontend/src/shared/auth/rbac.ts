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
  | "manage_users";

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
  ],

  // Ресепшен / кассир — ТЗ §2.1: «приём оплаты, расписание, базовая
  // работа с клиентами». По матрице §2.2 у него ❌ на продажи,
  // редактирование клиентов и финансовые отчёты.
  //
  // Убрано при сверке с матрицей:
  //   view_payroll — зарплаты тренеров это финансовые данные (§2.2
  //     «Финансовые отчёты ❌»), а ресепшен видел их живьём;
  //   sell_pt — продажа персональных тренировок это продажа (§2.2
  //     «Продажи ❌»). Противоречило и самому набору: sell_cards у
  //     ресепшена не было.
  cashier: [
    ...ALL_OFFICE,
    "receive_payment", "correct_payments",
    "view_pt",
  ],

  // Coach — own schedule + see own payroll. Заморозки у тренера НЕТ
  // (решение клиента 2026-08-04, бэкенд тоже не пускает).
  coach: [
    "view_schedule",
    "view_own_payroll",
    // ТЗ §4.3: заморозку ставит менеджер ИЛИ тренер через своё приложение.
    // Тренер создаёт заявку (pending) — подтверждает офис.
    "create_freeze",
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

// =====================================================================
// Матрица прав доступа ТЗ §2.2 — в коде, а не только в документе
//
// Таблица из ТЗ перенесена сюда буквально, строка в строку. Смысл не в
// том, чтобы продублировать RBAC, а в том, чтобы расхождение с ТЗ было
// видно сразу, а не находилось сверкой вручную через полгода. Проверка
// гоняется только в dev — в проде это мёртвый код, который выкинет
// сборщик.
//
// Колонки: директор, управляющий, ст. менеджер, менеджер, ресепшен.
// =====================================================================
const TZ_ROLES = ["director", "fitness_director", "senior_manager", "manager", "cashier"] as const;

const TZ_MATRIX: Array<{ row: string; perm: Permission; allow: readonly boolean[] }> = [
  { row: "Просмотр клиентов",        perm: "view_kids",             allow: [true,  true,  true,  true,  true]  },
  { row: "Редактирование клиентов",  perm: "edit_kids",             allow: [true,  true,  true,  true,  false] },
  { row: "Продажи",                  perm: "sell_cards",            allow: [true,  true,  true,  true,  false] },
  { row: "Возврат с удержанием 30%", perm: "refund_with_30pct",     allow: [true,  true,  true,  true,  false] },
  { row: "Возврат без удержания",    perm: "cancel_30pct",          allow: [true,  true,  true,  false, false] },
  { row: "Ставки тренеров",          perm: "manage_coach_rates",    allow: [true,  true,  false, false, false] },
  { row: "Утверждение зарплат",      perm: "approve_payroll",       allow: [true,  true,  false, false, false] },
  { row: "Финансовые отчёты",        perm: "view_finance_reports",  allow: [true,  true,  true,  false, false] },
  { row: "Управление расписанием",   perm: "manage_schedule",       allow: [true,  true,  true,  false, false] },
  { row: "Настройки системы",        perm: "system_settings",       allow: [true,  false, false, false, false] },
];

/**
 * Строки, где отклонение от матрицы сделано осознанно и согласовано.
 * Каждая — с причиной: без неё исключение через полгода не отличить от
 * забытой ошибки.
 */
const TZ_EXCEPTIONS: Record<string, string> = {
  "Управление расписанием/manager":
    "Противоречие внутри ТЗ: матрица §2.2 запрещает, а §5.3 прямо говорит " +
    "«менеджер вносит изменение и указывает причину» про отмену и перенос. " +
    "Оставлено как есть до ответа Академии (вопрос 3 в плане адаптации). " +
    "В базе can_manage_schedule() менеджера НЕ пускает — расписание он правит " +
    "через бэкенд, который ходит под service_role.",
};

export const auditRbacAgainstTz = (): string[] => {
  const problems: string[] = [];
  for (const { row, perm, allow } of TZ_MATRIX) {
    TZ_ROLES.forEach((role, i) => {
      const actual = RBAC[role].includes(perm);
      const expected = allow[i]!;
      if (actual === expected) return;
      if (TZ_EXCEPTIONS[`${row}/${role}`]) return;
      problems.push(
        `ТЗ §2.2 «${row}» для роли ${role}: ожидается ${expected ? "✅" : "❌"}, ` +
        `в RBAC ${actual ? "✅" : "❌"}`,
      );
    });
  }
  return problems;
};

if (import.meta.env.DEV) {
  const problems = auditRbacAgainstTz();
  if (problems.length > 0) {
    console.warn("[rbac] расхождения с матрицей ТЗ §2.2:\n" + problems.join("\n"));
  }
}
