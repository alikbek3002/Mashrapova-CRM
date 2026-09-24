import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "./supabase";
import { apiGet } from "./api-client";
import { useAuth } from "../auth/AuthProvider";
import type {
  Child, Family, Profile, Section, Coach, Group, GroupSchedule,
  Lesson, ClubCard, Payment, Lead, Freeze, Attendance, ProgressNote, ChildCardBalance,
  CardPlan,
} from "../types/database";

export type EnrollmentBrief = {
  id: string;
  group_id: string;
  archived_at: string | null;
  group: {
    id: string;
    name: string;
    section_id: string;
    section: { name_ru: string; name_ky: string; color: string | null } | null;
  } | null;
};
export type ChildWithFamily = Child & {
  family: Family | null;
  enrollments?: EnrollmentBrief[];
};
export type CoachWithProfile = Profile & { coach: Coach | null };
export type LessonWithGroup = Lesson & {
  group: (Group & { section: Section | null }) | null;
  coach: { full_name: string } | null;
};
export type CardWithChild = ClubCard & { child: { full_name: string; family_id: string } | null };
export type PaymentWithChild = Payment & {
  child: { full_name: string } | null;
  receiver: { full_name: string } | null;
};
export type FreezeWithChild = Freeze & {
  child: { full_name: string } | null;
  initiator: { full_name: string } | null;
  card: { type: string } | null;
};
export type LeadWithSection = Lead & { section: Section | null };

// ТЗ §7.4 — шесть KPI менеджера за период. Считает SQL-функция
// manager_kpi: метрики берутся из трёх источников (лиды, абонементы,
// платежи), собирать их на клиенте значило бы выкачивать все три
// таблицы целиком. Строка с manager_id = null — записи без
// ответственного менеджера, в итогах они нужны.
export type ManagerKpiRow = {
  manager_id: string | null;
  manager_name: string | null;
  leads_total: number;
  first_contact_total: number;
  avg_first_contact_min: number | null;
  within_sla_total: number;
  trial_booked_total: number;
  trial_attended_total: number;
  converted_total: number;
  renewals_due: number;
  renewals_done: number;
  sales_total: number;
  sales_per_day: number;
};

export const useManagerKpi = (from: string, to: string) =>
  useQuery({
    queryKey: ["manager_kpi", from, to],
    queryFn: async (): Promise<ManagerKpiRow[]> => {
      const { data, error } = await supabase.rpc("manager_kpi", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []) as ManagerKpiRow[];
    },
  });

// ======================================================================
// Children / Families / Sections / Coaches
// ======================================================================
// PostgREST отдаёт максимум 1000 строк за запрос (max-rows). Детей уже
// 1037, карт 1400 — без пагинации хвост списка молча пропадает (жалоба
// офиса 2026-09-18: «ребёнка зарегистрировали, а в системе не выходит» —
// Ынакбековы стояли последними по алфавиту и не влезли в первую тысячу).
const PAGE = 1000;
type PagedResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
const fetchAllRows = async <T,>(build: (from: number, to: number) => PagedResult<T>): Promise<T[]> => {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
};

export const useChildren = () =>
  useQuery({
    queryKey: ["children"],
    // Список детей в админке стабилен: правки идут через мутации,
    // которые инвалидируют ключ. Пустые re-fetch при переключении
    // вкладок здесь не нужны — заметно сокращает обращения к Sydney.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ChildWithFamily[]> => {
      return fetchAllRows<ChildWithFamily>((from, to) =>
        supabase
          .from("children")
          .select("*, family:families(*), enrollments(id, group_id, archived_at, group:groups(id, name, section_id, section:sections(name_ru, name_ky, color)))")
          .is("deleted_at", null)
          .order("full_name")
          .order("id")
          .range(from, to) as unknown as PagedResult<ChildWithFamily>);
    },
  });

export const useFamilies = () =>
  useQuery({
    queryKey: ["families"],
    queryFn: async (): Promise<Family[]> => {
      return fetchAllRows<Family>((from, to) =>
        supabase
          .from("families")
          .select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to) as unknown as PagedResult<Family>);
    },
  });

// Справочники меняются редко (недели) — кешируем на 10 минут, чтобы не
// перезапрашивать при каждом открытии формы/дровера.
const REF_STALE = 10 * 60_000;

export const useSections = () =>
  useQuery({
    queryKey: ["sections"],
    staleTime: REF_STALE,
    queryFn: async (): Promise<Section[]> => {
      const { data, error } = await supabase
        .from("sections")
        .select("*")
        .is("deleted_at", null)
        .order("name_ru");
      if (error) throw error;
      return data ?? [];
    },
  });

// Каталог видов абонементов. all=true — включая выключенные (управление
// на странице «Абонементы»); по умолчанию — только активные (форма продажи).
export const useCardPlans = (all = false) =>
  useQuery({
    queryKey: ["card_plans", all ? "all" : "active"],
    staleTime: REF_STALE,
    queryFn: async (): Promise<CardPlan[]> => {
      let q = supabase
        .from("card_plans")
        .select("*")
        .order("sort_order")
        .order("name_ru");
      if (!all) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

export const useCoaches = () =>
  useQuery({
    queryKey: ["coaches"],
    staleTime: REF_STALE,
    queryFn: async (): Promise<CoachWithProfile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*, coach:coaches(*)")
        .eq("role", "coach")
        .is("deleted_at", null)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as unknown as CoachWithProfile[];
    },
  });

// ======================================================================
// Archived (soft-deleted) — for /admin/archive page
// ======================================================================
export const useArchivedChildren = () =>
  useQuery({
    queryKey: ["archive", "children"],
    queryFn: async (): Promise<ChildWithFamily[]> => {
      const { data, error } = await supabase
        .from("children")
        .select("*, family:families(*)")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ChildWithFamily[];
    },
  });

export const useArchivedFamilies = () =>
  useQuery({
    queryKey: ["archive", "families"],
    queryFn: async (): Promise<Family[]> => {
      const { data, error } = await supabase
        .from("families")
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Family[];
    },
  });

export const useArchivedCoaches = () =>
  useQuery({
    queryKey: ["archive", "coaches"],
    queryFn: async (): Promise<CoachWithProfile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*, coach:coaches(*)")
        .eq("role", "coach")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CoachWithProfile[];
    },
  });

export const useArchivedSections = () =>
  useQuery({
    queryKey: ["archive", "sections"],
    queryFn: async (): Promise<Section[]> => {
      const { data, error } = await supabase
        .from("sections")
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Section[];
    },
  });

export const useArchivedGroups = () =>
  useQuery({
    queryKey: ["archive", "groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("groups")
        .select("*, section:sections(*), coach:profiles!coach_id(full_name)")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

// ======================================================================
// Groups + schedule
// ======================================================================
export const useGroups = () =>
  useQuery({
    queryKey: ["groups"],
    staleTime: REF_STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("groups")
        .select("*, section:sections(*), coach:profiles!coach_id(full_name), enrollments(id, archived_at)")
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

export const useGroupSchedule = (groupId?: string) =>
  useQuery({
    queryKey: ["group_schedule", groupId],
    enabled: !!groupId,
    queryFn: async (): Promise<GroupSchedule[]> => {
      const { data, error } = await supabase
        .from("group_schedule")
        .select("*")
        .eq("group_id", groupId!)
        .order("day_of_week");
      if (error) throw error;
      return data ?? [];
    },
  });

// ======================================================================
// Lessons (with date range)
// ======================================================================
export const useLessons = (params: { from?: string; to?: string; coachId?: string; groupId?: string } = {}) =>
  useQuery({
    queryKey: ["lessons", params],
    queryFn: async (): Promise<LessonWithGroup[]> => {
      // Sensible defaults — without them an empty params would fetch all
      // lessons in the database, freezing the UI.
      const today = new Date();
      const defaultFrom = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
      const defaultTo = new Date(today.getTime() + 60 * 86400000).toISOString().slice(0, 10);
      const from = params.from ?? defaultFrom;
      const to = params.to ?? defaultTo;

      // !inner на group отбрасывает lessons, чьи группы архивированы:
      // в БД нет каскадного удаления lessons при soft-delete группы,
      // поэтому фильтруем здесь, чтобы такие занятия не попадали в расписание.
      let q = supabase
        .from("lessons")
        .select("*, group:groups!inner(*, section:sections(*)), coach:profiles!coach_id(full_name)")
        .is("group.deleted_at", null)
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .order("start_time");
      if (params.coachId) q = q.eq("coach_id", params.coachId);
      if (params.groupId) q = q.eq("group_id", params.groupId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LessonWithGroup[];
    },
  });

// ======================================================================
// Club cards
// ======================================================================
export const useCards = (status?: string) =>
  useQuery({
    queryKey: ["club_cards", status ?? "all"],
    queryFn: async (): Promise<CardWithChild[]> => {
      return fetchAllRows<CardWithChild>((from, to) => {
        let q = supabase
          .from("club_cards")
          .select("*, child:children(full_name, family_id)")
          .order("created_at", { ascending: false })
          .order("id");
        if (status && status !== "all") q = q.eq("status", status);
        return q.range(from, to) as unknown as PagedResult<CardWithChild>;
      });
    },
  });

// Карты одного ребёнка — для карточки ребёнка (SubsTab). Раньше там грузились
// ВСЕ карты клуба и фильтровались по child_id на клиенте.
export const useCardsForChild = (childId?: string) =>
  useQuery({
    queryKey: ["club_cards", "child", childId],
    enabled: !!childId,
    queryFn: async (): Promise<CardWithChild[]> => {
      const { data, error } = await supabase
        .from("club_cards")
        .select("*, child:children(full_name, family_id)")
        .eq("child_id", childId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CardWithChild[];
    },
  });

// Абонементы, которые можно поставить на паузу.
//
// Заморозка привязана к конкретной карте, поэтому здесь НЕ фильтруем по
// остатку занятий: клиент вправе заморозить абонемент, на котором осталась
// одна тренировка. Раньше формы заморозки брали useCards("active") и карта
// со статусом 'ending' (≤5 дней до конца) или 'debt' просто пропадала из
// списка — заморозку было физически некуда поставить.
export const FREEZABLE_CARD_STATUSES = ["active", "ending", "frozen", "debt"];

export const useFreezableCards = () =>
  useQuery({
    queryKey: ["club_cards", "freezable"],
    queryFn: async (): Promise<CardWithChild[]> => {
      const { data, error } = await supabase
        .from("club_cards")
        .select("*, child:children(full_name, family_id)")
        .in("status", FREEZABLE_CARD_STATUSES)
        .order("end_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CardWithChild[];
    },
  });

// Остатки по ВСЕМ картам ребёнка (не только по «главной») — нужны формам
// заморозки, чтобы показать остаток рядом с каждым абонементом.
export const useCardBalancesForChild = (childId?: string) =>
  useQuery({
    queryKey: ["card_balances", "child", childId],
    enabled: !!childId,
    queryFn: async (): Promise<ChildCardBalance[]> => {
      const { data, error } = await supabase
        .from("v_child_card_balance")
        .select("*")
        .eq("child_id", childId!);
      if (error) throw error;
      return (data ?? []) as ChildCardBalance[];
    },
  });

// Single primary card balance — for compact widgets that need one number
// (e.g. Home «осталось N занятий»). Predpay-aware: сначала карта,
// покрывающая сегодняшний день, иначе ближайшая будущая (оплачено
// вперёд), иначе последняя active/ending.
export const useCardBalance = (childId?: string) =>
  useQuery({
    queryKey: ["card_balance", childId],
    enabled: !!childId,
    // Меняется только при mark-attendance/sell/renew/freeze — все эти
    // мутации инвалидируют ["card_balance"] руками. До этого данные
    // стабильны.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ChildCardBalance | null> => {
      const { data, error } = await supabase
        .from("v_child_card_balance")
        .select("*")
        .eq("child_id", childId!)
        .in("status", ["active", "ending"])
        .order("end_date", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as ChildCardBalance[];
      const today = new Date().toISOString().slice(0, 10);
      return (
        rows.find((r) => r.start_date <= today && r.end_date >= today)
        ?? rows.find((r) => r.start_date > today)
        ?? rows[rows.length - 1]
        ?? null
      );
    },
  });

// All cards (any status) for the Card screen — parent can see history too.
export const useCardBalances = (childId?: string) =>
  useQuery({
    queryKey: ["card_balances", childId],
    enabled: !!childId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ChildCardBalance[]> => {
      const { data, error } = await supabase
        .from("v_child_card_balance")
        .select("*")
        .eq("child_id", childId!)
        .order("end_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChildCardBalance[];
    },
  });

// Активные/ending карты одного ребёнка — с секцией. Нужно для валидации
// записи в группу: можно записать только если активная карта совпадает
// по section_id с группой. View v_child_card_balance секцию не возвращает,
// поэтому тянем из club_cards напрямую.
export type ActiveCard = {
  id: string;
  child_id: string;
  section_id: string | null;
  status: "active" | "ending";
  type: string;
  start_date: string;
  end_date: string;
  total_lessons: number | null;
};

export const useChildActiveCards = (childId?: string) =>
  useQuery({
    queryKey: ["active_cards_child", childId],
    enabled: !!childId,
    queryFn: async (): Promise<ActiveCard[]> => {
      const { data, error } = await supabase
        .from("club_cards")
        .select("id, child_id, section_id, status, type, start_date, end_date, total_lessons")
        .eq("child_id", childId!)
        .in("status", ["active", "ending"])
        .order("end_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ActiveCard[];
    },
  });

// Пакетная версия для KidsTab в GroupDrawer: одним запросом тянем активные
// карты по списку child_id, чтобы аннотировать кандидатов «можно/нельзя».
export const useActiveCardsForChildren = (childIds: string[]) =>
  useQuery({
    queryKey: ["active_cards_children", [...childIds].sort().join(",")],
    enabled: childIds.length > 0,
    queryFn: async (): Promise<Map<string, ActiveCard[]>> => {
      const { data, error } = await supabase
        .from("club_cards")
        .select("id, child_id, section_id, status, type, start_date, end_date, total_lessons")
        .in("child_id", childIds)
        .in("status", ["active", "ending"]);
      if (error) throw error;
      const map = new Map<string, ActiveCard[]>();
      for (const c of (data ?? []) as ActiveCard[]) {
        const list = map.get(c.child_id);
        if (list) list.push(c);
        else map.set(c.child_id, [c]);
      }
      return map;
    },
  });

// ======================================================================
// Deposits
// ======================================================================
export type DepositTransactionRow = {
  id: string;
  organization_id: string;
  child_id: string;
  amount: number;
  type:
    | "top_up"
    | "withdraw"
    | "card_purchase"
    | "card_renewal"
    | "refund_in"
    | "service_charge"
    | "adjustment";
  balance_after: number;
  related_card_id: string | null;
  related_payment_id: string | null;
  related_refund_id: string | null;
  received_by: string;
  paid_at: string;
  comment: string | null;
  created_at: string;
  receiver?: { full_name: string } | null;
};

export const useDepositBalance = (childId?: string) =>
  useQuery({
    queryKey: ["deposit_balance", childId],
    enabled: !!childId,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from("child_deposits")
        .select("balance")
        .eq("child_id", childId!)
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.balance) : 0;
    },
  });

export const useDepositHistory = (childId?: string, limit = 100) =>
  useQuery({
    queryKey: ["deposit_history", childId, limit],
    enabled: !!childId,
    queryFn: async (): Promise<DepositTransactionRow[]> => {
      const { data, error } = await supabase
        .from("deposit_transactions")
        .select("*, receiver:profiles!received_by(full_name)")
        .eq("child_id", childId!)
        .order("paid_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as DepositTransactionRow[];
    },
  });

// Сводка для Dashboard KPI: общий депозит и сколько детей с положительным балансом.
export const useDepositSummary = () =>
  useQuery({
    queryKey: ["deposit_summary"],
    queryFn: async (): Promise<{ total: number; kidsWithDeposit: number }> => {
      const { data, error } = await supabase.from("child_deposits").select("balance");
      if (error) throw error;
      const rows = (data ?? []) as Array<{ balance: number | string }>;
      let total = 0;
      let kidsWithDeposit = 0;
      for (const r of rows) {
        const b = Number(r.balance);
        total += b;
        if (b > 0) kidsWithDeposit += 1;
      }
      return { total, kidsWithDeposit };
    },
  });

// ======================================================================
// Внутренние комментарии о ребёнке (office-only)
// ======================================================================
export type ChildCommentRow = {
  id: string;
  child_id: string;
  text: string;
  created_at: string;
  author_id: string | null;
  author?: { full_name: string } | null;
};

export const useChildComments = (childId?: string) =>
  useQuery({
    queryKey: ["child_comments", childId],
    enabled: !!childId,
    queryFn: async (): Promise<ChildCommentRow[]> => {
      const { data, error } = await supabase
        .from("child_internal_notes")
        .select("*, author:profiles!author_id(full_name, role)")
        .eq("child_id", childId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ChildCommentRow[];
    },
  });

// ======================================================================
// Org settings (скидка для 2-го ребёнка и др.)
// ======================================================================
export type OrgSettingsRow = {
  organization_id: string;
  sibling_discount_enabled: boolean;
  sibling_discount_amount: number;
  // ТЗ §10.2 — аванс тренерам.
  advance_share_pct: number;
  advance_day: number;
  // ТЗ §8.3 — нормативы воронки лидов.
  lead_first_contact_min: number;
  lead_escalation_min: number;
  lead_no_show_hours: number;
  updated_by: string | null;
  updated_at: string;
};

export const useOrgSettings = () =>
  useQuery({
    queryKey: ["org_settings"],
    queryFn: async (): Promise<OrgSettingsRow | null> => {
      const { data, error } = await supabase
        .from("org_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as OrgSettingsRow | null;
    },
  });

// ======================================================================
// Payments
// ======================================================================
export const usePayments = () =>
  useQuery({
    queryKey: ["payments"],
    queryFn: async (): Promise<PaymentWithChild[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select("*, child:children(full_name), receiver:profiles!received_by(full_name)")
        .order("paid_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as PaymentWithChild[];
    },
  });

// Платежи одного ребёнка — для карточки ребёнка (PayTab). Раньше там грузились
// последние 200 платежей клуба и фильтровались по child_id на клиенте.
export const usePaymentsForChild = (childId?: string) =>
  useQuery({
    queryKey: ["payments", "child", childId],
    enabled: !!childId,
    queryFn: async (): Promise<PaymentWithChild[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select("*, child:children(full_name), receiver:profiles!received_by(full_name)")
        .eq("child_id", childId!)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PaymentWithChild[];
    },
  });

// ======================================================================
// Freezes
// ======================================================================
export const useFreezes = () =>
  useQuery({
    queryKey: ["freezes"],
    queryFn: async (): Promise<FreezeWithChild[]> => {
      const { data, error } = await supabase
        .from("freezes")
        .select("*, child:children(full_name), initiator:profiles!initiated_by(full_name), card:club_cards(type)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as FreezeWithChild[];
    },
  });

// ======================================================================
// Leads
// ======================================================================
export const useLeads = () =>
  useQuery({
    queryKey: ["leads"],
    queryFn: async (): Promise<LeadWithSection[]> => {
      const { data, error } = await supabase
        .from("leads")
        .select("*, section:sections(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LeadWithSection[];
    },
  });

// ======================================================================
// Attendance + progress notes
// ======================================================================
export const useAttendanceForLesson = (lessonId?: string) =>
  useQuery({
    queryKey: ["attendance_lesson", lessonId],
    enabled: !!lessonId,
    queryFn: async (): Promise<Attendance[]> => {
      const { data, error } = await supabase.from("attendance").select("*").eq("lesson_id", lessonId!);
      if (error) throw error;
      return data ?? [];
    },
  });

export const useAttendanceForChild = (childId?: string, sinceDays = 60) =>
  useQuery({
    queryKey: ["attendance_child", childId, sinceDays],
    enabled: !!childId,
    queryFn: async (): Promise<(Attendance & {
      lesson: (Pick<Lesson, "date" | "start_time"> & {
        group?: { name: string; section?: { name_ru: string; name_ky: string } | null } | null;
      }) | null;
    })[]> => {
      const since = new Date();
      since.setDate(since.getDate() - sinceDays);
      const { data, error } = await supabase
        .from("attendance")
        .select("*, lesson:lessons!inner(date, start_time, group:groups(name, section:sections(name_ru, name_ky)))")
        .eq("child_id", childId!)
        .gte("lesson.date", since.toISOString().slice(0, 10))
        .order("marked_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as (Attendance & {
        lesson: (Pick<Lesson, "date" | "start_time"> & {
          group?: { name: string; section?: { name_ru: string; name_ky: string } | null } | null;
        }) | null;
      })[];
    },
  });

// История группы: смены тренера, замены на занятие, правки расписания,
// изменения состава. Пишется триггерами (20260804000005), здесь — чтение.
export type GroupEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
  actor: { full_name: string } | null;
};

export const useGroupEvents = (groupId?: string) =>
  useQuery({
    queryKey: ["group_events", groupId],
    enabled: !!groupId,
    queryFn: async (): Promise<GroupEvent[]> => {
      const { data, error } = await supabase
        .from("group_events")
        .select("id, type, payload, actor_id, created_at, actor:profiles!actor_id(full_name)")
        .eq("group_id", groupId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as GroupEvent[];
    },
  });

// Состав группы для тренерского экрана: дети + срок карты + остаток.
// Тот же security definer RPC, что и в журнале группы (20260804000001) —
// доступен тренеру, manager-scoping детей его не режет.
export type GroupRosterKid = {
  id: string;
  full_name: string;
  manager: string | null;
  cardStart: string | null;
  cardEnd: string | null;
  remaining: number | null;
  total: number | null;
};

export const useGroupRoster = (groupId?: string) =>
  useQuery({
    queryKey: ["group_roster", groupId],
    enabled: !!groupId,
    queryFn: async (): Promise<GroupRosterKid[]> => {
      const { data, error } = await supabase.rpc("fn_group_tabel_roster", { p_group_id: groupId! });
      if (error) throw error;
      type Row = {
        child_id: string; full_name: string;
        card_start: string | null; card_end: string | null;
        total_lessons: number | null; remaining: number | null;
        manager_name: string | null;
      };
      // Строка = ребёнок × карта; оставляем самую позднюю карту ребёнка.
      const byKid = new Map<string, GroupRosterKid>();
      for (const r of (data ?? []) as Row[]) {
        const prev = byKid.get(r.child_id);
        if (!prev || (r.card_start ?? "") > (prev.cardStart ?? "")) {
          byKid.set(r.child_id, {
            id: r.child_id,
            full_name: r.full_name,
            manager: r.manager_name,
            cardStart: r.card_start,
            cardEnd: r.card_end,
            remaining: r.remaining,
            total: r.total_lessons,
          });
        }
      }
      return Array.from(byKid.values()).sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
    },
  });

export const useProgressNotes = (childId?: string) =>
  useQuery({
    queryKey: ["progress_notes", childId],
    enabled: !!childId,
    queryFn: async (): Promise<(ProgressNote & { coach: { full_name: string } | null })[]> => {
      // RLS already enforces is_public=true for parents and coach_id=auth.uid() for coaches.
      // Client-side filter would over-restrict the coach view, so we leave it to RLS.
      const { data, error } = await supabase
        .from("progress_notes")
        .select("*, coach:profiles!coach_id(full_name)")
        .eq("child_id", childId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as (ProgressNote & { coach: { full_name: string } | null })[];
    },
  });

// ======================================================================
// Табель: мета ребёнка и окно его абонемента
//
// В колонке с фамилией тренер и менеджер должны видеть, кто ведёт ребёнка
// и до какого числа он оплачен, — иначе за этим нужно лезть в карточку.
// Окно [start, end] — единственный источник правды для ячеек: до start
// ребёнка в группе ещё не было (серые квадраты), после end абонемент
// закончился и отмечать нельзя.
// ======================================================================
export type TabelKidMeta = {
  manager: string | null;
  cardStart: string | null;
  cardEnd: string | null;
  remaining: number | null;
  total: number | null;
  cardStatus: string | null;
};

export type TabelWindow = { start: string | null; end: string | null };

type TabelCardRow = {
  id: string;
  start: string;
  end: string;
  status: string;
  total_lessons: number | null;
};

// Менеджер ребёнка + остаток занятий по действующей карте.
// Остаток берём из v_child_card_balance — считать его на фронте нельзя
// (там учёт заморозок), это отдельно оговорено в комментарии к вьюхе.
const loadTabelKidMeta = async (
  kidIds: string[],
  cardsByChild: Map<string, TabelCardRow[]>,
): Promise<Map<string, TabelKidMeta>> => {
  const meta = new Map<string, TabelKidMeta>();
  if (kidIds.length === 0) return meta;

  const { data: kidRows } = await supabase
    .from("children")
    .select("id, responsible_manager_id")
    .in("id", kidIds);

  const managerIds = Array.from(
    new Set(
      ((kidRows ?? []) as Array<{ responsible_manager_id: string | null }>)
        .map((r) => r.responsible_manager_id)
        .filter((v): v is string => !!v),
    ),
  );
  const { data: mgrRows } = managerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", managerIds)
    : { data: [] };
  const managerById = new Map(
    ((mgrRows ?? []) as Array<{ id: string; full_name: string }>).map((m) => [m.id, m.full_name]),
  );

  const cardIds = Array.from(cardsByChild.values()).flat().map((c) => c.id);
  const { data: balanceRows } = cardIds.length
    ? await supabase
        .from("v_child_card_balance")
        .select("club_card_id, remaining")
        .in("club_card_id", cardIds)
    : { data: [] };
  const remainingByCard = new Map(
    ((balanceRows ?? []) as Array<{ club_card_id: string; remaining: number | null }>)
      .map((b) => [b.club_card_id, b.remaining]),
  );

  const managerByKid = new Map(
    ((kidRows ?? []) as Array<{ id: string; responsible_manager_id: string | null }>)
      .map((r) => [r.id, r.responsible_manager_id ? (managerById.get(r.responsible_manager_id) ?? null) : null]),
  );

  for (const kidId of kidIds) {
    const primary = primaryCard(cardsByChild.get(kidId));
    meta.set(kidId, {
      manager: managerByKid.get(kidId) ?? null,
      cardStart: primary?.start ?? null,
      cardEnd: primary?.end ?? null,
      remaining: primary ? (remainingByCard.get(primary.id) ?? null) : null,
      total: primary?.total_lessons ?? null,
      cardStatus: primary?.status ?? null,
    });
  }
  return meta;
};

// Действующая карта ребёнка = самая поздняя по дате начала. Табель строится
// по ней: именно её срок ограничивает ячейки.
const primaryCard = (cards?: TabelCardRow[]): TabelCardRow | null => {
  if (!cards || cards.length === 0) return null;
  return cards.slice().sort((a, b) => (a.start < b.start ? 1 : -1))[0]!;
};

// Окно ребёнка в группе: снизу — первая тренировка по записи/абонементу,
// сверху — последний оплаченный день. Записи без дат (legacy) оставляют
// границу открытой: такие дети ведут себя как раньше.
const buildTabelWindow = (
  enrollWins: Array<{ start: string | null; end: string | null }> | undefined,
  cards: TabelCardRow[] | undefined,
): TabelWindow => {
  const starts: string[] = [];
  const ends: string[] = [];
  for (const w of enrollWins ?? []) {
    if (w.start) starts.push(w.start);
    if (w.end) ends.push(w.end);
  }
  for (const c of cards ?? []) {
    starts.push(c.start);
    ends.push(c.end);
  }
  const sortedEnds = ends.slice().sort();
  return {
    start: starts.length ? starts.slice().sort()[0]! : null,
    end: sortedEnds.length ? sortedEnds[sortedEnds.length - 1]! : null,
  };
};

// Сегодня в локальной дате (YYYY-MM-DD) — как todayStr в компонентах табеля.
const localYmd = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Approved-заморозки детей: интервалы (для расчёта пула занятий по карте на
// любом горизонте) + развёрнутый набор дат в видимом диапазоне (фронт
// красит такие ячейки «в заморозке» и снимает кликабельность).
type FreezeInterval = { start: string | null; end: string | null };
const loadFreezes = async (
  kidIds: string[],
  fromStr: string,
  toStr: string,
): Promise<{
  frozenByChild: Map<string, Set<string>>;
  inFreeze: (childId: string, d: string) => boolean;
}> => {
  const intervals = new Map<string, FreezeInterval[]>();
  const frozenByChild = new Map<string, Set<string>>();
  if (kidIds.length === 0) return { frozenByChild, inFreeze: () => false };
  const { data: frz } = await supabase
    .from("freezes")
    .select("child_id, start_date, end_date")
    .in("child_id", kidIds)
    .eq("status", "approved");
  const expand = (start: string, end: string) => {
    const out: string[] = [];
    const [ys, ms, ds] = start.split("-").map(Number);
    const [ye, me, de] = end.split("-").map(Number);
    const a = new Date(Date.UTC(ys!, ms! - 1, ds!));
    const b = new Date(Date.UTC(ye!, me! - 1, de!));
    for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = d.toISOString().slice(0, 10);
      if (s >= fromStr && s <= toStr) out.push(s);
    }
    return out;
  };
  for (const f of (frz ?? []) as Array<{ child_id: string; start_date: string | null; end_date: string | null }>) {
    const arr = intervals.get(f.child_id) ?? [];
    arr.push({ start: f.start_date, end: f.end_date });
    intervals.set(f.child_id, arr);
    // Бессрочная заморозка: NULL-границы означают «с начала» / «до конца».
    // Раньше .split() по null ронял весь запрос табеля — группа с такой
    // заморозкой показывала «нет учеников».
    const s = frozenByChild.get(f.child_id) ?? new Set<string>();
    for (const d of expand(f.start_date ?? fromStr, f.end_date ?? toStr)) s.add(d);
    frozenByChild.set(f.child_id, s);
  }
  const inFreeze = (childId: string, d: string) =>
    (intervals.get(childId) ?? []).some(
      (i) => (i.start == null || d >= i.start) && (i.end == null || d <= i.end),
    );
  return { frozenByChild, inFreeze };
};

// Какие даты занятий покрывает абонемент: все занятия в его сроке
// [start, end], кроме дней заморозки.
//
// Правило намеренно простое (решение офиса 2026-09-02): срок абонемента
// определяет тренировки, число занятий — только остаток (v_child_card_balance:
// total − «был»). Поэтому «Продлить» дату добавляет тренировки до новой
// даты, «+ занятия» увеличивает остаток и продлевает срок, а ушедший в
// минус остаток — сигнал офису о долге, а не запрет тренеру отмечать.
// Раньше пул = «первые N дат от старта»: продление ничего не добавляло, а
// ребёнок с действующим абонементом мог остаться без ячейки.
export const cardPoolDates = (
  card: { start: string; end: string },
  dates: string[],
  skip?: (d: string) => boolean,
): string[] => dates.filter((d) => d >= card.start && d <= card.end && !skip?.(d));

// ======================================================================
// Coach Tabel — кто в моих группах × последние N дней × статус посещения
// ======================================================================
export const useCoachTabel = (
  coachId?: string,
  range?: { from: string; to: string },
) =>
  useQuery({
    queryKey: ["coach_tabel", coachId, range?.from, range?.to],
    enabled: !!coachId && !!range?.from && !!range?.to,
    queryFn: async () => {
      const fromStr = range!.from;
      const toStr = range!.to;

      // 0. Сколько у тренера активных групп — для понятного empty-state.
      const { count: groupsCount } = await supabase
        .from("groups")
        .select("id", { count: "exact", head: true })
        .eq("coach_id", coachId!)
        .is("deleted_at", null);

      // 1. Все enrollments в группах тренера.
      // Важно: фильтруем не только по enrollment.archived_at, но и по
      // children.deleted_at — иначе архивированные дети будут видны тренеру.
      const { data: enroll, error: ee } = await supabase
        .from("enrollments")
        .select("child_id, start_date, end_date, enrolled_at, group:groups!inner(id, coach_id, name), child:children(id, full_name, photo_path, deleted_at)")
        .is("archived_at", null);
      if (ee) throw ee;
      // Нормализуем supabase array/object для join (см. ниже).
      const myEnroll = (enroll ?? []).filter((e: any) => {
        const g = Array.isArray(e.group) ? e.group[0] : e.group;
        const c = Array.isArray(e.child) ? e.child[0] : e.child;
        return g?.coach_id === coachId && c && !c.deleted_at;
      }).map((e: any) => ({
        ...e,
        group: Array.isArray(e.group) ? e.group[0] : e.group,
        child: Array.isArray(e.child) ? e.child[0] : e.child,
      }));

      // Окно записи каждого ребёнка (может быть несколько групп у тренера →
      // список окон). NULL-граница = открыто. Используется при засеве ячеек.
      const enrollWindowsByChild = new Map<string, Array<{ start: string | null; end: string | null }>>();
      for (const e of myEnroll as any[]) {
        const arr = enrollWindowsByChild.get(e.child_id) ?? [];
        arr.push({ start: e.start_date ?? null, end: e.end_date ?? null });
        enrollWindowsByChild.set(e.child_id, arr);
      }

      // 1.5. Активные карты + total_lessons. Используем для жёсткого
      // капа: ребёнок появляется в табеле максимум на первых N
      // запланированных датах с card.start_date, где N = total_lessons.
      // Так лишние занятия (свыше абонемента) не светятся ни у тренера,
      // ни у админа.
      const kidIds = Array.from(new Set(myEnroll.map((e: any) => e.child_id)));
      // Берём и истёкшие карты тоже: ребёнок остаётся в группе после конца
      // абонемента, и табель должен показать, каким числом он закончился.
      const { data: cardRows } = kidIds.length
        ? await supabase
            .from("club_cards")
            .select("id, child_id, start_date, end_date, status, total_lessons")
            .in("child_id", kidIds)
            .in("status", ["active", "ending", "frozen", "expired", "debt"])
        : { data: [] };
      const cardWindowsByChild = new Map<string, TabelCardRow[]>();
      for (const c of (cardRows ?? []) as Array<{ id: string; child_id: string; start_date: string; end_date: string; status: string; total_lessons: number | null }>) {
        const arr = cardWindowsByChild.get(c.child_id) ?? [];
        arr.push({ id: c.id, start: c.start_date, end: c.end_date, status: c.status, total_lessons: c.total_lessons });
        cardWindowsByChild.set(c.child_id, arr);
      }

      // 2. Все lessons тренера. ВАЖНО: нижнюю границу берём от самой
      // ранней card.start_date среди детей тренера, а не от fromStr.
      // Иначе slice(0, total_lessons) ниже отсчитает «первые N» от
      // начала месяца, а не от начала абонемента — и в табеле июнь
      // будет полностью пунктирным, хотя по карте остался лишь 1 урок.
      let lessonsFrom = fromStr;
      for (const [, cards] of cardWindowsByChild) {
        for (const c of cards) {
          if (c.start < lessonsFrom) lessonsFrom = c.start;
        }
      }
      const { data: lessons, error: le } = await supabase
        .from("lessons")
        .select("id, date, group_id, status")
        .eq("coach_id", coachId!)
        .gte("date", lessonsFrom)
        .lte("date", toStr)
        .order("date");
      if (le) throw le;

      // 3. Все attendance для этих lessons
      const lessonIds = (lessons ?? []).map((l) => l.id);
      const { data: att, error: ae } = lessonIds.length
        ? await supabase
            .from("attendance")
            .select("lesson_id, child_id, status")
            .in("lesson_id", lessonIds)
        : { data: [], error: null };
      if (ae) throw ae;

      // Build kid → date → { lesson_id, status }
      // We also build date → lesson_id (1 lesson per date per coach is the
      // common case; if a coach has 2 groups on the same day this picks one
      // arbitrarily — fine for tabel coarseness).
      const lessonByIdDate = new Map<string, string>();
      const lessonByDate = new Map<string, string>();
      for (const l of lessons ?? []) {
        lessonByIdDate.set(l.id, l.date);
        if (!lessonByDate.has(l.date)) lessonByDate.set(l.date, l.id);
      }
      // Тренировки, снятые с абонемента офисом: у ребёнка ячейки нет
      // (серый квадрат «снята с абонемента»).
      const { data: excl } = lessonIds.length
        ? await supabase
            .from("card_lesson_exclusions")
            .select("lesson_id, child_id")
            .in("lesson_id", lessonIds)
        : { data: [] };
      const removedByChild = new Map<string, Set<string>>();
      for (const x of (excl ?? []) as Array<{ lesson_id: string; child_id: string }>) {
        const date = lessonByIdDate.get(x.lesson_id);
        if (!date) continue;
        const s = removedByChild.get(x.child_id) ?? new Set<string>();
        s.add(date);
        removedByChild.set(x.child_id, s);
      }
      type Cell = { lesson_id: string; status: string | null; locked?: boolean };
      const grid = new Map<string, Map<string, Cell>>();
      // allDates — все даты занятий тренера от lessonsFrom (нужно для cap-
      // by-total_lessons). dates — только запрошенный диапазон [fromStr,
      // toStr], их рисует фронт в сетке.
      const allDatesSet = new Set<string>();
      const datesSet = new Set<string>();
      for (const l of lessons ?? []) {
        allDatesSet.add(l.date);
        if (l.date >= fromStr && l.date <= toStr) datesSet.add(l.date);
      }
      const allDates = Array.from(allDatesSet).sort();
      const dates = Array.from(datesSet).sort();
      // Группа (или несколько групп) для каждого ребёнка — нужно фронту,
      // чтобы можно было переключать табель по группам, если у тренера
      // их больше одной.
      // ВАЖНО: supabase для join'а через !inner иногда возвращает group
      // как массив, иногда как объект — зависит от inference FK. Поэтому
      // нормализуем оба варианта, иначе groupsByChild оставался пустым
      // и при выборе группы табель «пустел».
      const groupsByChild = new Map<string, Set<string>>();
      const groupsMeta = new Map<string, { id: string; name: string }>();
      for (const e of myEnroll as any[]) {
        const g = Array.isArray(e.group) ? e.group[0] : e.group;
        const gid = g?.id as string | undefined;
        if (!gid) continue;
        groupsMeta.set(gid, { id: gid, name: g.name });
        const s = groupsByChild.get(e.child_id) ?? new Set<string>();
        s.add(gid);
        groupsByChild.set(e.child_id, s);
      }
      // Дополнительно: список ID занятий по группам — чтобы фильтровать
      // даты табеля при выборе одной группы (даты других групп прятать).
      const lessonsByGroup = new Map<string, Set<string>>(); // group_id → date set
      for (const l of lessons ?? []) {
        const s = lessonsByGroup.get(l.group_id) ?? new Set<string>();
        s.add(l.date);
        lessonsByGroup.set(l.group_id, s);
      }
      const groups = Array.from(groupsMeta.values()).sort((a, b) => a.name.localeCompare(b.name));

      const kidList = Array.from(new Map(myEnroll.map((e: any) => [e.child_id, e.child])).values()).filter(Boolean) as { id: string; full_name: string; photo_path: string | null }[];
      // Порядок журнала: по дате зачисления (старые сверху) — новый
      // ребёнок всегда встаёт В КОНЕЦ списка тренера, а не в середину.
      const enrolledAtByChild = new Map<string, string>();
      for (const e of myEnroll as any[]) {
        const ts = (e.enrolled_at as string | null) ?? "";
        const cur = enrolledAtByChild.get(e.child_id);
        if (cur === undefined || (ts && ts < cur)) enrolledAtByChild.set(e.child_id, ts);
      }
      kidList.sort((a, b) =>
        (enrolledAtByChild.get(a.id) ?? "").localeCompare(enrolledAtByChild.get(b.id) ?? "")
        || a.full_name.localeCompare(b.full_name, "ru"));

      // Заморозки — фронт красит такие ячейки «в заморозке».
      const { frozenByChild } = await loadFreezes(kidList.map((k) => k.id), fromStr, toStr);
      // Занятия по группам без отменённых: на отменённое занятие ячейки
      // нет («−»), отмечать там нечего. Для ячейки берём занятие ИМЕННО
      // группы ребёнка (у тренера могут быть две группы в один день).
      const lessonByGroupDate = new Map<string, Map<string, string>>();
      for (const l of lessons ?? []) {
        if (l.status === "cancelled" || l.status === "force_majeure") continue;
        const m = lessonByGroupDate.get(l.group_id) ?? new Map<string, string>();
        if (!m.has(l.date)) m.set(l.date, l.id);
        lessonByGroupDate.set(l.group_id, m);
      }

      // Окно каждого ребёнка + мета для колонки с фамилией.
      // Ячейки — на КАЖДОЕ занятие его группы внутри окна (объединение окна
      // записи и сроков всех его карт). Капа «первые N дат от старта
      // абонемента» больше нет (2026-09-02): из-за него ребёнок с
      // действующим абонементом оставался без квадратика — даты сверх N,
      // пропуски съедали слоты, продление даты ничего не добавляло — и
      // тренер не мог его отметить. Число занятий живёт в остатке рядом с
      // фамилией; ушёл в минус — офис видит долг.
      const windowByChild = new Map<string, TabelWindow>();
      for (const kid of kidList) {
        windowByChild.set(
          kid.id,
          buildTabelWindow(enrollWindowsByChild.get(kid.id), cardWindowsByChild.get(kid.id)),
        );
      }
      const metaByChild = await loadTabelKidMeta(kidIds as string[], cardWindowsByChild);

      for (const kid of kidList) {
        const row = new Map<string, Cell>();
        const win = windowByChild.get(kid.id);
        const kidGroupIds = groupsByChild.get(kid.id) ?? new Set<string>();
        for (const d of dates) {
          // Ячейка живёт только внутри окна ребёнка — и в прошлом тоже.
          // Пришёл в группу 16-го числа: 1–15 остаются серыми, а не пустыми
          // кликабельными. Кончился срок — дальше отмечать нельзя.
          if (win?.start && d < win.start) continue;
          if (win?.end && d > win.end) continue;
          if (removedByChild.get(kid.id)?.has(d)) continue;
          let lid: string | undefined;
          for (const gid of kidGroupIds) {
            lid = lessonByGroupDate.get(gid)?.get(d);
            if (lid) break;
          }
          if (lid) row.set(d, { lesson_id: lid, status: null });
        }
        grid.set(kid.id, row);
      }
      // Overlay actual attendance.
      // Отметка вне окна — это история (ребёнка вернули, урок перенесли,
      // старые данные). Показываем её, но помечаем locked: менять такую
      // ячейку нельзя, абонемент её уже не покрывает.
      for (const a of att ?? []) {
        const date = lessonByIdDate.get(a.lesson_id);
        if (!date) continue;
        const row = grid.get(a.child_id);
        if (!row) continue;
        row.set(date, { lesson_id: a.lesson_id, status: a.status, locked: !row.has(date) });
      }

      return {
        kids: kidList,
        dates,
        grid,
        groupsCount: groupsCount ?? 0,
        enrollmentsCount: myEnroll.length,
        // Для фронта: список групп тренера и таблица «дочки по группе».
        groups,
        groupsByChild,
        lessonsByGroup,
        frozenByChild,
        removedByChild,
        metaByChild,
        windowByChild,
      };
    },
  });

// ======================================================================
// Group tabel — табель одной группы (админ в расписании, только просмотр).
// Зеркало useCoachTabel, но фильтр по group_id вместо coach_id.
// ======================================================================
export const useGroupTabel = (
  groupId?: string,
  range?: { from: string; to: string },
) =>
  useQuery({
    queryKey: ["group_tabel", groupId, range?.from, range?.to],
    enabled: !!groupId && !!range?.from && !!range?.to,
    queryFn: async () => {
      const fromStr = range!.from;
      const toStr = range!.to;

      // 1. Состав группы одним security definer RPC (20260804000001):
      // журнал должен показывать всю группу любой офис-роли, а обычный
      // select резался manager-scoping-ом (менеджер видел только своих
      // детей — чужая группа выглядела пустой). RPC отдаёт детей, карты
      // той же секции, менеджера и остаток занятий. Строка = ребёнок × карта.
      const { data: rosterRows, error: ee } = await supabase
        .rpc("fn_group_tabel_roster", { p_group_id: groupId! });
      if (ee) throw ee;
      type RosterRow = {
        child_id: string;
        full_name: string;
        enroll_start: string | null;
        enroll_end: string | null;
        card_id: string | null;
        card_start: string | null;
        card_end: string | null;
        card_status: string | null;
        total_lessons: number | null;
        remaining: number | null;
        manager_name: string | null;
      };
      const roster = (rosterRows ?? []) as RosterRow[];

      const enrollWindowsByChild = new Map<string, Array<{ start: string | null; end: string | null }>>();
      const cardWindowsByChild = new Map<string, TabelCardRow[]>();
      const managerByChild = new Map<string, string | null>();
      const remainingByCard = new Map<string, number | null>();
      const seenEnrollWin = new Set<string>();
      for (const r of roster) {
        // Окно записи повторяется в каждой строке ребёнка — кладём один раз.
        const winKey = `${r.child_id}|${r.enroll_start}|${r.enroll_end}`;
        if (!seenEnrollWin.has(winKey)) {
          seenEnrollWin.add(winKey);
          const arr = enrollWindowsByChild.get(r.child_id) ?? [];
          arr.push({ start: r.enroll_start, end: r.enroll_end });
          enrollWindowsByChild.set(r.child_id, arr);
        }
        if (r.card_id && r.card_start && r.card_end) {
          const arr = cardWindowsByChild.get(r.child_id) ?? [];
          if (!arr.some((c) => c.id === r.card_id)) {
            arr.push({ id: r.card_id, start: r.card_start, end: r.card_end, status: r.card_status ?? "active", total_lessons: r.total_lessons });
            cardWindowsByChild.set(r.child_id, arr);
          }
          remainingByCard.set(r.card_id, r.remaining);
        }
        if (!managerByChild.has(r.child_id)) managerByChild.set(r.child_id, r.manager_name);
      }
      const kidIds = Array.from(new Set(roster.map((r) => r.child_id)));

      // 2. Занятия группы. ВАЖНО: нижняя граница — самая ранняя
      // card.start_date, иначе cap-by-total_lessons считает «первые N»
      // от первого числа месяца, а не от начала абонемента.
      let lessonsFrom = fromStr;
      for (const [, cards] of cardWindowsByChild) {
        for (const c of cards) {
          if (c.start < lessonsFrom) lessonsFrom = c.start;
        }
      }
      const { data: lessons, error: le } = await supabase
        .from("lessons")
        .select("id, date, group_id, status")
        .eq("group_id", groupId!)
        .gte("date", lessonsFrom)
        .lte("date", toStr)
        .order("date");
      if (le) throw le;

      // 3. Посещаемость по этим занятиям.
      const lessonIds = (lessons ?? []).map((l) => l.id);
      const { data: att, error: ae } = lessonIds.length
        ? await supabase
            .from("attendance")
            .select("lesson_id, child_id, status")
            .in("lesson_id", lessonIds)
        : { data: [], error: null };
      if (ae) throw ae;

      const lessonByIdDate = new Map<string, string>();
      const lessonByDate = new Map<string, string>();
      for (const l of lessons ?? []) {
        lessonByIdDate.set(l.id, l.date);
        if (!lessonByDate.has(l.date)) lessonByDate.set(l.date, l.id);
      }
      // Тренировки, снятые с абонемента офисом: у ребёнка ячейки нет
      // (серый квадрат «снята с абонемента»).
      const { data: excl } = lessonIds.length
        ? await supabase
            .from("card_lesson_exclusions")
            .select("lesson_id, child_id")
            .in("lesson_id", lessonIds)
        : { data: [] };
      const removedByChild = new Map<string, Set<string>>();
      for (const x of (excl ?? []) as Array<{ lesson_id: string; child_id: string }>) {
        const date = lessonByIdDate.get(x.lesson_id);
        if (!date) continue;
        const s = removedByChild.get(x.child_id) ?? new Set<string>();
        s.add(date);
        removedByChild.set(x.child_id, s);
      }
      type Cell = { lesson_id: string; status: string | null; locked?: boolean };
      const grid = new Map<string, Map<string, Cell>>();
      // allDates — от lessonsFrom (для cap-by-N), dates — только видимый
      // диапазон [fromStr, toStr] (рендерится в сетке).
      const allDatesSet = new Set<string>();
      const datesSet = new Set<string>();
      for (const l of lessons ?? []) {
        allDatesSet.add(l.date);
        if (l.date >= fromStr && l.date <= toStr) datesSet.add(l.date);
      }
      const allDates = Array.from(allDatesSet).sort();
      const dates = Array.from(datesSet).sort();
      const kidList = Array.from(
        new Map(roster.map((r) => [r.child_id, { id: r.child_id, full_name: r.full_name, photo_path: null as string | null }])).values(),
      ).sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));

      // Фото детей — отдельным запросом: RPC состава их не отдаёт, а менять
      // сигнатуру fn_group_tabel_roster ради аватарки не стоит. Ошибку тут
      // глотаем: журнал важнее фотографий.
      if (kidList.length) {
        const { data: photoRows } = await supabase
          .from("children")
          .select("id, photo_path")
          .in("id", kidList.map((k) => k.id));
        const photoById = new Map((photoRows ?? []).map((p) => [p.id as string, p.photo_path as string | null]));
        for (const k of kidList) k.photo_path = photoById.get(k.id) ?? null;
      }

      // Заморозки — фронт красит такие ячейки «в заморозке».
      const { frozenByChild } = await loadFreezes(kidList.map((k) => k.id), fromStr, toStr);
      // Даты без отменённых занятий: на отменённое занятие ячейки нет.
      const validDates = new Set(
        (lessons ?? []).filter((l) => l.status !== "cancelled" && l.status !== "force_majeure").map((l) => l.date),
      );

      // Окно каждого ребёнка + мета для колонки с фамилией. Ячейки — на
      // каждое занятие в окне, без капа по числу занятий (см. useCoachTabel).
      const windowByChild = new Map<string, TabelWindow>();
      for (const kid of kidList) {
        windowByChild.set(
          kid.id,
          buildTabelWindow(enrollWindowsByChild.get(kid.id), cardWindowsByChild.get(kid.id)),
        );
      }
      // Мета из RPC-строк — отдельные select-ы (children/profiles/balance)
      // не нужны и резались бы RLS-ом у менеджера.
      const metaByChild = new Map<string, TabelKidMeta>();
      for (const kid of kidList) {
        const primary = primaryCard(cardWindowsByChild.get(kid.id));
        metaByChild.set(kid.id, {
          manager: managerByChild.get(kid.id) ?? null,
          cardStart: primary?.start ?? null,
          cardEnd: primary?.end ?? null,
          remaining: primary ? (remainingByCard.get(primary.id) ?? null) : null,
          total: primary?.total_lessons ?? null,
          cardStatus: primary?.status ?? null,
        });
      }

      for (const kid of kidList) {
        const row = new Map<string, Cell>();
        const win = windowByChild.get(kid.id);
        for (const d of dates) {
          // Ячейка живёт только внутри окна ребёнка — в прошлом тоже.
          // До прихода в группу и после конца срока остаются серые
          // квадраты: отмечать там нечего.
          if (win?.start && d < win.start) continue;
          if (win?.end && d > win.end) continue;
          if (!validDates.has(d)) continue;
          if (removedByChild.get(kid.id)?.has(d)) continue;
          const lid = lessonByDate.get(d);
          if (lid) row.set(d, { lesson_id: lid, status: null });
        }
        grid.set(kid.id, row);
      }
      // Отметки вне окна — история: показываем, но менять не даём (locked).
      for (const a of att ?? []) {
        const date = lessonByIdDate.get(a.lesson_id);
        if (!date) continue;
        const row = grid.get(a.child_id);
        if (!row) continue;
        row.set(date, { lesson_id: a.lesson_id, status: a.status, locked: !row.has(date) });
      }

      return {
        kids: kidList,
        dates,
        grid,
        enrollmentsCount: kidIds.length,
        lessonsCount: lessonIds.length,
        frozenByChild,
        removedByChild,
        metaByChild,
        windowByChild,
      };
    },
  });

// ======================================================================
// Freezes for a specific child (parent-facing view).
// ======================================================================
export const useFreezesForChild = (childId?: string) =>
  useQuery({
    queryKey: ["freezes_child", childId],
    enabled: !!childId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("freezes")
        .select("id, status, reason, start_date, end_date, created_at, approved_at, rejected_at, card:club_cards(type)")
        .eq("child_id", childId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

// ======================================================================
// Enrollments (for coach: who is in my groups)
// ======================================================================
export const useEnrollmentsByGroup = (groupId?: string, onDate?: string) =>
  useQuery({
    queryKey: ["enrollments_group", groupId, onDate ?? "all"],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollments")
        .select("*, child:children(*)")
        .eq("group_id", groupId!)
        .is("archived_at", null);
      if (error) throw error;
      // Скрываем архивированных детей: даже если их enrollment ещё активен,
      // child.deleted_at != null означает что ребёнок в архиве.
      let rows = (data ?? []).filter((e: any) => e.child && !e.child.deleted_at);
      // Окно записи: при onDate показываем ребёнка только если дата попадает
      // в [start_date, end_date]. NULL-граница = открыто (legacy/ручные записи
      // видны всегда). Фильтруем на клиенте — ростер группы небольшой.
      if (onDate) {
        rows = rows.filter((e: any) =>
          (e.start_date == null || e.start_date <= onDate) &&
          (e.end_date == null || e.end_date >= onDate),
        );
      }
      return rows;
    },
  });

// Состав занятия — единый security definer RPC fn_lesson_roster
// (20260902000001): окно записи ИЛИ абонемент секции покрывает дату ИЛИ
// по занятию уже есть отметка. Раньше модалка занятия и экран тренера
// фильтровали enrollments по окну записи, а оно у части детей устарело —
// «в карточке 3 пропуска, а в занятии ребёнка нет» (офис, 2026-09-02).
// Один round-trip вместо enrollments + children: быстрее открывается.
export type LessonRosterRow = {
  // Ключ строки: id записи в группу, либо child_id для «только отметка».
  id: string;
  child_id: string;
  via: "window" | "card" | "attendance";
  child: { id: string; full_name: string; card_number: string | null; photo_path: string | null; deleted_at: null };
};

export const useLessonRoster = (lessonId?: string) =>
  useQuery({
    queryKey: ["lesson_roster", lessonId],
    enabled: !!lessonId,
    queryFn: async (): Promise<LessonRosterRow[]> => {
      const { data, error } = await supabase.rpc("fn_lesson_roster", { p_lesson_id: lessonId! });
      if (error) throw error;
      type Row = { child_id: string; full_name: string; card_number: string | null; photo_path: string | null; enrollment_id: string | null; via: string };
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.enrollment_id ?? `att-${r.child_id}`,
        child_id: r.child_id,
        via: (r.via as LessonRosterRow["via"]) ?? "window",
        child: { id: r.child_id, full_name: r.full_name, card_number: r.card_number, photo_path: r.photo_path, deleted_at: null },
      }));
    },
  });

// Тренировки, снятые с абонемента ребёнка офисом («Удалить тренировки»,
// card_lesson_exclusions). Читается, чтобы прятать эти даты у ребёнка.
export type CardLessonExclusion = {
  id: string;
  club_card_id: string;
  child_id: string;
  lesson_id: string;
  reason: string | null;
  created_at: string;
  lesson: { date: string; start_time: string; status: string; group: { name: string } | null } | null;
};
export const useCardLessonExclusions = (childId?: string) =>
  useQuery({
    queryKey: ["card_lesson_exclusions", childId],
    enabled: !!childId,
    queryFn: async (): Promise<CardLessonExclusion[]> => {
      const { data, error } = await supabase
        .from("card_lesson_exclusions")
        .select("id, club_card_id, child_id, lesson_id, reason, created_at, lesson:lessons(date, start_time, status, group:groups(name))")
        .eq("child_id", childId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as Array<Omit<CardLessonExclusion, "lesson"> & { lesson: CardLessonExclusion["lesson"] | CardLessonExclusion["lesson"][] }>)
        .map((r) => ({ ...r, lesson: Array.isArray(r.lesson) ? (r.lesson[0] ?? null) : r.lesson }));
    },
  });

// All active enrollments for a single child (admin "Group" tab in ChildDrawer).
export const useChildEnrollments = (childId?: string) =>
  useQuery({
    queryKey: ["child_enrollments", childId],
    enabled: !!childId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollments")
        .select("id, group_id, enrolled_at, archived_at, start_date, end_date, group:groups(id, name, section_id, max_capacity, section:sections(name_ru, name_ky, color), coach:profiles!coach_id(full_name))")
        .eq("child_id", childId!)
        .is("archived_at", null)
        .order("enrolled_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

// Занятия конкретного ребёнка по его абонементам.
//
// Правило то же, что в табелях (cardPoolDates): занятия ребёнка = все
// занятия групп секции карты в её сроке [start, end]. Число занятий — это
// остаток (v_child_card_balance), а не фильтр. Раньше пул был «первые N
// занятий от старта карты» без учёта срока: продление конца карты не
// добавляло тренировок (жалоба офиса 2026-09-02).
export const useChildLessons = (
  childId?: string,
  range?: { from: string; to: string },
  // allCards: считать занятия по ВСЕМ картам ребёнка (включая expired/debt),
  // а не только по последней активной. Нужно вкладке «Посещения» в карточке
  // ребёнка: полная история с пропущенными днями, даже если абонемент истёк
  // (жалобы офиса 2026-08-28). Экраны родителя работают без опции — как раньше.
  opts?: { allCards?: boolean },
) =>
  useQuery({
    queryKey: ["child_lessons_v3", childId, range?.from, range?.to, opts?.allCards ?? false],
    enabled: !!childId && !!range?.from && !!range?.to,
    queryFn: async () => {
      const allCards = opts?.allCards ?? false;
      // 1. Записи, карты и заморозки ребёнка — параллельно (раньше
      // последовательно, карточка открывалась заметно дольше).
      let enrollQ = supabase
        .from("enrollments")
        .select("group_id, start_date, end_date, archived_at")
        .eq("child_id", childId!);
      // Для истории (allCards) берём и архивированные записи — иначе занятия
      // группы, из которой ребёнок ушёл, пропадают из истории.
      if (!allCards) enrollQ = enrollQ.is("archived_at", null);
      const [enrollRes, cardsRes, frzRes, exclRes] = await Promise.all([
        enrollQ,
        supabase
          .from("club_cards")
          .select("total_lessons, start_date, end_date, section_id, status")
          .eq("child_id", childId!)
          .in("status", allCards
            ? ["active", "ending", "frozen", "expired", "debt"]
            : ["active", "ending", "frozen"]),
        supabase
          .from("freezes")
          .select("start_date, end_date")
          .eq("child_id", childId!)
          .eq("status", "approved"),
        supabase
          .from("card_lesson_exclusions")
          .select("lesson_id")
          .eq("child_id", childId!),
      ]);
      if (enrollRes.error) throw enrollRes.error;
      // Снятые офисом тренировки — у ребёнка их нет.
      const excludedIds = new Set(((exclRes.data ?? []) as Array<{ lesson_id: string }>).map((x) => x.lesson_id));
      type EnrRow = { group_id: string; start_date: string | null; end_date: string | null; archived_at: string | null };
      const enrollments = (enrollRes.data ?? []) as EnrRow[];
      if (enrollments.length === 0) return [];

      const groupIds = Array.from(new Set(enrollments.map((e) => e.group_id)));
      // Группы, где ВСЕ записи ребёнка архивные: их занятия — только история
      // (date < сегодня), в «Предстоит» они попадать не должны.
      const liveGroups = new Set(enrollments.filter((e) => !e.archived_at).map((e) => e.group_id));
      const todayStr = localYmd();

      type CardRow = { total_lessons: number | null; start_date: string; end_date: string; section_id: string | null; status: string };
      const sorted = ((cardsRes.data ?? []) as CardRow[])
        // Самая «свежая» карта первой.
        .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
      // Обычный режим (родитель): одна карта — та, что покрывает сегодня,
      // иначе самая свежая. allCards: все.
      const current = sorted.find((c) => c.start_date <= todayStr && c.end_date >= todayStr) ?? sorted[0];
      const cardList = allCards ? sorted : (current ? [current] : []);
      if (cardList.length === 0) return [];

      // 2. Занятия групп ребёнка в объединённом сроке его карт.
      const minStart = cardList.reduce((s, c) => (c.start_date < s ? c.start_date : s), cardList[0]!.start_date);
      const maxEnd = cardList.reduce((s, c) => (c.end_date > s ? c.end_date : s), cardList[0]!.end_date);
      const { data: lessonsAll, error: le } = await supabase
        .from("lessons")
        .select("*, group:groups!inner(*, section:sections(*)), coach:profiles!coach_id(full_name)")
        .in("group_id", groupIds)
        .gte("date", minStart)
        .lte("date", maxEnd)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      if (le) throw le;

      let all = (lessonsAll ?? []) as Array<LessonWithGroup & { id: string; group_id: string; date: string; status: string }>;
      // Занятия архивных групп — только прошлое (история), не «Предстоит».
      if (allCards) {
        all = all.filter((l) => liveGroups.has(l.group_id) || l.date < todayStr);
      }

      // 3. Approved-заморозки: занятия в окне пропускаются (карта продлена
      // триггером на freezes).
      const freezes = (frzRes.data ?? []) as Array<{ start_date: string | null; end_date: string | null }>;
      const inFreeze = (d: string) =>
        freezes.some((f) => (f.start_date == null || d >= f.start_date) && (f.end_date == null || d <= f.end_date));

      // 4. Пул каждой карты = все занятия групп её секции в сроке карты (см.
      // cardPoolDates: срок определяет тренировки, число занятий — остаток).
      // Несколько карт — объединение без дублей.
      const keep = new Set<string>();
      for (const card of cardList) {
        for (const l of all) {
          if (l.date < card.start_date) continue;
          if (l.date > card.end_date) break;
          if (l.status === "cancelled" || l.status === "force_majeure" || inFreeze(l.date)) continue;
          if (excludedIds.has(l.id)) continue;
          const lessonSection = (l.group as { section_id?: string | null } | null)?.section_id ?? null;
          if (card.section_id && lessonSection && lessonSection !== card.section_id) continue;
          keep.add(l.id);
        }
      }
      const pool = all.filter((l) => keep.has(l.id));

      // 5. Финальная фильтрация под запрошенный диапазон (для конкретного
      // экрана: следующие 14 дней / видимый месяц / год истории).
      return pool.filter((l) => l.date >= range!.from && l.date <= range!.to) as LessonWithGroup[];
    },
  });

// ======================================================================
// Organization (single-tenant Phase 1) + users + audit log
// ======================================================================
export const useOrganization = () =>
  useQuery({
    queryKey: ["organization"],
    staleTime: REF_STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const useUsers = () =>
  useQuery({
    queryKey: ["users"],
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .is("deleted_at", null)
        .order("role")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

export const useAuditLog = (limit = 100) =>
  useQuery({
    queryKey: ["audit_log", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });

// ======================================================================
// Outreach log (weekly call/whatsapp per child)
// ======================================================================
export const useOutreachWeek = (weekStart: string) =>
  useQuery({
    queryKey: ["outreach", weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outreach_log")
        .select("*")
        .eq("week_start", weekStart);
      if (error) throw error;
      const map = new Map<string, { service_call_done: boolean; whatsapp_sent: boolean }>();
      for (const r of data ?? []) map.set((r as any).child_id, { service_call_done: r.service_call_done, whatsapp_sent: r.whatsapp_sent });
      return map;
    },
  });

// ======================================================================
// Aggregated counts (for sidebar badges + dashboard KPIs)
// ======================================================================
export const useStats = () =>
  useQuery({
    queryKey: ["stats"],
    // KPI-дашборд: 11 параллельных запросов. Не нужен real-time —
    // держим свежесть 60с, чтобы каскад не перезапускался слишком часто.
    staleTime: 60_000,
    queryFn: async () => {
      const since30 = new Date();
      since30.setDate(since30.getDate() - 30);
      const since30Str = since30.toISOString();
      const today = new Date().toISOString().slice(0, 10);
      const in7 = new Date();
      in7.setDate(in7.getDate() + 7);

      const [
        kidsRes,
        familiesRes,
        coachesRes,
        leadsRes,
        leadsNewRes,
        freezesPendingRes,
        cardsActiveRes,
        cardsExpRes,
        payments30,
        debtorsRes,
        attRes,
      ] = await Promise.all([
        supabase.from("children").select("id", { count: "exact", head: true }).eq("status", "active").is("deleted_at", null),
        supabase.from("families").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "coach").is("deleted_at", null),
        supabase.from("leads").select("id", { count: "exact", head: true }),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", "new"),
        supabase.from("freezes").select("id", { count: "exact", head: true }).eq("status", "pending"),
        // «Активных» считаем active + ending + frozen — заморозка не
        // выкидывает абонемент из клуба, просто ставит на паузу.
        supabase.from("club_cards").select("id", { count: "exact", head: true }).in("status", ["active", "ending", "frozen"]),
        supabase.from("club_cards").select("id, type, end_date, section_id, discount_pct, child_id, child:children(full_name)").in("status", ["active", "ending"]).gte("end_date", today).lte("end_date", in7.toISOString().slice(0, 10)),
        supabase.from("payments").select("amount").gte("paid_at", since30Str),
        supabase.from("children").select("id, full_name, family:families(father_phone, mother_phone)").eq("status", "debtor").is("deleted_at", null),
        supabase.from("attendance").select("status").gte("marked_at", since30Str).limit(2000),
      ]);

      const revenue30d = (payments30.data ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
      const att = attRes.data ?? [];
      const presentCount = att.filter((a) => a.status === "present" || a.status === "late" || a.status === "makeup").length;
      const attendancePct = att.length ? Math.round((presentCount / att.length) * 100) : 0;

      return {
        activeKids: kidsRes.count ?? 0,
        families: familiesRes.count ?? 0,
        coaches: coachesRes.count ?? 0,
        leadsTotal: leadsRes.count ?? 0,
        leadsNew: leadsNewRes.count ?? 0,
        freezesPending: freezesPendingRes.count ?? 0,
        cardsActive: cardsActiveRes.count ?? 0,
        cardsExpiring: cardsExpRes.data ?? [],
        revenue30d,
        debtors: debtorsRes.data ?? [],
        attendancePct,
      };
    },
  });

// Attendance breakdown by section (for dashboard chart)
export const useAttendanceBySection = () =>
  useQuery({
    queryKey: ["attendance_by_section"],
    queryFn: async (): Promise<{ id: string; name_ru: string; pct: number }[]> => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceStr = since.toISOString();
      const { data, error } = await supabase
        .from("attendance")
        .select("status, lesson:lessons!inner(group:groups!inner(section:sections!inner(id, name_ru)))")
        .gte("marked_at", sinceStr)
        .limit(5000);
      if (error) throw error;
      const buckets = new Map<string, { name: string; total: number; present: number }>();
      for (const r of data ?? []) {
        const sec = (r as any).lesson?.group?.section;
        if (!sec?.id) continue;
        const b = buckets.get(sec.id) ?? { name: sec.name_ru, total: 0, present: 0 };
        b.total++;
        if (r.status === "present" || r.status === "late" || r.status === "makeup") b.present++;
        buckets.set(sec.id, b);
      }
      return Array.from(buckets.entries()).map(([id, b]) => ({ id, name_ru: b.name, pct: b.total ? Math.round((b.present / b.total) * 100) : 0 }));
    },
  });

// Kids per section — уникальные дети, у которых есть активный/ending/frozen
// абонемент в данной секции. Используется на дашборде директора.
export const useKidsBySection = () =>
  useQuery({
    queryKey: ["kids_by_section"],
    staleTime: 60_000,
    queryFn: async (): Promise<{ id: string; name_ru: string; name_ky: string; color: string | null; count: number }[]> => {
      const data = await fetchAllRows<{ child_id: string; section: unknown }>((from, to) =>
        supabase
          .from("club_cards")
          .select("child_id, section:sections!inner(id, name_ru, name_ky, color)")
          .in("status", ["active", "ending", "frozen"])
          .order("id")
          .range(from, to) as unknown as PagedResult<{ child_id: string; section: unknown }>);
      const buckets = new Map<string, { id: string; name_ru: string; name_ky: string; color: string | null; kids: Set<string> }>();
      for (const r of (data ?? []) as any[]) {
        const sec = r.section;
        if (!sec?.id || !r.child_id) continue;
        const b = buckets.get(sec.id) ?? { id: sec.id, name_ru: sec.name_ru, name_ky: sec.name_ky, color: sec.color, kids: new Set<string>() };
        b.kids.add(r.child_id);
        buckets.set(sec.id, b);
      }
      return Array.from(buckets.values())
        .map((b) => ({ id: b.id, name_ru: b.name_ru, name_ky: b.name_ky, color: b.color, count: b.kids.size }))
        .sort((a, b) => b.count - a.count);
    },
  });

// ======================================================================
// Coach rates / payroll / refunds (backend-mediated)
// ======================================================================
export type CoachRate = {
  id: string;
  coach_id: string;
  group_id: string;
  rate_per_kid: number;
  effective_from: string;
  effective_to: string | null;
  comment: string | null;
  coach: { full_name: string } | null;
  group: { name: string; section_id: string } | null;
};

export const useCoachRates = (filter: { coach_id?: string; group_id?: string } = {}) =>
  useQuery({
    queryKey: ["coach_rates", filter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.coach_id) params.set("coach_id", filter.coach_id);
      if (filter.group_id) params.set("group_id", filter.group_id);
      const r = await apiGet<{ rates: CoachRate[] }>(`/v1/coach-rates${params.toString() ? "?" + params : ""}`);
      return r.rates;
    },
  });

export type PayrollPeriod = {
  id?: string;
  coach_id: string;
  period_start: string;
  period_end: string;
  computed_amount: number;
  manual_adjustment: number;
  adjustment_reason: string | null;
  status: "draft" | "advance_paid" | "paid";
  // ТЗ §10.2: сумма аванса фиксируется в момент выдачи (50% заработанного
  // с 1-го по 20-е), чтобы к итоговой выплате было видно, что уже выдано.
  advance_amount: number | null;
  advance_paid_at: string | null;
  approved_at: string | null;
  coach?: { full_name: string } | null;
  approver?: { full_name: string } | null;
};

export const usePayroll = (period_start: string, period_end: string) =>
  useQuery({
    queryKey: ["payroll", period_start, period_end],
    queryFn: async () => {
      const r = await apiGet<{ periods: PayrollPeriod[] }>(
        `/v1/payroll?period_start=${period_start}&period_end=${period_end}`,
      );
      return r.periods;
    },
  });

export const useMyPayroll = (period_start: string, period_end: string) =>
  useQuery({
    queryKey: ["payroll_me", period_start, period_end],
    queryFn: async () => {
      const r = await apiGet<{ period: PayrollPeriod }>(
        `/v1/payroll/me?period_start=${period_start}&period_end=${period_end}`,
      );
      return r.period;
    },
  });

// Live-сводка по тренерам на текущий месяц.
// - actual_amount   — что уже накапало по факту present-отметок.
// - max_amount      — максимум за месяц если бы каждый ребёнок пришёл
//                     на ВСЕ занятия (включая прошедшие, на которых
//                     мог быть пропуск). Это потолок шкалы.
// - projected_amount = max - actual, т.е. «сколько ещё может прийти»
//                     без двойного счёта (для обратной совместимости).
export type CoachLivePayroll = {
  coach_id: string;
  full_name: string | null;
  period_start: string;
  period_end: string;
  actual_amount: number;
  max_amount: number;
  projected_amount: number;
  // Сколько present-посещений было на занятиях тренера за период.
  visits_count?: number;
  // Разбивка по группам (только /v1/payroll/live): сколько посещений в
  // каждой группе тренера и сколько он заработал именно за эту группу.
  groups?: Array<{ group_id: string; name: string; visits: number; earned: number }>;
  // Факт за сегодня: пришедшие дети × ставка группы (текущий месяц).
  today_date?: string;
  today_visits?: number;
  today_amount?: number;
  today_groups?: Array<{ group_id: string; name: string; visits: number; earned: number }>;
};

export const useLivePayroll = () =>
  useQuery({
    queryKey: ["payroll_live"],
    queryFn: async () => {
      const r = await apiGet<{ items: CoachLivePayroll[] }>("/v1/payroll/live");
      return r.items;
    },
  });

// Если передан periodStart (YYYY-MM-DD), backend посчитает actual/max
// для запрошенного месяца через compute_coach_*-функции. Без параметра —
// дефолтный текущий месяц через view v_coach_live_payroll.
export const useMyLivePayroll = (periodStart?: string) =>
  useQuery({
    queryKey: ["payroll_me_live", periodStart ?? "current"],
    queryFn: async () => {
      const qs = periodStart ? `?period_start=${periodStart}` : "";
      const r = await apiGet<{ live: CoachLivePayroll | null }>(`/v1/payroll/me/live${qs}`);
      return r.live;
    },
  });

export type Refund = {
  id: string;
  club_card_id: string;
  child_id: string;
  kind: "with_30pct" | "full_no_fee";
  remaining_lessons: number;
  total_lessons: number;
  card_price: number;
  refund_amount: number;
  fee_amount: number;
  reason: string;
  processed_at: string;
  child: { full_name: string } | null;
  processor: { full_name: string } | null;
};

export const useRefunds = (card_id?: string) =>
  useQuery({
    queryKey: ["refunds", card_id ?? "all"],
    queryFn: async () => {
      const r = await apiGet<{ refunds: Refund[] }>(
        `/v1/refunds${card_id ? `?card_id=${card_id}` : ""}`,
      );
      return r.refunds;
    },
  });

// ======================================================================
// Staff (директор: список сотрудников)
// ======================================================================
export type StaffMember = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: "director" | "fitness_director" | "senior_manager" | "manager" | "cashier";
  is_active: boolean;
  avatar_url: string | null;
  inn: string | null;
  birthday: string | null;
  hire_date: string | null;
  address: string | null;
  notes?: string | null;
  created_at: string;
  deleted_at: string | null;
};

export const useStaff = (opts?: { includeArchived?: boolean }) =>
  useQuery({
    queryKey: ["staff", { archived: !!opts?.includeArchived }],
    queryFn: async () => {
      const qs = opts?.includeArchived ? "?include_archived=true" : "";
      const r = await apiGet<{ staff: StaffMember[] }>(`/v1/staff${qs}`);
      return r.staff;
    },
  });

// ======================================================================
// Managers list — для селекта «Ответственный менеджер» в карточке ребёнка
// ======================================================================
export const useManagers = () =>
  useQuery({
    queryKey: ["managers"],
    staleTime: REF_STALE,
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, email, role, organization_id")
        .in("role", ["senior_manager", "manager"])
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as unknown as Profile[];
    },
  });

// Single profile lookup — для отображения ответственного менеджера ребёнка
export const useProfile = (userId?: string | null) =>
  useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, email, role, organization_id, avatar_url")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Profile | null;
    },
  });

// ======================================================================
// Lesson notes — для тренера (одно занятие) и для родителя (feed)
// ======================================================================
export type LessonNote = {
  id: string;
  lesson_id: string;
  child_id: string;
  coach_id: string;
  text: string;
  photo_paths: string[];
  created_at: string;
  updated_at: string;
};

export const useLessonNotesForLesson = (lessonId?: string) =>
  useQuery({
    queryKey: ["lesson_notes", lessonId],
    enabled: !!lessonId,
    queryFn: async (): Promise<LessonNote[]> => {
      const { data, error } = await supabase
        .from("lesson_notes")
        .select("*")
        .eq("lesson_id", lessonId!);
      if (error) throw error;
      return (data ?? []) as LessonNote[];
    },
  });

// Заметки сразу по нескольким занятиям — для табеля тренера, чтобы
// показать индикатор «есть заметка» в нужных ячейках без N запросов.
export const useLessonNotesForLessons = (lessonIds: string[] = []) =>
  useQuery({
    queryKey: ["lesson_notes_bulk", lessonIds.slice().sort().join(",")],
    enabled: lessonIds.length > 0,
    queryFn: async (): Promise<Map<string, Set<string>>> => {
      const { data, error } = await supabase
        .from("lesson_notes")
        .select("lesson_id, child_id")
        .in("lesson_id", lessonIds);
      if (error) throw error;
      const m = new Map<string, Set<string>>();
      for (const r of data ?? []) {
        let s = m.get(r.lesson_id);
        if (!s) { s = new Set(); m.set(r.lesson_id, s); }
        s.add(r.child_id);
      }
      return m;
    },
  });

// Feed заметок для родителя (последние 50, по всем детям)
export type LessonNoteFeed = LessonNote & {
  lesson: { date: string; start_time: string; group_id: string | null } | null;
  child: { id: string; full_name: string } | null;
  coach: { full_name: string } | null;
};

// Все заметки текущего тренера — для собственной истории «что я писал».
export const useMyLessonNotes = (coachId?: string, limit = 100) =>
  useQuery({
    queryKey: ["lesson_notes_mine", coachId, limit],
    enabled: !!coachId,
    queryFn: async (): Promise<LessonNoteFeed[]> => {
      const { data, error } = await supabase
        .from("lesson_notes")
        .select(
          "*, lesson:lessons(date, start_time, group_id), child:children(id, full_name, deleted_at), coach:profiles!coach_id(full_name)",
        )
        .eq("coach_id", coachId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []).filter((r: any) => r.child && !r.child.deleted_at);
      return rows as unknown as LessonNoteFeed[];
    },
  });

export const useLessonNotesForParent = () =>
  useQuery({
    queryKey: ["lesson_notes_parent"],
    queryFn: async (): Promise<LessonNoteFeed[]> => {
      const { data, error } = await supabase
        .from("lesson_notes")
        .select(
          "*, lesson:lessons(date, start_time, group_id), child:children(id, full_name, deleted_at), coach:profiles!coach_id(full_name)",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      // Не показываем заметки о детях, которые в архиве.
      const rows = (data ?? []).filter((r: any) => r.child && !r.child.deleted_at);
      return rows as unknown as LessonNoteFeed[];
    },
  });

// Signed URL для фото из bucket lesson-notes (приватный)
export const useSignedLessonNotePhoto = (path?: string | null) =>
  useQuery({
    queryKey: ["lesson_note_photo", path],
    enabled: !!path,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.storage
        .from("lesson-notes")
        .createSignedUrl(path!, 60 * 60); // 1 hour
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });

// ======================================================================
// Freezes для конкретного занятия (тренер: какие дети заморожены на дату)
// ======================================================================
export const useFreezesForLessonDate = (lessonDate?: string, childIds?: string[]) =>
  useQuery({
    queryKey: ["freezes_lesson_date", lessonDate, (childIds ?? []).slice().sort().join(",")],
    enabled: !!lessonDate && !!childIds && childIds.length > 0,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("freezes")
        .select("child_id, start_date, end_date, status")
        .eq("status", "approved")
        .in("child_id", childIds!)
        .lte("start_date", lessonDate!)
        .gte("end_date", lessonDate!);
      if (error) throw error;
      const set = new Set<string>();
      for (const f of data ?? []) set.add(f.child_id);
      return set;
    },
  });

// ======================================================================
// Notifications (родитель)
// ======================================================================
export type Notification = {
  id: string;
  recipient_id: string;
  type: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
};

export const useNotifications = (limit = 50) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notifications", user?.id, limit],
    enabled: !!user?.id,
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("recipient_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });
};

export const useUnreadNotificationsCount = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notifications_unread", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", user!.id)
        .eq("is_read", false);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });
};

// ======================================================================
// Children list для родителя с указанием менеджера и тренера
// ======================================================================
export type ChildForParent = {
  id: string;
  full_name: string;
  birth_date: string;
  status: string;
  responsible_manager_id: string | null;
  family_id: string;
};

export const useMyChildren = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_children", user?.id],
    enabled: !!user?.id && user?.role === "parent",
    // Состав детей у родителя меняется только когда менеджер сам
    // добавляет/архивирует. Раз в 10 мин — с запасом.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ChildForParent[]> => {
      // children RLS уже пускает родителя к своим (через families.parent_user_id)
      const { data, error } = await supabase
        .from("children")
        .select("id, full_name, birth_date, status, responsible_manager_id, family_id")
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as ChildForParent[];
    },
  });
};

// Секции, которые ведёт конкретный тренер (через m2m section_coaches).
export const useCoachSections = (coachId?: string) =>
  useQuery({
    queryKey: ["coach_sections", coachId],
    enabled: !!coachId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("section_coaches")
        .select("section_id")
        .eq("coach_id", coachId!);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.section_id);
    },
  });

// Текущий тренер ребёнка (через enrollments → groups.coach_id)
export const useChildPrimaryCoach = (childId?: string) =>
  useQuery({
    queryKey: ["child_primary_coach", childId],
    enabled: !!childId,
    queryFn: async (): Promise<{ id: string; full_name: string; phone: string | null } | null> => {
      const { data, error } = await supabase
        .from("enrollments")
        .select("group:groups!inner(coach_id, coach:profiles!coach_id(id, full_name, phone))")
        .eq("child_id", childId!)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const c = (data as any)?.group?.coach;
      return c ? { id: c.id, full_name: c.full_name, phone: c.phone ?? null } : null;
    },
  });

// ---------------------------------------------------------------------
// Долг по абонементам ребёнка (просьба офиса 2026-09-10).
// Долг карты = цена со скидкой − оплаты по карте (нал/терминал, payments)
// − списания с депозита за эту карту (card_purchase/card_renewal).
// Отменённые (archived) карты не считаются — их деньги вернулись.
// Импорт августа-2026 (до запуска продаж в системе 20.08) для части карт
// записал только цену без платежей — у таких «долг» неизвестен, не
// показываем: считаем карту только если по ней есть хоть одна оплата
// либо она продана уже через систему (created_at ≥ 20.08.2026).
// ---------------------------------------------------------------------
const SYSTEM_SALES_SINCE = "2026-08-20";
export type CardDebt = {
  card_id: string;
  type: string;
  start_date: string;
  end_date: string;
  price: number;   // после скидки
  paid: number;
  debt: number;
};

// Оплаты по картам: нал/терминал (payments.club_card_id) + списания с
// депозита за карту (deposit_transactions.related_card_id).
type PaidByCard = Map<string, number>;
const buildPaidByCard = (
  pays: { club_card_id?: string | null; amount: number | string }[],
  deps: { related_card_id?: string | null; type: string; amount: number | string }[],
): PaidByCard => {
  const m: PaidByCard = new Map();
  for (const p of pays) {
    if (!p.club_card_id) continue;
    m.set(p.club_card_id, (m.get(p.club_card_id) ?? 0) + Number(p.amount));
  }
  for (const t of deps) {
    if (!t.related_card_id || (t.type !== "card_purchase" && t.type !== "card_renewal")) continue;
    m.set(t.related_card_id, (m.get(t.related_card_id) ?? 0) + Math.abs(Number(t.amount)));
  }
  return m;
};

type DebtCardInput = {
  id: string; type: string; status: string; start_date: string; end_date: string;
  price_paid: number | string; discount?: number | string | null; created_at?: string;
};
// known=false — импортная карта без единой оплаты: долг «неизвестен», а не
// подтверждён. Такие в карточке ребёнка не показываем, в списке должников —
// только по явному переключателю.
const cardDebtOf = (c: DebtCardInput, paidByCard: PaidByCard): CardDebt & { known: boolean } => {
  const price = Math.max(0, Number(c.price_paid) - Number(c.discount ?? 0));
  const paid = paidByCard.get(c.id) ?? 0;
  const known = paid > 0 || (c.created_at ?? "") >= SYSTEM_SALES_SINCE;
  return {
    card_id: c.id, type: c.type, start_date: c.start_date, end_date: c.end_date,
    price, paid, debt: Math.max(0, Math.round(price - paid)), known,
  };
};

export const useChildCardDebts = (childId?: string) => {
  const cards = useCardsForChild(childId);
  const pays = usePaymentsForChild(childId);
  const dep = useDepositHistory(childId, 500);
  const rows = useMemo((): CardDebt[] => {
    const paidByCard = buildPaidByCard(
      (pays.data ?? []) as { club_card_id?: string | null; amount: number | string }[],
      (dep.data ?? []) as { related_card_id?: string | null; type: string; amount: number | string }[],
    );
    return (cards.data ?? [])
      .filter((c) => c.status !== "archived")
      .map((c) => cardDebtOf(c as unknown as DebtCardInput, paidByCard))
      .filter((d) => d.known && d.debt > 0);
  }, [cards.data, pays.data, dep.data]);
  return {
    data: rows,
    total: rows.reduce((s, d) => s + d.debt, 0),
    isLoading: cards.isLoading || pays.isLoading || dep.isLoading,
  };
};

// ---------------------------------------------------------------------
// Список должников по всему клубу (просьба офиса 2026-09-18). Считается
// на клиенте тем же правилом, что и долг в карточке ребёнка. PostgREST
// отдаёт максимум 1000 строк за запрос — карт больше, поэтому пагинация.
// ---------------------------------------------------------------------
export type DebtorRow = {
  child_id: string;
  full_name: string;
  child_status: string;
  phones: string[];
  responsible_manager_id: string | null;
  cards: (CardDebt & { known: boolean })[];
  total: number;
  // true — хотя бы одна карта с подтверждённым долгом (оплата была или
  // продажа через систему); false — только импортные карты без оплат.
  known: boolean;
};

type DebtorCardRow = DebtCardInput & {
  child_id: string;
  child: {
    id: string; full_name: string; status: string; deleted_at: string | null;
    responsible_manager_id: string | null;
    family: { father_phone: string | null; mother_phone: string | null } | null;
  } | null;
};

export const useAllCardDebts = () =>
  useQuery({
    queryKey: ["card_debts_all"],
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<DebtorRow[]> => {
      const [cards, pays, deps] = await Promise.all([
        fetchAllRows<DebtorCardRow>((from, to) =>
          supabase
            .from("club_cards")
            .select("id, child_id, type, status, price_paid, discount, start_date, end_date, created_at, child:children(id, full_name, status, deleted_at, responsible_manager_id, family:families(father_phone, mother_phone))")
            .neq("status", "archived")
            .order("created_at", { ascending: false })
            .range(from, to) as unknown as PromiseLike<{ data: DebtorCardRow[] | null; error: unknown }>),
        fetchAllRows<{ club_card_id: string | null; amount: number | string }>((from, to) =>
          supabase
            .from("payments")
            .select("club_card_id, amount")
            .not("club_card_id", "is", null)
            .order("paid_at", { ascending: false })
            .range(from, to)),
        fetchAllRows<{ related_card_id: string | null; type: string; amount: number | string }>((from, to) =>
          supabase
            .from("deposit_transactions")
            .select("related_card_id, type, amount")
            .not("related_card_id", "is", null)
            .in("type", ["card_purchase", "card_renewal"])
            .order("paid_at", { ascending: false })
            .range(from, to)),
      ]);
      const paidByCard = buildPaidByCard(pays, deps);
      const byChild = new Map<string, DebtorRow>();
      for (const c of cards) {
        if (!c.child || c.child.deleted_at) continue;
        const d = cardDebtOf(c, paidByCard);
        if (d.debt <= 0) continue;
        const row = byChild.get(c.child_id) ?? {
          child_id: c.child_id,
          full_name: c.child.full_name,
          child_status: c.child.status,
          phones: [c.child.family?.father_phone, c.child.family?.mother_phone].filter((p): p is string => !!p),
          responsible_manager_id: c.child.responsible_manager_id,
          cards: [], total: 0, known: false,
        };
        row.cards.push(d);
        row.known = row.known || d.known;
        byChild.set(c.child_id, row);
      }
      // Итог ребёнка — только подтверждённые карты; импортные без оплат
      // сумму не увеличивают (их долг неизвестен).
      const rows = Array.from(byChild.values()).map((r) => ({
        ...r,
        total: r.cards.filter((d) => d.known).reduce((s, d) => s + d.debt, 0),
      }));
      rows.sort((a, b) => b.total - a.total || a.full_name.localeCompare(b.full_name));
      return rows;
    },
  });
