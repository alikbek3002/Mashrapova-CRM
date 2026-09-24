// Database types — hand-crafted to match supabase/migrations/*.sql
// Regenerate via: npx supabase gen types typescript (requires Docker)

export type UserRole =
  | "director"
  | "fitness_director"
  | "senior_manager"
  | "manager"
  | "cashier"
  | "coach"
  | "parent";
export type ChildStatus = "active" | "frozen" | "expired" | "debtor" | "archived";
// therapy/developmental добавлены в 20260514000006; special — legacy.
// gymnastics/special/therapy/developmental — наследие движка Uniqum, в UI
// Академии Машрапова используются только martial_arts и fitness.
export type SectionCategory = "martial_arts" | "fitness" | "gymnastics" | "special" | "therapy" | "developmental";
export type LessonType = "regular" | "trial" | "single";
export type LessonStatus = "scheduled" | "completed" | "cancelled" | "force_majeure";
// ТЗ §5.3 п.4: причина отмены по существу. От неё зависит оплата тренера
// (coach — занятие не оплачивается) и компенсация клиенту (force_majeure).
export type LessonFault = "coach" | "club" | "force_majeure" | "client" | "other";
// nine_month — наследие Uniqum; у Академии Машрапова пакеты 1/3/6/12 месяцев (ТЗ §4.1).
export type CardType = "monthly" | "quarterly" | "half_year" | "annual" | "nine_month" | "personal" | "single" | "trial";
export type CardStatus = "active" | "ending" | "frozen" | "expired" | "debt" | "archived";
export type AttendanceStatus = "present" | "absent" | "excused" | "late" | "makeup";
export type FreezeStatus = "pending" | "approved" | "rejected";
export type FreezeInitiatorRole = "coach" | "manager";
export type PaymentMethod = "cash" | "terminal";
// Этапы воронки ТЗ §8.2. `waiting` — лист ожидания из движка Uniqum,
// оставлен, чтобы не потерять уже заведённые лиды.
export type LeadStage =
  | "new"
  | "contacted"
  | "trial_booked"
  | "trial_attended"
  | "no_show"
  | "converted"
  | "lost"
  | "waiting";

// Источники лидов ТЗ §8.1.
export type LeadSource = "target" | "referral" | "direct" | "other";
export type DepositTxType =
  | "top_up"
  | "withdraw"
  | "card_purchase"
  | "card_renewal"
  | "refund_in"
  | "service_charge"
  | "adjustment";

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

type Timestamps = {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type Organization = {
  id: string;
  name: string;
  timezone: string;
  phone: string | null;
  address: string | null;
  whatsapp_number: string | null;
  created_at: string;
};

export type Profile = Timestamps & {
  id: string;
  organization_id: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  is_active: boolean;
  mfa_required: boolean;
  // HR-расширение
  inn: string | null;
  birthday: string | null;
  hire_date: string | null;
  address: string | null;
  notes: string | null;
};

export type Family = Timestamps & {
  id: string;
  organization_id: string;
  parent_user_id: string | null;
  father_name: string | null;
  father_phone: string | null;
  mother_name: string | null;
  mother_phone: string | null;
  responsible_manager_id: string | null;
  comment: string | null;
  address: string | null;
  father_passport: string | null;
  mother_passport: string | null;
};

export type Child = Timestamps & {
  id: string;
  organization_id: string;
  family_id: string;
  full_name: string;
  birth_date: string;
  photo_path: string | null;
  card_number: string | null;
  status: ChildStatus;
  responsible_manager_id: string | null;
  source: ClientSource | null;
  // ТЗ §3.3 «Приведи друга»: ученик, который привёл этого клиента.
  referred_by_child_id: string | null;
  // ТЗ §4.5: помечен риском оттока (нет посещений 10+ дней). Снимается
  // автоматически при первом же посещении.
  churn_risk_at: string | null;
};

// Источник клиента (ТЗ §3.2).
export type ClientSource = "target" | "referral" | "other";
export type GroupAudience = "kids" | "adults" | "mixed";

// ТЗ §10.1 — модель оплаты тренера:
//   percent   — % от выручки занятия за каждого пришедшего (единоборства, 40%);
//   fixed     — оклад в месяц (дежурный тренер фитнес-зоны);
//   per_child — ставка за ребёнка (режим движка Uniqum).
export type CoachPayMode = "percent" | "fixed" | "per_child";

export type Coach = {
  id: string;
  bio: string | null;
  achievements: string | null;
  experience_years: number | null;
  pay_mode: CoachPayMode;
  percent_rate: number;
  fixed_monthly: number;
};

export type Section = Timestamps & {
  id: string;
  organization_id: string;
  name_ru: string;
  name_ky: string;
  category: SectionCategory;
  color: string | null;
  is_active: boolean;
};

export type Group = Timestamps & {
  id: string;
  organization_id: string;
  section_id: string;
  coach_id: string;
  name: string;
  max_capacity: number;
  hard_limit_override: boolean;
  duration_min: number;
  is_active: boolean;
  // Срок существования группы: набирают на год-два, после ends_on занятия
  // не генерируются (20260802000001). NULL = бессрочно.
  starts_on: string | null;
  ends_on: string | null;
  // Детали группы (20260807000003): секция — общее название, конкретика тут.
  age_min: number | null;
  age_max: number | null;
  level: string | null;
  // Аудитория (ТЗ §5.1, 20260925000001).
  audience: GroupAudience;
};

// Каталог тарифов абонементов (20260807000003): при продаже менеджер
// выбирает тариф, поля карты (цена/занятия/срок) заполняются из него.
export type CardPlan = {
  id: string;
  organization_id: string;
  name_ru: string;
  name_ky: string;
  type: CardType;
  duration_days: number;
  lessons_count: number | null;
  price: number;
  freeze_quota: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type GroupSchedule = {
  id: string;
  group_id: string;
  day_of_week: number;
  start_time: string;
  duration_min: number;
};

export type Lesson = {
  id: string;
  organization_id: string;
  group_id: string;
  coach_id: string;
  date: string;
  start_time: string;
  duration_min: number;
  type: LessonType;
  capacity_limit: number | null;
  status: LessonStatus;
  cancellation_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Enrollment = {
  id: string;
  child_id: string;
  group_id: string;
  enrolled_at: string;
  archived_at: string | null;
};

export type ClubCard = {
  id: string;
  organization_id: string;
  child_id: string;
  type: CardType;
  total_lessons: number | null;
  freeze_quota: number;
  price_paid: number;
  discount: number;
  discount_pct?: number | null;
  start_date: string;
  end_date: string;
  status: CardStatus;
  section_id: string | null;
  // Снимок тарифа на момент продажи (20260807000003).
  plan_id: string | null;
  duration_days: number | null;
  created_at: string;
  updated_at: string;
};

export type Attendance = {
  id: string;
  lesson_id: string;
  child_id: string;
  status: AttendanceStatus;
  marked_by: string | null;
  marked_at: string;
};

export type Freeze = {
  id: string;
  child_id: string;
  club_card_id: string;
  initiated_by: string;
  initiator_role: FreezeInitiatorRole;
  reason: string | null;
  status: FreezeStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  created_at: string;
  // Окно заморозки (20260510000004). На эти дни продлевается абонемент
  // и окно записи ребёнка в группу.
  start_date: string | null;
  end_date: string | null;
  // Сколько дней реально применили к карте (20260522000005). NULL = ещё
  // не применяли (pending).
  applied_days: number | null;
};

// Заморозка, закрытая системой по истечении срока, и заморозка, которую
// отклонил менеджер, лежат в одном статусе 'rejected'. Различаем по тому,
// была ли она когда-либо одобрена.
export const freezeOutcome = (f: Pick<Freeze, "status" | "approved_at">):
  | "pending" | "active" | "finished" | "rejected" => {
  if (f.status === "pending") return "pending";
  if (f.status === "approved") return "active";
  return f.approved_at ? "finished" : "rejected";
};

export type Payment = {
  id: string;
  organization_id: string;
  child_id: string;
  club_card_id: string | null;
  amount: number;
  currency: string;
  method: PaymentMethod;
  received_by: string | null;
  paid_at: string;
  comment: string | null;
  idempotency_key: string | null;
};

export type ProgressNote = {
  id: string;
  child_id: string;
  coach_id: string;
  text: string;
  is_public: boolean;
  created_at: string;
};

export type Notification = {
  id: string;
  recipient_id: string;
  type: string;
  payload: Json;
  is_read: boolean;
  created_at: string;
};

export type Lead = {
  id: string;
  organization_id: string;
  parent_name: string | null;
  phone: string | null;
  instagram: string | null;
  child_name: string | null;
  child_age: number | null;
  section_interest_id: string | null;
  stage: LeadStage;
  responsible_manager_id: string | null;
  source: LeadSource | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
  converted_at: string | null;
  // ТЗ §8.3 — нормативы времени. Проставляются триггером и refresh_lead_sla().
  first_contact_at: string | null;
  first_contact_by: string | null;
  sla_notified_at: string | null;
  escalated_at: string | null;
  // ТЗ §8.2 — запись на пробную и отработанные системой события.
  trial_at: string | null;
  trial_group_id: string | null;
  trial_coach_id: string | null;
  reminder_24h_at: string | null;
  reminder_2h_at: string | null;
  no_show_task_at: string | null;
  conversion_task_at: string | null;
  lost_reason: string | null;
  converted_child_id: string | null;
};

export type ChildDeposit = {
  child_id: string;
  organization_id: string;
  balance: number;
  updated_at: string;
};

export type DepositTransaction = {
  id: string;
  organization_id: string;
  child_id: string;
  amount: number;
  type: DepositTxType;
  balance_after: number;
  related_card_id: string | null;
  related_payment_id: string | null;
  related_refund_id: string | null;
  received_by: string;
  paid_at: string;
  comment: string | null;
  idempotency_key: string | null;
  created_at: string;
};

export type OrgSettings = {
  organization_id: string;
  sibling_discount_enabled: boolean;
  sibling_discount_amount: number;
  // ТЗ §10.2: аванс — доля от заработанного с 1-го по advance_day число.
  advance_share_pct: number;
  advance_day: number;
  // ТЗ §8.3: нормативы воронки лидов.
  lead_first_contact_min: number;
  lead_escalation_min: number;
  lead_no_show_hours: number;
  // ТЗ §3.3: бонус «Приведи друга».
  referral_enabled: boolean;
  referral_bonus_amount: number;
  // ТЗ §4.5: сколько дней без посещений считать риском оттока.
  churn_no_visit_days: number;
  updated_by: string | null;
  updated_at: string;
};

export type ChildCardBalance = {
  child_id: string;
  organization_id: string;
  club_card_id: string;
  type: CardType;
  total_lessons: number | null;
  start_date: string;
  end_date: string;
  status: CardStatus;
  attended_present: number;
  approved_freezes: number;
  remaining: number | null;
};

// ============================================================
// Персональные тренировки (ПТ)
// ============================================================
export type PtServiceType = "personal" | "mini_group";

export type PtPackageStatus =
  | "purchased"
  | "awaiting_activation"
  | "active"
  | "completed"
  | "expired"
  | "blocked"
  | "refunded"
  | "annulled";

export type PtSessionStatus = "scheduled" | "completed" | "cancelled" | "rescheduled";

export type PtVisitStatus = "scheduled" | "attended" | "missed" | "cancelled" | "rescheduled";

export type PtService = {
  id: string;
  organization_id: string;
  name: string;
  section_id: string | null;
  type: PtServiceType;
  capacity: number;
  price: number;
  duration_min: number;
  lessons_count: number;
  validity_days: number;
  activation_deadline_days: number;
  reschedule_limit_hours: number;
  cancel_limit_hours: number;
  coach_edit_limit_hours: number;
  mark_deadline_hours: number;
  freeze_allowed: boolean;
  refundable: boolean;
  blockable: boolean;
  coach_category: string | null;
  coach_percent_default: number;
  comment: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type PtServiceCoachRate = {
  id: string;
  organization_id: string;
  service_id: string;
  coach_id: string;
  price: number | null;
  percent: number | null;
  created_at: string;
};

export type PtPackageGroup = {
  id: string;
  organization_id: string;
  service_id: string;
  coach_id: string;
  name: string | null;
  total_price: number;
  capacity: number;
  created_by: string | null;
  created_at: string;
};

export type PtPackage = {
  id: string;
  organization_id: string;
  child_id: string;
  service_id: string;
  coach_id: string;
  group_id: string | null;
  status: PtPackageStatus;
  lessons_total: number;
  lessons_used: number;
  price: number;
  paid: number;
  sold_by: string | null;
  sold_at: string;
  sold_in_debt: boolean;
  debt_comment: string | null;
  activation_deadline: string | null;
  activated_at: string | null;
  activated_by: string | null;
  activation_kind: "auto" | "manual" | null;
  expires_at: string | null;
  blocked_at: string | null;
  blocked_by: string | null;
  block_reason: string | null;
  refunded_at: string | null;
  refunded_by: string | null;
  refund_amount: number;
  refund_kind: "partial" | "full" | null;
  annulled_at: string | null;
  annulled_by: string | null;
  annul_reason: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export type PtSession = {
  id: string;
  organization_id: string;
  service_id: string;
  coach_id: string;
  actual_coach_id: string | null;
  package_group_id: string | null;
  date: string;
  start_time: string;
  duration_min: number;
  status: PtSessionStatus;
  completed_at: string | null;
  completed_by: string | null;
  completed_source: "coach" | "admin" | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  rescheduled_from: string | null;
  rescheduled_at: string | null;
  rescheduled_by: string | null;
  reschedule_reason: string | null;
  substitution_by: string | null;
  substitution_at: string | null;
  substitution_comment: string | null;
  comment: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PtLesson = {
  id: string;
  organization_id: string;
  session_id: string;
  package_id: string;
  child_id: string;
  status: PtVisitStatus;
  charged: boolean;
  entry_time: string | null;
  exit_time: string | null;
  marked_by: string | null;
  marked_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  rescheduled_by: string | null;
  reschedule_reason: string | null;
  restored_by: string | null;
  restored_at: string | null;
  reminder_sent_at: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export type PtCoachComment = {
  id: string;
  organization_id: string;
  package_id: string;
  child_id: string;
  coach_id: string;
  milestone: number;
  text: string;
  created_at: string;
};

export type PtSubstitutionRow = {
  session_id: string;
  organization_id: string;
  date: string;
  start_time: string;
  status: PtSessionStatus;
  service_id: string;
  service_name: string;
  main_coach_id: string;
  main_coach_name: string;
  sub_coach_id: string;
  sub_coach_name: string;
  substitution_by: string | null;
  substitution_by_name: string | null;
  substitution_at: string | null;
  substitution_comment: string | null;
  client_names: string | null;
  lesson_value: number;
  coach_percent: number;
  accrual: number;
};

export type PtPayrollRow = {
  coach_id?: string;
  coach_name?: string;
  own_sessions: number;
  own_amount: number;
  sub_sessions: number;
  sub_amount: number;
  total_sessions: number;
  total_amount: number;
};

export type Database = {
  public: {
    Tables: {
      organizations: { Row: Organization };
      profiles: { Row: Profile };
      families: { Row: Family };
      children: { Row: Child };
      coaches: { Row: Coach };
      sections: { Row: Section };
      section_coaches: { Row: { section_id: string; coach_id: string } };
      groups: { Row: Group };
      group_schedule: { Row: GroupSchedule };
      lessons: { Row: Lesson };
      enrollments: { Row: Enrollment };
      club_cards: { Row: ClubCard };
      attendance: { Row: Attendance };
      freezes: { Row: Freeze };
      payments: { Row: Payment };
      progress_notes: { Row: ProgressNote };
      notifications: { Row: Notification };
      leads: { Row: Lead };
      child_deposits: { Row: ChildDeposit };
      deposit_transactions: { Row: DepositTransaction };
      org_settings: { Row: OrgSettings };
      card_plans: { Row: CardPlan };
      pt_services: { Row: PtService };
      pt_service_coach_rates: { Row: PtServiceCoachRate };
      pt_package_groups: { Row: PtPackageGroup };
      pt_packages: { Row: PtPackage };
      pt_sessions: { Row: PtSession };
      pt_lessons: { Row: PtLesson };
      pt_coach_comments: { Row: PtCoachComment };
    };
    Views: {
      v_pt_substitutions: { Row: PtSubstitutionRow };
      v_child_card_balance: { Row: ChildCardBalance };
      v_director_kpi: { Row: { organization_id: string; total_children: number; active_cards: number; revenue_30d: number } };
    };
  };
};
