// API-хуки модуля «Персональные тренировки» (ПТ).
// Чтение — напрямую из Supabase (RLS), мутации — через backend API.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from "./api-client";
import { toast } from "../ui/toast";
import type {
  PtService,
  PtServiceCoachRate,
  PtPackage,
  PtPackageGroup,
  PtSession,
  PtLesson,
  PtCoachComment,
  PtSubstitutionRow,
  PtPayrollRow,
} from "../types/database";

const invalidatePt = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({
    predicate: (q) => String(q.queryKey[0]).startsWith("pt_"),
  });

// ============================================================
// Композитные типы
// ============================================================
export type PtServiceWithRates = PtService & {
  rates: PtServiceCoachRate[];
  section: { name_ru: string; name_ky: string } | null;
};

export type PtPackageFull = PtPackage & {
  child: { full_name: string } | null;
  service: { name: string; type: string } | null;
  coach: { full_name: string } | null;
  seller: { full_name: string } | null;
  group: PtPackageGroup | null;
};

export type PtSessionFull = PtSession & {
  // section_id нужен расписанию: фильтр «по секциям» работает и для ПТ.
  service: { id: string; name: string; type: string; section_id: string | null } | null;
  coach: { full_name: string } | null;
  actual_coach: { full_name: string } | null;
  lessons: (PtLesson & { child: { full_name: string } | null })[];
};

export type PtLessonFull = PtLesson & {
  session: PtSession | null;
  child: { full_name: string } | null;
};

// ============================================================
// QUERIES
// ============================================================
export const usePtServices = (includeInactive = false) =>
  useQuery({
    queryKey: ["pt_services", includeInactive],
    staleTime: 60_000,
    queryFn: async (): Promise<PtServiceWithRates[]> => {
      let q = supabase
        .from("pt_services")
        .select("*, rates:pt_service_coach_rates(*), section:sections(name_ru, name_ky)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PtServiceWithRates[];
    },
  });

export const usePtPackages = (filters?: { child_id?: string; coach_id?: string; status?: string }) =>
  useQuery({
    queryKey: ["pt_packages", filters ?? {}],
    queryFn: async (): Promise<PtPackageFull[]> => {
      let q = supabase
        .from("pt_packages")
        .select(
          "*, child:children(full_name), service:pt_services(name, type), coach:profiles!pt_packages_coach_id_fkey(full_name), seller:profiles!pt_packages_sold_by_fkey(full_name), group:pt_package_groups(*)"
        )
        .order("created_at", { ascending: false });
      if (filters?.child_id) q = q.eq("child_id", filters.child_id);
      if (filters?.coach_id) q = q.eq("coach_id", filters.coach_id);
      if (filters?.status) q = q.eq("status", filters.status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PtPackageFull[];
    },
  });

export const usePtSessions = (filters: {
  from?: string;
  to?: string;
  coach_id?: string;
  service_id?: string;
  child_id?: string;
}) =>
  useQuery({
    queryKey: ["pt_sessions", filters],
    queryFn: async (): Promise<PtSessionFull[]> => {
      let q = supabase
        .from("pt_sessions")
        .select(
          "*, service:pt_services(id, name, type, section_id), coach:profiles!pt_sessions_coach_id_fkey(full_name), actual_coach:profiles!pt_sessions_actual_coach_id_fkey(full_name), lessons:pt_lessons(*, child:children(full_name))"
        )
        .order("date", { ascending: false })
        .order("start_time", { ascending: true });
      if (filters.from) q = q.gte("date", filters.from);
      if (filters.to) q = q.lte("date", filters.to);
      if (filters.coach_id) q = q.eq("coach_id", filters.coach_id);
      if (filters.service_id) q = q.eq("service_id", filters.service_id);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as unknown as PtSessionFull[];
      if (filters.child_id) {
        rows = rows.filter((s) => s.lessons.some((l) => l.child_id === filters.child_id));
      }
      return rows;
    },
  });

// История посещений ребёнка по ПТ (карточка клиента, §1)
export const usePtLessonsForChild = (childId?: string) =>
  useQuery({
    queryKey: ["pt_lessons_child", childId],
    enabled: !!childId,
    queryFn: async (): Promise<PtLessonFull[]> => {
      const { data, error } = await supabase
        .from("pt_lessons")
        .select("*, session:pt_sessions(*), child:children(full_name)")
        .eq("child_id", childId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PtLessonFull[];
    },
  });

export const usePtCoachComments = (childId?: string) =>
  useQuery({
    queryKey: ["pt_coach_comments", childId],
    enabled: !!childId,
    queryFn: async (): Promise<(PtCoachComment & { coach: { full_name: string } | null })[]> => {
      const { data, error } = await supabase
        .from("pt_coach_comments")
        .select("*, coach:profiles(full_name)")
        .eq("child_id", childId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as (PtCoachComment & { coach: { full_name: string } | null })[];
    },
  });

// Реестр замен (§20)
export const usePtSubstitutions = (from?: string, to?: string) =>
  useQuery({
    queryKey: ["pt_substitutions", from, to],
    queryFn: async (): Promise<PtSubstitutionRow[]> => {
      let q = supabase.from("v_pt_substitutions").select("*").order("date", { ascending: false });
      if (from) q = q.gte("date", from);
      if (to) q = q.lte("date", to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PtSubstitutionRow[];
    },
  });

// Зарплата по ПТ (§12, §20)
export const usePtPayroll = (from?: string, to?: string, coachId?: string) =>
  useQuery({
    queryKey: ["pt_payroll", from, to, coachId],
    queryFn: async (): Promise<{ from: string; to: string; items: PtPayrollRow[] }> => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (coachId) params.set("coach_id", coachId);
      const qs = params.toString();
      return apiGet(`/v1/pt/payroll${qs ? `?${qs}` : ""}`);
    },
  });

export const usePtMyPayroll = (from?: string, to?: string) =>
  useQuery({
    queryKey: ["pt_payroll_me", from, to],
    queryFn: async (): Promise<{ from: string; to: string } & PtPayrollRow> => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      return apiGet(`/v1/pt/payroll/me${qs ? `?${qs}` : ""}`);
    },
  });

export const usePtSummary = (from?: string, to?: string) =>
  useQuery({
    queryKey: ["pt_summary", from, to],
    queryFn: async (): Promise<{
      from: string;
      to: string;
      completed_sessions: number;
      cancelled_sessions: number;
      rescheduled_sessions: number;
      coach_accruals: number;
    }> => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      return apiGet(`/v1/pt/reports/summary${qs ? `?${qs}` : ""}`);
    },
  });

// Обязательные комментарии тренера (§16)
export type PtPendingComment = {
  id: string;
  child_id: string;
  lessons_used: number;
  lessons_total: number;
  comments_due: number;
  comments_have: number;
  next_milestone: number;
  child: { full_name: string } | { full_name: string }[] | null;
  service: { name: string } | { name: string }[] | null;
};

export const usePtPendingComments = (enabled = true) =>
  useQuery({
    queryKey: ["pt_pending_comments"],
    enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<PtPendingComment[]> => {
      const res = await apiGet<{ items: PtPendingComment[] }>("/v1/pt/comments/pending");
      return res.items;
    },
  });

// ============================================================
// MUTATIONS
// ============================================================
export const usePtCreateService = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<PtService>) =>
      apiPost<{ ok: boolean; service: PtService }>("/v1/pt/services", input),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Услуга создана");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtUpdateService = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<PtService>) =>
      apiPatch<{ ok: boolean }>(`/v1/pt/services/${id}`, patch),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Услуга обновлена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtDeleteService = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiDelete<{ ok: boolean }>(`/v1/pt/services/${id}`),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Услуга удалена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtSetCoachRates = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      service_id: string;
      rates: { coach_id: string; price?: number | null; percent?: number | null }[];
    }) => apiPut<{ ok: boolean }>(`/v1/pt/services/${input.service_id}/coach-rates`, { rates: input.rates }),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Ставки тренеров сохранены");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export type PtSellInput = {
  service_id: string;
  coach_id: string;
  group_name?: string | null;
  payment_method: "cash" | "terminal";
  items: {
    child_id: string;
    price?: number;
    pay_cash?: number;
    pay_deposit?: number;
    in_debt?: boolean;
    debt_comment?: string | null;
  }[];
};

export const usePtSellPackages = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PtSellInput) =>
      apiPost<{ ok: boolean; group_id: string | null; package_ids: string[] }>(
        "/v1/pt/packages/sell",
        input,
        { idempotent: true }
      ),
    onSuccess: () => {
      invalidatePt(qc);
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast.ok("Пакет продан");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtPayPackage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      package_id: string;
      amount: number;
      use_deposit?: number;
      method: "cash" | "terminal";
      comment?: string;
    }) =>
      apiPost<{ ok: boolean }>(
        `/v1/pt/packages/${input.package_id}/pay`,
        { amount: input.amount, use_deposit: input.use_deposit ?? 0, method: input.method, comment: input.comment },
        { idempotent: true }
      ),
    onSuccess: () => {
      invalidatePt(qc);
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast.ok("Оплата принята");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

const simplePackageAction = (path: string, okMsg: string) => () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { package_id: string; body?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean }>(`/v1/pt/packages/${input.package_id}/${path}`, input.body ?? {}),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok(okMsg);
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtActivatePackage = simplePackageAction("activate", "Пакет активирован");
export const usePtBlockPackage = simplePackageAction("block", "Пакет заблокирован");
export const usePtUnblockPackage = simplePackageAction("unblock", "Пакет разблокирован");
export const usePtExtendPackage = simplePackageAction("extend", "Срок действия изменён");
export const usePtAnnulPackage = simplePackageAction("annul", "Пакет аннулирован");
export const usePtChangeCoach = simplePackageAction("change-coach", "Тренер изменён");

export const usePtRefundPackage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      package_id: string;
      kind: "partial" | "full";
      amount: number;
      reason: string;
      to_deposit: boolean;
      method: "cash" | "terminal";
    }) =>
      apiPost<{ ok: boolean }>(
        `/v1/pt/packages/${input.package_id}/refund`,
        { kind: input.kind, amount: input.amount, reason: input.reason, to_deposit: input.to_deposit, method: input.method },
        { idempotent: true }
      ),
    onSuccess: () => {
      invalidatePt(qc);
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast.ok("Возврат оформлен");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtBookSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      service_id: string;
      coach_id: string;
      date: string;
      start_time: string;
      duration_min?: number;
      package_ids: string[];
      comment?: string;
    }) => apiPost<{ ok: boolean; session_id: string }>("/v1/pt/sessions", input),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Запись создана");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtUpdateSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      session_id: string;
      date?: string;
      start_time?: string;
      duration_min?: number;
      comment?: string;
    }) => {
      const { session_id, ...patch } = input;
      return apiPatch<{ ok: boolean }>(`/v1/pt/sessions/${session_id}`, patch);
    },
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Запись изменена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtCompleteSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      session_id: string;
      attendance: { lesson_id: string; status: "attended" | "missed"; charge?: boolean }[];
      actual_coach_id?: string | null;
      substitution_comment?: string | null;
      source?: "coach" | "admin";
    }) => {
      const { session_id, ...body } = input;
      return apiPost<{ ok: boolean }>(`/v1/pt/sessions/${session_id}/complete`, body);
    },
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Тренировка проведена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtCancelSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { session_id: string; reason: string; charge?: boolean }) =>
      apiPost<{ ok: boolean }>(`/v1/pt/sessions/${input.session_id}/cancel`, {
        reason: input.reason,
        charge: input.charge ?? false,
      }),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Тренировка отменена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtRescheduleSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { session_id: string; new_date: string; new_time: string; reason: string }) =>
      apiPost<{ ok: boolean; new_session_id: string }>(`/v1/pt/sessions/${input.session_id}/reschedule`, {
        new_date: input.new_date,
        new_time: input.new_time,
        reason: input.reason,
      }),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Тренировка перенесена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtSubstitute = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { session_id: string; actual_coach_id: string; comment?: string }) =>
      apiPost<{ ok: boolean }>(`/v1/pt/sessions/${input.session_id}/substitute`, {
        actual_coach_id: input.actual_coach_id,
        comment: input.comment,
      }),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Замена тренера оформлена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtSetLessonStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      lesson_id: string;
      status: "scheduled" | "attended" | "missed" | "cancelled" | "rescheduled";
      charge: boolean;
      reason?: string;
    }) =>
      apiPost<{ ok: boolean }>(`/v1/pt/lessons/${input.lesson_id}/set-status`, {
        status: input.status,
        charge: input.charge,
        reason: input.reason,
      }),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Статус посещения изменён");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const usePtAddCoachComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { package_id: string; milestone: number; text: string }) =>
      apiPost<{ ok: boolean }>("/v1/pt/comments", input),
    onSuccess: () => {
      invalidatePt(qc);
      toast.ok("Комментарий сохранён");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};
