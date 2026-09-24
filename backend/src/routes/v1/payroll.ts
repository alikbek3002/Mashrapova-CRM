import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";

const adjustSchema = z.object({
  manual_adjustment: z.number(),
  adjustment_reason: z.string().min(1, "Reason required"),
});

const recomputeSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Сколько оплачиваемых посещений было на занятиях тренера за период.
// Источник — v_payroll_attendance: ровно те строки, за которые
// compute_coach_payroll начисляет деньги (отметки «пришёл» на не-пробных
// и не отменённых занятиях). Дни approved-freeze present не содержат
// (триггер блокирует отметку), отдельного фильтра не нужно.
const countCoachVisits = async (coachId: string, from: string, to: string): Promise<number> => {
  const { count, error } = await supabaseAdmin
    .from("v_payroll_attendance")
    .select("attendance_id", { count: "exact", head: true })
    .eq("coach_id", coachId)
    .gte("date", from)
    .lte("date", to);
  if (error) throw error;
  return count ?? 0;
};

// Сегодня по клубному времени (Asia/Bishkek): «заработано за сегодня»
// вечером не должно уезжать на завтра/вчера из-за UTC.
const todayIsoBishkek = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bishkek" });

// Границы текущего месяца в ISO (UTC), как в view v_coach_live_payroll.
const currentMonthRange = () => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  return { start, today };
};

// Разбивка «посещения + заработано» по группам каждого тренера за период.
// Суммы НЕ пересчитываем здесь: берём готовый amount из v_payroll_attendance
// — того же view, по которому считает compute_coach_payroll. Раньше формула
// жила и в SQL, и тут (посещения × groups.coach_rate_per_child), и две копии
// разъезжались: по ТЗ §10.1 ставка за ребёнка больше не единственная модель,
// у тренера может быть процент от выручки или оклад, и умножение на ставку
// группы дало бы цифру, не совпадающую с начисленной.
type LiveGroupRow = { group_id: string; name: string; visits: number; earned: number };
const coachGroupBreakdown = async (
  coachIds: string[],
  from: string,
  to: string,
): Promise<Map<string, LiveGroupRow[]>> => {
  const out = new Map<string, LiveGroupRow[]>();
  if (coachIds.length === 0) return out;

  type PayrollRow = { attendance_id: string; coach_id: string; group_id: string; amount: number | string };

  // PostgREST режет выдачу (max-rows), поэтому листаем страницами.
  const rows: PayrollRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("v_payroll_attendance")
      .select("attendance_id, coach_id, group_id, amount")
      .in("coach_id", coachIds)
      .gte("date", from)
      .lte("date", to)
      // Без ORDER BY страницы range() могут пересекаться/пропускать строки.
      .order("attendance_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as PayrollRow[]));
    if ((data ?? []).length < PAGE) break;
  }

  // coach → group → счётчики.
  const acc = new Map<string, Map<string, { visits: number; earned: number }>>();
  const groupIds = new Set<string>();
  for (const r of rows) {
    groupIds.add(r.group_id);
    const byGroup = acc.get(r.coach_id) ?? new Map<string, { visits: number; earned: number }>();
    const cnt = byGroup.get(r.group_id) ?? { visits: 0, earned: 0 };
    cnt.visits += 1;
    cnt.earned += Number(r.amount ?? 0);
    byGroup.set(r.group_id, cnt);
    acc.set(r.coach_id, byGroup);
  }
  if (groupIds.size === 0) return out;

  const { data: groups, error: gErr } = await supabaseAdmin
    .from("groups")
    .select("id, name")
    .in("id", Array.from(groupIds));
  if (gErr) throw gErr;
  const groupNames = new Map(
    ((groups ?? []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]),
  );

  for (const [coachId, byGroup] of acc) {
    const list: LiveGroupRow[] = [];
    for (const [groupId, cnt] of byGroup) {
      list.push({
        group_id: groupId,
        name: groupNames.get(groupId) ?? "—",
        visits: cnt.visits,
        earned: Math.round(cnt.earned * 100) / 100,
      });
    }
    list.sort((a, b) => b.earned - a.earned || b.visits - a.visits);
    out.set(coachId, list);
  }
  return out;
};

export const payrollRoutes = async (app: FastifyInstance) => {
  // Live payroll: на каждого тренера актуальная ставка-факт за текущий
  // месяц (по present-отметкам) + прогноз до конца месяца (по будущим
  // scheduled занятиям и активным картам). Используется в дашборде
  // зарплат и виджете тренера. Кассир тоже видит.
  app.get(
    "/v1/payroll/live",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager", "cashier"),
      ],
    },
    async (req, reply) => {
      const user = req.user!;
      const { data, error } = await supabaseAdmin
        .from("v_coach_live_payroll")
        .select("coach_id, full_name, period_start, period_end, actual_amount, max_amount, projected_amount")
        .eq("organization_id", user.organization_id)
        .order("full_name");
      if (error) return reply.code(500).send({ error: "live_failed", message: error.message });
      // Посещения за текущий месяц (до сегодня — как actual_amount во view)
      // + разбивка по группам: сколько детей пришло в каждой группе и
      // сколько тренер заработал именно за неё (запрос офиса 2026-08-28).
      const { start, today } = currentMonthRange();
      // «Сегодня» — фактически заработанное за сегодняшний день: пришедшие
      // дети × ставка группы (запрос офиса 2026-09-02: показывать факт за
      // день, а не «сумму по всем детям» = потолок месяца).
      const todayLocal = todayIsoBishkek();
      const coachIds = (data ?? []).map((r) => r.coach_id);
      let byCoach = new Map<string, LiveGroupRow[]>();
      let todayByCoach = new Map<string, LiveGroupRow[]>();
      try {
        [byCoach, todayByCoach] = await Promise.all([
          coachGroupBreakdown(coachIds, start, today),
          coachGroupBreakdown(coachIds, todayLocal, todayLocal),
        ]);
      } catch (e) {
        req.log.warn({ err: e }, "payroll_live_breakdown_failed"); // разбивка не критична
      }
      const items = (data ?? []).map((r) => {
        const groups = byCoach.get(r.coach_id) ?? [];
        const todayGroups = todayByCoach.get(r.coach_id) ?? [];
        return {
          ...r,
          visits_count: groups.reduce((s, g) => s + g.visits, 0),
          groups,
          today_date: todayLocal,
          today_visits: todayGroups.reduce((s, g) => s + g.visits, 0),
          today_amount: todayGroups.reduce((s, g) => s + g.earned, 0),
          today_groups: todayGroups,
        };
      });
      return reply.send({ items });
    },
  );

  // Тренер видит свою live-сводку. По дефолту — текущий месяц (через view
  // v_coach_live_payroll). Если передан query `period_start=YYYY-MM-DD` —
  // считаем для запрошенного месяца через те же compute_coach_*-функции,
  // что и view. Так тренер на UI может листать вперёд/назад и видеть
  // прогноз/факт по любому месяцу.
  app.get<{ Querystring: { period_start?: string } }>(
    "/v1/payroll/me/live",
    { preHandler: [authenticate, requireRole("coach")] },
    async (req, reply) => {
      const user = req.user!;
      const periodStart = req.query?.period_start;

      if (!periodStart) {
        const { data, error } = await supabaseAdmin
          .from("v_coach_live_payroll")
          .select("coach_id, full_name, period_start, period_end, actual_amount, max_amount, projected_amount")
          .eq("coach_id", user.id)
          .maybeSingle();
        if (error) return reply.code(500).send({ error: "live_failed", message: error.message });
        if (!data) return reply.send({ live: null });
        // Посещения за текущий месяц (до сегодня — как actual_amount во view)
        // + факт за сегодня: пришедшие дети × ставка группы.
        const { start, today } = currentMonthRange();
        const todayLocal = todayIsoBishkek();
        let visits = 0;
        let todayGroups: LiveGroupRow[] = [];
        try {
          const [v, tb] = await Promise.all([
            countCoachVisits(user.id, start, today),
            coachGroupBreakdown([user.id], todayLocal, todayLocal),
          ]);
          visits = v;
          todayGroups = tb.get(user.id) ?? [];
        } catch { /* визиты не критичны */ }
        return reply.send({
          live: {
            ...data,
            visits_count: visits,
            today_date: todayLocal,
            today_visits: todayGroups.reduce((s, g) => s + g.visits, 0),
            today_amount: todayGroups.reduce((s, g) => s + g.earned, 0),
            today_groups: todayGroups,
          },
        });
      }

      // period_start приходит как 1-е число месяца YYYY-MM-01.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
        return reply.code(400).send({ error: "bad_period", message: "period_start must be YYYY-MM-DD" });
      }
      const [y, m] = periodStart.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // последний день месяца
      const periodEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // Для прошлых месяцев посещения = present по всему месяцу; для
      // текущего верхняя граница — сегодня (как actual_amount). Берём
      // min(periodEnd, today), чтобы будущие занятия не считались.
      const todayStr = new Date().toISOString().slice(0, 10);
      const visitsTo = periodEnd < todayStr ? periodEnd : todayStr;

      const [actualRes, maxRes, visits] = await Promise.all([
        supabaseAdmin.rpc("compute_coach_payroll", {
          p_coach: user.id, p_from: periodStart, p_to: periodEnd,
        }),
        supabaseAdmin.rpc("compute_coach_max_payroll", {
          p_coach: user.id, p_from: periodStart, p_to: periodEnd,
        }),
        countCoachVisits(user.id, periodStart, visitsTo).catch(() => 0),
      ]);
      if (actualRes.error) return reply.code(500).send({ error: "compute_failed", message: actualRes.error.message });
      if (maxRes.error)    return reply.code(500).send({ error: "compute_max_failed", message: maxRes.error.message });

      const actual = Number(actualRes.data ?? 0);
      const max    = Number(maxRes.data ?? 0);
      return reply.send({
        live: {
          coach_id: user.id,
          full_name: null,
          period_start: periodStart,
          period_end:   periodEnd,
          actual_amount: actual,
          max_amount:    max,
          projected_amount: Math.max(0, max - actual),
          visits_count: visits,
        },
      });
    },
  );

  // PATCH /v1/cards/:id/coach-rate — правка ставки тренера на карте.
  // Разрешено только director/fitness_director и только если по этой карте
  // ещё нет утверждённого (status='paid') payroll-периода, в который
  // попадает дата самой ранней отметки посещаемости. То есть пока зарплата
  // месяца не закрыта — править можно.
  app.patch<{ Params: { id: string }; Body: { coach_rate_per_lesson?: number } }>(
    "/v1/cards/:id/coach-rate",
    { preHandler: [authenticate, requireRole("director", "fitness_director")] },
    async (req, reply) => {
      const rate = Number(req.body?.coach_rate_per_lesson);
      if (!Number.isFinite(rate) || rate < 0) {
        return reply.code(400).send({ error: "validation", message: "coach_rate_per_lesson required" });
      }
      const user = req.user!;
      const cardId = req.params.id;

      const { data: card, error: cErr } = await supabaseAdmin
        .from("club_cards")
        .select("id, child_id, organization_id")
        .eq("id", cardId)
        .maybeSingle();
      if (cErr || !card) return reply.code(404).send({ error: "card_not_found" });
      if (card.organization_id !== user.organization_id) {
        return reply.code(403).send({ error: "card_outside_org" });
      }

      // Если есть выплаченный payroll-период, в который попадает хоть одно
      // present-посещение этого ребёнка по этой карте — править нельзя:
      // зарплата уже закрыта по этой ставке.
      const { data: paidPeriods } = await supabaseAdmin
        .from("payroll_periods")
        .select("period_start, period_end")
        .eq("status", "paid")
        .eq("organization_id", user.organization_id);

      if (paidPeriods && paidPeriods.length > 0) {
        const { data: blocking } = await supabaseAdmin
          .from("attendance")
          .select("lesson:lessons!inner(date)")
          .eq("child_id", card.child_id)
          .eq("status", "present");
        type AttRow = { lesson?: { date?: string } | { date?: string }[] | null };
        const dateOf = (l: AttRow["lesson"]) =>
          Array.isArray(l) ? l[0]?.date : l?.date;
        const dates = ((blocking ?? []) as AttRow[]).map((b) => dateOf(b.lesson)).filter(Boolean) as string[];
        const blocked = dates.some((d) =>
          paidPeriods.some((p) => d >= p.period_start && d <= p.period_end),
        );
        if (blocked) {
          return reply.code(409).send({
            error: "payroll_locked",
            message: "Ставку нельзя менять: зарплата за этот месяц уже утверждена.",
          });
        }
      }

      const { error: uErr } = await supabaseAdmin
        .from("club_cards")
        .update({ coach_rate_per_lesson: rate })
        .eq("id", cardId);
      if (uErr) return reply.code(500).send({ error: "update_failed", message: uErr.message });
      return reply.send({ ok: true, coach_rate_per_lesson: rate });
    },
  );

  // List periods (filter by date range). Director / fitness_director only.
  app.get(
    "/v1/payroll",
    { preHandler: [authenticate, requireRole("director", "fitness_director")] },
    async (req, reply) => {
      const { period_start, period_end } = req.query as { period_start?: string; period_end?: string };
      let q = supabaseAdmin
        .from("payroll_periods")
        .select("*, coach:profiles!coach_id(full_name), approver:profiles!approved_by(full_name)")
        .order("period_start", { ascending: false });
      if (period_start) q = q.gte("period_start", period_start);
      if (period_end) q = q.lte("period_end", period_end);
      const { data, error } = await q;
      if (error) return reply.code(500).send({ error: "list_failed", message: error.message });
      return reply.send({ periods: data ?? [] });
    },
  );

  // Coach reads their own. Computes-on-the-fly if no row exists yet.
  app.get(
    "/v1/payroll/me",
    { preHandler: [authenticate, requireRole("coach")] },
    async (req, reply) => {
      const user = req.user!;
      const { period_start, period_end } = req.query as { period_start?: string; period_end?: string };
      if (!period_start || !period_end) {
        return reply.code(400).send({ error: "period_required" });
      }
      // Look up an existing approved/draft row first
      const { data: existing } = await supabaseAdmin
        .from("payroll_periods")
        .select("*")
        .eq("coach_id", user.id)
        .eq("period_start", period_start)
        .eq("period_end", period_end)
        .maybeSingle();
      if (existing) return reply.send({ period: existing });

      // Else compute on the fly without persisting
      const { data: amount, error } = await supabaseAdmin.rpc("compute_coach_payroll", {
        p_coach: user.id,
        p_from: period_start,
        p_to: period_end,
      });
      if (error) return reply.code(500).send({ error: "compute_failed", message: error.message });
      return reply.send({
        period: {
          coach_id: user.id,
          period_start,
          period_end,
          computed_amount: amount ?? 0,
          manual_adjustment: 0,
          status: "draft" as const,
        },
      });
    },
  );

  // Recompute (or create) period rows for ALL coaches in org, for given range.
  app.post(
    "/v1/payroll/recompute",
    { preHandler: [authenticate, requireRole("director", "fitness_director")] },
    async (req, reply) => {
      const parsed = recomputeSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const { period_start, period_end } = parsed.data;

      const { data: coaches, error: cErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("role", "coach")
        .eq("organization_id", user.organization_id)
        .is("deleted_at", null);
      if (cErr) return reply.code(500).send({ error: "list_coaches_failed", message: cErr.message });

      const results: Array<{ coach_id: string; amount: number }> = [];
      for (const c of coaches ?? []) {
        const { data: amount, error: e1 } = await supabaseAdmin.rpc("compute_coach_payroll", {
          p_coach: c.id,
          p_from: period_start,
          p_to: period_end,
        });
        if (e1) continue;
        // Upsert: keep manual_adjustment from existing row if present.
        const { data: existing } = await supabaseAdmin
          .from("payroll_periods")
          .select("id, manual_adjustment, status")
          .eq("coach_id", c.id)
          .eq("period_start", period_start)
          .eq("period_end", period_end)
          .maybeSingle();
        if (existing) {
          // Don't overwrite paid periods OR rows that already have a manual
          // adjustment (someone deliberately edited the number — recompute
          // would silently destroy that work).
          if (existing.status === "paid") continue;
          if (Number(existing.manual_adjustment ?? 0) !== 0) continue;
          await supabaseAdmin
            .from("payroll_periods")
            .update({ computed_amount: amount ?? 0 })
            .eq("id", existing.id)
            .eq("status", "draft"); // belt-and-braces: never touch advance_paid
        } else {
          await supabaseAdmin.from("payroll_periods").insert({
            organization_id: user.organization_id,
            coach_id: c.id,
            period_start,
            period_end,
            computed_amount: amount ?? 0,
          });
        }
        results.push({ coach_id: c.id, amount: Number(amount ?? 0) });
      }
      return reply.send({ ok: true, count: results.length, results });
    },
  );

  // Adjust a draft/advance period. Reason is mandatory.
  app.post(
    "/v1/payroll/:id/adjust",
    { preHandler: [authenticate, requireRole("director", "fitness_director")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = adjustSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const { error } = await supabaseAdmin
        .from("payroll_periods")
        .update({
          manual_adjustment: parsed.data.manual_adjustment,
          adjustment_reason: parsed.data.adjustment_reason,
          adjusted_by: user.id,
          adjusted_at: new Date().toISOString(),
        })
        .eq("id", id)
        .neq("status", "paid");
      if (error) return reply.code(500).send({ error: "adjust_failed", message: error.message });
      return reply.send({ ok: true });
    },
  );

  // Аванс 20-го числа (ТЗ §10.2): 50% от заработанного с 1-го по 20-е.
  // Сумму считает compute_coach_advance — она же знает день аванса и долю
  // из org_settings, — и мы её сохраняем: раньше статус переключался, а
  // сколько выдано на руки нигде не фиксировалось.
  // Compare-and-swap на status='draft': при одновременном клике двух
  // управляющих выигрывает только один update.
  app.post(
    "/v1/payroll/:id/advance",
    { preHandler: [authenticate, requireRole("director", "fitness_director")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user!;

      const { data: period, error: pErr } = await supabaseAdmin
        .from("payroll_periods")
        .select("id, coach_id, period_start, period_end, status, organization_id")
        .eq("id", id)
        .maybeSingle();
      if (pErr) return reply.code(500).send({ error: "advance_failed", message: pErr.message });
      if (!period) return reply.code(404).send({ error: "period_not_found" });
      if (period.organization_id !== user.organization_id) {
        return reply.code(403).send({ error: "period_outside_org" });
      }

      const { data: amount, error: aErr } = await supabaseAdmin.rpc("compute_coach_advance", {
        p_coach: period.coach_id,
        p_from: period.period_start,
        p_to: period.period_end,
      });
      if (aErr) return reply.code(500).send({ error: "compute_advance_failed", message: aErr.message });

      const { data, error } = await supabaseAdmin
        .from("payroll_periods")
        .update({
          status: "advance_paid",
          advance_amount: Number(amount ?? 0),
          advance_paid_at: new Date().toISOString(),
          advance_paid_by: user.id,
        })
        .eq("id", id)
        .eq("status", "draft")
        .select("id, advance_amount");
      if (error) return reply.code(500).send({ error: "advance_failed", message: error.message });
      if (!data || data.length === 0) {
        return reply.code(409).send({ error: "wrong_status", message: "Already advanced or paid" });
      }
      return reply.send({ ok: true, advance_amount: Number(data[0]!.advance_amount ?? 0) });
    },
  );

  // Final approval — pays the rest. Compare-and-swap: only transitions
  // from 'draft' or 'advance_paid' to 'paid'. Rejects double-approve.
  app.post(
    "/v1/payroll/:id/approve",
    { preHandler: [authenticate, requireRole("director", "fitness_director")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user!;
      const { data, error } = await supabaseAdmin
        .from("payroll_periods")
        .update({
          status: "paid",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id)
        .in("status", ["draft", "advance_paid"])
        .select("id");
      if (error) return reply.code(500).send({ error: "approve_failed", message: error.message });
      if (!data || data.length === 0) {
        return reply.code(409).send({ error: "already_paid" });
      }
      return reply.send({ ok: true });
    },
  );
};
