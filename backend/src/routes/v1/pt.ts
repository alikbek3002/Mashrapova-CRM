import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, requireRole, type AppRole } from "../../middleware/auth.js";
import { requireIdempotencyKey, storeIdempotencyResponse } from "../../middleware/idempotency.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import {
  ptServiceSchema,
  ptServicePatchSchema,
  ptCoachRatesSchema,
  ptSellSchema,
  ptPaySchema,
  ptBlockSchema,
  ptExtendSchema,
  ptRefundSchema,
  ptChangeCoachSchema,
  ptAddParticipantSchema,
  ptBookSchema,
  ptSessionPatchSchema,
  ptCompleteSchema,
  ptCancelSchema,
  ptRescheduleSchema,
  ptSubstituteSchema,
  ptLessonStatusSchema,
  ptEntryExitSchema,
  ptCommentSchema,
} from "../../schemas/pt.js";

// §19: роли. «Администратор» = офисные роли, «руководитель» = директор/фитнес-директор.
const PT_NOMENCLATURE: AppRole[] = ["director", "fitness_director", "senior_manager"];
const PT_ADMIN: AppRole[] = ["director", "fitness_director", "senior_manager", "manager"];
const PT_SELL: AppRole[] = ["director", "fitness_director", "senior_manager", "manager", "cashier"];
const PT_BOOK: AppRole[] = [...PT_ADMIN, "coach"];

const setActor = async (userId: string) => {
  await supabaseAdmin.rpc("set_config", {
    setting_name: "app.actor_id",
    new_value: userId,
    is_local: true,
  } as never);
};

const rpcErrorReply = (reply: FastifyReply, msg: string) => {
  const known: Record<string, { code: number; message: string }> = {
    pt_service_not_found: { code: 404, message: "Услуга не найдена" },
    pt_service_inactive: { code: 409, message: "Услуга отключена" },
    pt_package_not_found: { code: 404, message: "Пакет не найден" },
    pt_session_not_found: { code: 404, message: "Тренировка не найдена" },
    pt_lesson_not_found: { code: 404, message: "Посещение не найдено" },
    pt_group_not_found: { code: 404, message: "Мини-группа не найдена" },
    pt_no_items: { code: 400, message: "Не выбраны участники" },
    pt_personal_one_child: { code: 400, message: "Персональная тренировка — только один клиент" },
    pt_over_capacity: { code: 409, message: "Превышен размер мини-группы" },
    pt_overpayment: { code: 400, message: "Сумма оплаты превышает стоимость пакета" },
    pt_zero_payment: { code: 400, message: "Сумма оплаты должна быть больше 0" },
    pt_debt_comment_required: {
      code: 422,
      message: "Продажа в долг возможна только с обязательным комментарием",
    },
    pt_group_already_started: {
      code: 409,
      message: "Тренировки в группе уже начались — добавлять участников нельзя",
    },
    pt_not_fully_paid: { code: 422, message: "Запись возможна только при полной оплате пакета" },
    pt_package_not_bookable: { code: 409, message: "Пакет недоступен для записи" },
    pt_previous_package_active: {
      code: 409,
      message: "Сначала нужно завершить предыдущий активный пакет",
    },
    pt_package_exhausted: { code: 409, message: "В пакете не осталось тренировок" },
    pt_package_expires_before_date: {
      code: 409,
      message: "Срок действия пакета истекает раньше выбранной даты",
    },
    pt_mixed_groups: { code: 400, message: "Все участники должны быть из одной мини-группы" },
    pt_coach_busy: { code: 409, message: "У тренера уже есть тренировка в это время" },
    pt_session_not_scheduled: { code: 409, message: "Тренировка уже проведена или отменена" },
    pt_session_not_substitutable: { code: 409, message: "Замена для этой тренировки недоступна" },
    pt_bad_attendance_status: { code: 400, message: "Неверный статус посещения" },
    pt_reason_required: { code: 422, message: "Причина обязательна" },
    pt_not_refundable: { code: 409, message: "По правилам услуги возврат запрещён" },
    pt_bad_refund_kind: { code: 400, message: "Неверный тип возврата" },
    pt_refund_amount_invalid: { code: 400, message: "Неверная сумма возврата" },
    pt_package_closed: { code: 409, message: "Пакет возвращён или аннулирован" },
  };
  for (const key of Object.keys(known)) {
    if (msg.includes(key)) {
      return reply.code(known[key]!.code).send({ error: key, message: known[key]!.message });
    }
  }
  return reply.code(500).send({ error: "pt_failed", message: msg });
};

const validationReply = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "validation", issues });

// дата+время тренировки → Date
const sessionStart = (date: string, time: string) => new Date(`${date}T${time.length === 5 ? time + ":00" : time}`);

type SessionRow = {
  id: string;
  organization_id: string;
  coach_id: string;
  actual_coach_id: string | null;
  service_id: string;
  date: string;
  start_time: string;
  duration_min: number;
  status: string;
};

type ServiceLimits = {
  reschedule_limit_hours: number;
  cancel_limit_hours: number;
  coach_edit_limit_hours: number;
  mark_deadline_hours: number;
};

const loadSessionWithService = async (
  sessionId: string
): Promise<{ session: SessionRow; limits: ServiceLimits } | null> => {
  const { data } = await supabaseAdmin
    .from("pt_sessions")
    .select(
      "id, organization_id, coach_id, actual_coach_id, service_id, date, start_time, duration_min, status, service:pt_services(reschedule_limit_hours, cancel_limit_hours, coach_edit_limit_hours, mark_deadline_hours)"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) return null;
  const raw = data as unknown as SessionRow & { service: ServiceLimits | ServiceLimits[] };
  const limits = Array.isArray(raw.service) ? raw.service[0]! : raw.service;
  return { session: raw, limits };
};

const hoursUntilStart = (s: SessionRow) =>
  (sessionStart(s.date, s.start_time).getTime() - Date.now()) / 3_600_000;

const hoursSinceEnd = (s: SessionRow) =>
  (Date.now() - (sessionStart(s.date, s.start_time).getTime() + s.duration_min * 60_000)) / 3_600_000;

export const ptRoutes = async (app: FastifyInstance) => {
  // =========================================================
  // НОМЕНКЛАТУРА УСЛУГ (§2)
  // =========================================================
  app.post(
    "/v1/pt/services",
    { preHandler: [authenticate, requireRole(...PT_NOMENCLATURE)] },
    async (req, reply) => {
      const parsed = ptServiceSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const { data, error } = await supabaseAdmin
        .from("pt_services")
        .insert({ organization_id: user.organization_id, ...parsed.data })
        .select()
        .single();
      if (error || !data) {
        return reply.code(500).send({ error: "pt_service_create_failed", message: error?.message });
      }
      return reply.code(201).send({ ok: true, service: data });
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/v1/pt/services/:id",
    { preHandler: [authenticate, requireRole(...PT_NOMENCLATURE)] },
    async (req, reply) => {
      const parsed = ptServicePatchSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const { data, error } = await supabaseAdmin
        .from("pt_services")
        .update(parsed.data)
        .eq("id", req.params.id)
        .eq("organization_id", user.organization_id)
        .select()
        .single();
      if (error || !data) {
        return reply.code(500).send({ error: "pt_service_update_failed", message: error?.message });
      }
      return reply.send({ ok: true, service: data });
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/pt/services/:id",
    { preHandler: [authenticate, requireRole(...PT_NOMENCLATURE)] },
    async (req, reply) => {
      const user = req.user!;
      await setActor(user.id);
      const { error } = await supabaseAdmin
        .from("pt_services")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", req.params.id)
        .eq("organization_id", user.organization_id);
      if (error) return reply.code(500).send({ error: "pt_service_delete_failed", message: error.message });
      return reply.send({ ok: true });
    }
  );

  // стоимость / процент по каждому тренеру
  app.put<{ Params: { id: string } }>(
    "/v1/pt/services/:id/coach-rates",
    { preHandler: [authenticate, requireRole(...PT_NOMENCLATURE)] },
    async (req, reply) => {
      const parsed = ptCoachRatesSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const serviceId = req.params.id;
      const { error: delErr } = await supabaseAdmin
        .from("pt_service_coach_rates")
        .delete()
        .eq("service_id", serviceId);
      if (delErr) return reply.code(500).send({ error: "pt_rates_failed", message: delErr.message });
      if (parsed.data.rates.length > 0) {
        const { error } = await supabaseAdmin.from("pt_service_coach_rates").insert(
          parsed.data.rates.map((r) => ({
            organization_id: user.organization_id,
            service_id: serviceId,
            coach_id: r.coach_id,
            price: r.price ?? null,
            percent: r.percent ?? null,
          }))
        );
        if (error) return reply.code(500).send({ error: "pt_rates_failed", message: error.message });
      }
      return reply.send({ ok: true });
    }
  );

  // =========================================================
  // ПРОДАЖА ПАКЕТОВ (§3, §8, §10 — долг)
  // =========================================================
  app.post(
    "/v1/pt/packages/sell",
    { preHandler: [authenticate, requireRole(...PT_SELL), requireIdempotencyKey] },
    async (req, reply) => {
      const parsed = ptSellSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      const key = req.idempotencyKey!;
      await setActor(user.id);
      const { data, error } = await supabaseAdmin.rpc("pt_sell_packages", {
        p_organization_id: user.organization_id,
        p_sold_by: user.id,
        p_service_id: parsed.data.service_id,
        p_coach_id: parsed.data.coach_id,
        p_items: parsed.data.items,
        p_payment_method: parsed.data.payment_method,
        p_group_name: parsed.data.group_name ?? null,
        p_idempotency_key: key,
      });
      if (error) {
        if (error.code === "23505" || (error.message ?? "").includes("duplicate key")) {
          return reply.code(200).send({ ok: true, duplicate: true });
        }
        return rpcErrorReply(reply, error.message ?? "");
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { group_id: string | null; package_ids: string[] }
        | null;
      const response = { ok: true, group_id: row?.group_id ?? null, package_ids: row?.package_ids ?? [] };
      await storeIdempotencyResponse(key, "/v1/pt/packages/sell", user.id, response);
      return reply.code(201).send(response);
    }
  );

  // доплата (§8: оплата каждого участника)
  app.post<{ Params: { id: string } }>(
    "/v1/pt/packages/:id/pay",
    { preHandler: [authenticate, requireRole(...PT_SELL), requireIdempotencyKey] },
    async (req, reply) => {
      const parsed = ptPaySchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      const key = req.idempotencyKey!;
      await setActor(user.id);
      const { error } = await supabaseAdmin.rpc("pt_record_payment", {
        p_organization_id: user.organization_id,
        p_package_id: req.params.id,
        p_received_by: user.id,
        p_amount: parsed.data.amount,
        p_use_deposit: parsed.data.use_deposit,
        p_method: parsed.data.method,
        p_comment: parsed.data.comment ?? null,
        p_idempotency_key: key,
      });
      if (error) {
        if (error.code === "23505") return reply.code(200).send({ ok: true, duplicate: true });
        return rpcErrorReply(reply, error.message ?? "");
      }
      const response = { ok: true };
      await storeIdempotencyResponse(key, `/v1/pt/packages/${req.params.id}/pay`, user.id, response);
      return reply.code(201).send(response);
    }
  );

  // ручная активация (§3)
  app.post<{ Params: { id: string } }>(
    "/v1/pt/packages/:id/activate",
    { preHandler: [authenticate, requireRole(...PT_ADMIN)] },
    async (req, reply) => {
      const user = req.user!;
      await setActor(user.id);
      const { error } = await supabaseAdmin.rpc("pt_activate_package_internal", {
        p_package_id: req.params.id,
        p_on_date: new Date().toISOString().slice(0, 10),
        p_by: user.id,
        p_kind: "manual",
      });
      if (error) return rpcErrorReply(reply, error.message ?? "");
      return reply.send({ ok: true });
    }
  );

  // блокировка / разблокировка (§21)
  app.post<{ Params: { id: string } }>(
    "/v1/pt/packages/:id/block",
    { preHandler: [authenticate, requireRole(...PT_ADMIN)] },
    async (req, reply) => {
      const parsed = ptBlockSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const { data: pkg } = await supabaseAdmin
        .from("pt_packages")
        .select("id, status, service:pt_services(blockable)")
        .eq("id", req.params.id)
        .eq("organization_id", user.organization_id)
        .maybeSingle();
      if (!pkg) return reply.code(404).send({ error: "pt_package_not_found" });
      const rawSvc = (pkg as unknown as { service: { blockable: boolean } | { blockable: boolean }[] }).service;
      const svc = Array.isArray(rawSvc) ? rawSvc[0] : rawSvc;
      if (!svc?.blockable) {
        return reply.code(409).send({ error: "pt_not_blockable", message: "По правилам услуги блокировка запрещена" });
      }
      if (!["purchased", "awaiting_activation", "active"].includes((pkg as { status: string }).status)) {
        return reply.code(409).send({ error: "pt_package_closed", message: "Пакет уже в финальном статусе" });
      }
      const { error } = await supabaseAdmin
        .from("pt_packages")
        .update({
          status: "blocked",
          blocked_at: new Date().toISOString(),
          blocked_by: user.id,
          block_reason: parsed.data.reason,
        })
        .eq("id", req.params.id);
      if (error) return reply.code(500).send({ error: "pt_block_failed", message: error.message });
      return reply.send({ ok: true });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/v1/pt/packages/:id/unblock",
    { preHandler: [authenticate, requireRole(...PT_ADMIN)] },
    async (req, reply) => {
      const user = req.user!;
      await setActor(user.id);
      const { data: pkg } = await supabaseAdmin
        .from("pt_packages")
        .select("id, status, activated_at, paid, price")
        .eq("id", req.params.id)
        .eq("organization_id", user.organization_id)
        .maybeSingle();
      if (!pkg) return reply.code(404).send({ error: "pt_package_not_found" });
      if (pkg.status !== "blocked") {
        return reply.code(409).send({ error: "pt_not_blocked", message: "Пакет не заблокирован" });
      }
      const next = pkg.activated_at
        ? "active"
        : Number(pkg.paid) >= Number(pkg.price)
          ? "awaiting_activation"
          : "purchased";
      const { error } = await supabaseAdmin
        .from("pt_packages")
        .update({ status: next, blocked_at: null, blocked_by: null, block_reason: null })
        .eq("id", req.params.id);
      if (error) return reply.code(500).send({ error: "pt_unblock_failed", message: error.message });
      return reply.send({ ok: true });
    }
  );

  // продление / сокращение срока (§10)
  app.post<{ Params: { id: string } }>(
    "/v1/pt/packages/:id/extend",
    { preHandler: [authenticate, requireRole(...PT_ADMIN)] },
    async (req, reply) => {
      const parsed = ptExtendSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const patch: Record<string, unknown> = { expires_at: parsed.data.new_expires_at };
      if (parsed.data.comment) patch.comment = parsed.data.comment;
      const { data, error } = await supabaseAdmin
        .from("pt_packages")
        .update(patch)
        .eq("id", req.params.id)
        .eq("organization_id", user.organization_id)
        .select("id, status, expires_at")
        .single();
      if (error || !data) return reply.code(500).send({ error: "pt_extend_failed", message: error?.message });
      // продление истёкшего возвращает его в работу
      if (data.status === "expired" && data.expires_at && data.expires_at >= new Date().toISOString().slice(0, 10)) {
        await supabaseAdmin.from("pt_packages").update({ status: "active" }).eq("id", data.id);
      }
      return reply.send({ ok: true });
    }
  );

  // аннулирование (§3)
  app.post<{ Params: { id: string } }>(
    "/v1/pt/packages/:id/annul",
    { preHandler: [authenticate, requireRole(...PT_NOMENCLATURE)] },
    async (req, reply) => {
      const parsed = ptBlockSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const { error } = await supabaseAdmin
        .from("pt_packages")
        .update({
          status: "annulled",
          annulled_at: new Date().toISOString(),
          annulled_by: user.id,
          annul_reason: parsed.data.reason,
        })
        .eq("id", req.params.id)
        .eq("organization_id", user.organization_id)
        .in("status", ["purchased", "awaiting_activation", "active", "blocked", "expired"]);
      if (error) return reply.code(500).send({ error: "pt_annul_failed", message: error.message });
      return reply.send({ ok: true });
    }
  );

  // возврат: частичный / полный (§21)
  app.post<{ Params: { id: string } }>(
    "/v1/pt/packages/:id/refund",
    { preHandler: [authenticate, requireRole(...PT_NOMENCLATURE), requireIdempotencyKey] },
    async (req, reply) => {
      const parsed = ptRefundSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      const key = req.idempotencyKey!;
      await setActor(user.id);
      const { error } = await supabaseAdmin.rpc("pt_refund_package", {
        p_package_id: req.params.id,
        p_by: user.id,
        p_kind: parsed.data.kind,
        p_amount: parsed.data.amount,
        p_reason: parsed.data.reason,
        p_to_deposit: parsed.data.to_deposit,
        p_method: parsed.data.method,
        p_idempotency_key: key,
      });
      if (error) {
        if (error.code === "23505") return reply.code(200).send({ ok: true, duplicate: true });
        return rpcErrorReply(reply, error.message ?? "");
      }
      const response = { ok: true };
      await storeIdempotencyResponse(key, `/v1/pt/packages/${req.params.id}/refund`, user.id, response);
      return reply.code(201).send(response);
    }
  );

  // смена закреплённого тренера (§1)
  app.post<{ Params: { id: string } }>(
    "/v1/pt/packages/:id/change-coach",
    { preHandler: [authenticate, requireRole(...PT_ADMIN)] },
    async (req, reply) => {
      const parsed = ptChangeCoachSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const { error } = await supabaseAdmin
        .from("pt_packages")
        .update({ coach_id: parsed.data.coach_id })
        .eq("id", req.params.id)
        .eq("organization_id", user.organization_id);
      if (error) return reply.code(500).send({ error: "pt_change_coach_failed", message: error.message });
      // будущие запланированные сессии этого пакета переводим на нового тренера
      const { data: lessons } = await supabaseAdmin
        .from("pt_lessons")
        .select("session_id")
        .eq("package_id", req.params.id)
        .eq("status", "scheduled");
      const sessionIds = Array.from(new Set((lessons ?? []).map((l) => l.session_id)));
      if (sessionIds.length > 0) {
        await supabaseAdmin
          .from("pt_sessions")
          .update({ coach_id: parsed.data.coach_id })
          .in("id", sessionIds)
          .eq("status", "scheduled")
          .gte("date", new Date().toISOString().slice(0, 10));
      }
      return reply.send({ ok: true });
    }
  );

  // добавление участника в мини-группу (запрещено после старта, §8)
  app.post<{ Params: { id: string } }>(
    "/v1/pt/groups/:id/add-participant",
    { preHandler: [authenticate, requireRole(...PT_SELL)] },
    async (req, reply) => {
      const parsed = ptAddParticipantSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const { data, error } = await supabaseAdmin.rpc("pt_add_group_participant", {
        p_organization_id: user.organization_id,
        p_group_id: req.params.id,
        p_sold_by: user.id,
        p_child_id: parsed.data.child_id,
        p_price: parsed.data.price,
        p_pay_cash: parsed.data.pay_cash,
        p_pay_deposit: parsed.data.pay_deposit,
        p_in_debt: parsed.data.in_debt,
        p_debt_comment: parsed.data.debt_comment ?? null,
        p_payment_method: parsed.data.payment_method,
      });
      if (error) return rpcErrorReply(reply, error.message ?? "");
      return reply.code(201).send({ ok: true, package_id: data });
    }
  );

  // =========================================================
  // ЗАПИСЬ (§5, §18, §19)
  // =========================================================
  app.post(
    "/v1/pt/sessions",
    { preHandler: [authenticate, requireRole(...PT_BOOK)] },
    async (req, reply) => {
      const parsed = ptBookSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      const isCoach = user.role === "coach";
      // тренер записывает только к себе
      if (isCoach && parsed.data.coach_id !== user.id) {
        return reply.code(403).send({ error: "forbidden", message: "Тренер записывает только к себе" });
      }
      await setActor(user.id);
      const { data, error } = await supabaseAdmin.rpc("pt_book_session", {
        p_organization_id: user.organization_id,
        p_created_by: user.id,
        p_actor_is_coach: isCoach,
        p_service_id: parsed.data.service_id,
        p_coach_id: parsed.data.coach_id,
        p_date: parsed.data.date,
        p_start_time: parsed.data.start_time,
        p_duration_min: parsed.data.duration_min ?? null,
        p_package_ids: parsed.data.package_ids,
        p_comment: parsed.data.comment ?? null,
      });
      if (error) return rpcErrorReply(reply, error.message ?? "");
      return reply.code(201).send({ ok: true, session_id: data });
    }
  );

  // изменение записи (§10, §19: тренер — до установленного времени)
  app.patch<{ Params: { id: string } }>(
    "/v1/pt/sessions/:id",
    { preHandler: [authenticate, requireRole(...PT_BOOK)] },
    async (req, reply) => {
      const parsed = ptSessionPatchSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      const loaded = await loadSessionWithService(req.params.id);
      if (!loaded || loaded.session.organization_id !== user.organization_id) {
        return reply.code(404).send({ error: "pt_session_not_found" });
      }
      if (loaded.session.status !== "scheduled") {
        return reply.code(409).send({ error: "pt_session_not_scheduled", message: "Изменить можно только запланированную тренировку" });
      }
      if (user.role === "coach") {
        if (loaded.session.coach_id !== user.id) {
          return reply.code(403).send({ error: "forbidden" });
        }
        if (hoursUntilStart(loaded.session) < loaded.limits.coach_edit_limit_hours) {
          return reply.code(409).send({
            error: "pt_edit_window_closed",
            message: `Изменение записи доступно не позднее чем за ${loaded.limits.coach_edit_limit_hours} ч до начала`,
          });
        }
      }
      await setActor(user.id);
      const { error } = await supabaseAdmin
        .from("pt_sessions")
        .update(parsed.data)
        .eq("id", req.params.id);
      if (error) return reply.code(500).send({ error: "pt_session_update_failed", message: error.message });
      return reply.send({ ok: true });
    }
  );

  // =========================================================
  // ПРОВЕДЕНИЕ (§6) — тренер / админ
  // =========================================================
  app.post<{ Params: { id: string } }>(
    "/v1/pt/sessions/:id/complete",
    { preHandler: [authenticate, requireRole(...PT_BOOK)] },
    async (req, reply) => {
      const parsed = ptCompleteSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      const loaded = await loadSessionWithService(req.params.id);
      if (!loaded || loaded.session.organization_id !== user.organization_id) {
        return reply.code(404).send({ error: "pt_session_not_found" });
      }
      let source = parsed.data.source;
      let actualCoach = parsed.data.actual_coach_id ?? null;
      let subComment = parsed.data.substitution_comment ?? null;
      if (user.role === "coach") {
        if (loaded.session.coach_id !== user.id && loaded.session.actual_coach_id !== user.id) {
          return reply.code(403).send({ error: "forbidden" });
        }
        // §19: отметка проведения — до установленного времени (регламент в номенклатуре)
        if (hoursSinceEnd(loaded.session) > loaded.limits.mark_deadline_hours) {
          return reply.code(409).send({
            error: "pt_mark_window_closed",
            message: `Окно отметки (${loaded.limits.mark_deadline_hours} ч после тренировки) закрыто — обратитесь к администратору`,
          });
        }
        if (hoursUntilStart(loaded.session) > 0) {
          return reply.code(409).send({ error: "pt_too_early", message: "Тренировка ещё не началась" });
        }
        source = "coach";
        // замену оформляет администратор/руководитель (§15)
        actualCoach = null;
        subComment = null;
      }
      await setActor(user.id);
      const { error } = await supabaseAdmin.rpc("pt_complete_session", {
        p_session_id: req.params.id,
        p_completed_by: user.id,
        p_source: source,
        p_attendance: parsed.data.attendance,
        p_actual_coach_id: actualCoach,
        p_substitution_comment: subComment,
      });
      if (error) return rpcErrorReply(reply, error.message ?? "");
      return reply.send({ ok: true });
    }
  );

  // =========================================================
  // ОТМЕНА / ПЕРЕНОС (§9)
  // =========================================================
  app.post<{ Params: { id: string } }>(
    "/v1/pt/sessions/:id/cancel",
    { preHandler: [authenticate, requireRole(...PT_BOOK)] },
    async (req, reply) => {
      const parsed = ptCancelSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      const loaded = await loadSessionWithService(req.params.id);
      if (!loaded || loaded.session.organization_id !== user.organization_id) {
        return reply.code(404).send({ error: "pt_session_not_found" });
      }
      let charge = parsed.data.charge;
      if (user.role === "coach") {
        if (loaded.session.coach_id !== user.id) return reply.code(403).send({ error: "forbidden" });
        if (hoursUntilStart(loaded.session) < loaded.limits.cancel_limit_hours) {
          return reply.code(409).send({
            error: "pt_cancel_window_closed",
            message: `Отмена доступна не позднее чем за ${loaded.limits.cancel_limit_hours} ч — обратитесь к администратору`,
          });
        }
        charge = false; // списание при отмене решает только администрация
      }
      await setActor(user.id);
      const { error } = await supabaseAdmin.rpc("pt_cancel_session", {
        p_session_id: req.params.id,
        p_cancelled_by: user.id,
        p_reason: parsed.data.reason,
        p_charge: charge,
      });
      if (error) return rpcErrorReply(reply, error.message ?? "");
      return reply.send({ ok: true });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/v1/pt/sessions/:id/reschedule",
    { preHandler: [authenticate, requireRole(...PT_BOOK)] },
    async (req, reply) => {
      const parsed = ptRescheduleSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      const loaded = await loadSessionWithService(req.params.id);
      if (!loaded || loaded.session.organization_id !== user.organization_id) {
        return reply.code(404).send({ error: "pt_session_not_found" });
      }
      if (user.role === "coach") {
        if (loaded.session.coach_id !== user.id) return reply.code(403).send({ error: "forbidden" });
        if (hoursUntilStart(loaded.session) < loaded.limits.reschedule_limit_hours) {
          return reply.code(409).send({
            error: "pt_reschedule_window_closed",
            message: `Перенос доступен не позднее чем за ${loaded.limits.reschedule_limit_hours} ч — обратитесь к администратору`,
          });
        }
      }
      await setActor(user.id);
      const { data, error } = await supabaseAdmin.rpc("pt_reschedule_session", {
        p_session_id: req.params.id,
        p_by: user.id,
        p_new_date: parsed.data.new_date,
        p_new_time: parsed.data.new_time,
        p_reason: parsed.data.reason,
      });
      if (error) return rpcErrorReply(reply, error.message ?? "");
      return reply.send({ ok: true, new_session_id: data });
    }
  );

  // =========================================================
  // ЗАМЕНА ТРЕНЕРА (§15) — администратор / руководитель
  // =========================================================
  app.post<{ Params: { id: string } }>(
    "/v1/pt/sessions/:id/substitute",
    { preHandler: [authenticate, requireRole(...PT_ADMIN)] },
    async (req, reply) => {
      const parsed = ptSubstituteSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const { error } = await supabaseAdmin.rpc("pt_set_substitution", {
        p_session_id: req.params.id,
        p_actual_coach_id: parsed.data.actual_coach_id,
        p_by: user.id,
        p_comment: parsed.data.comment ?? null,
      });
      if (error) return rpcErrorReply(reply, error.message ?? "");
      return reply.send({ ok: true });
    }
  );

  // =========================================================
  // РУЧНЫЕ КОРРЕКТИРОВКИ ПОСЕЩЕНИЙ (§10)
  // =========================================================
  app.post<{ Params: { id: string } }>(
    "/v1/pt/lessons/:id/set-status",
    { preHandler: [authenticate, requireRole(...PT_ADMIN)] },
    async (req, reply) => {
      const parsed = ptLessonStatusSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const { error } = await supabaseAdmin.rpc("pt_set_lesson_status", {
        p_lesson_id: req.params.id,
        p_new_status: parsed.data.status,
        p_charge: parsed.data.charge,
        p_actor: user.id,
        p_reason: parsed.data.reason ?? null,
      });
      if (error) return rpcErrorReply(reply, error.message ?? "");
      return reply.send({ ok: true });
    }
  );

  // время входа/выхода — администратор (§1, §6)
  app.post<{ Params: { id: string } }>(
    "/v1/pt/lessons/:id/entry-exit",
    { preHandler: [authenticate, requireRole(...PT_ADMIN)] },
    async (req, reply) => {
      const parsed = ptEntryExitSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const patch: Record<string, unknown> = {};
      if (parsed.data.entry_time !== undefined) patch.entry_time = parsed.data.entry_time;
      if (parsed.data.exit_time !== undefined) patch.exit_time = parsed.data.exit_time;
      const { error } = await supabaseAdmin
        .from("pt_lessons")
        .update(patch)
        .eq("id", req.params.id)
        .eq("organization_id", user.organization_id);
      if (error) return reply.code(500).send({ error: "pt_entry_exit_failed", message: error.message });
      return reply.send({ ok: true });
    }
  );

  // =========================================================
  // КОММЕНТАРИИ ТРЕНЕРА каждые 10 тренировок (§16)
  // =========================================================
  app.post(
    "/v1/pt/comments",
    { preHandler: [authenticate, requireRole("coach", ...PT_ADMIN)] },
    async (req, reply) => {
      const parsed = ptCommentSchema.safeParse(req.body);
      if (!parsed.success) return validationReply(reply, parsed.error.flatten());
      const user = req.user!;
      await setActor(user.id);
      const { data: pkg } = await supabaseAdmin
        .from("pt_packages")
        .select("id, child_id, coach_id, organization_id")
        .eq("id", parsed.data.package_id)
        .maybeSingle();
      if (!pkg || pkg.organization_id !== user.organization_id) {
        return reply.code(404).send({ error: "pt_package_not_found" });
      }
      if (user.role === "coach" && pkg.coach_id !== user.id) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const { error } = await supabaseAdmin.from("pt_coach_comments").insert({
        organization_id: user.organization_id,
        package_id: pkg.id,
        child_id: pkg.child_id,
        coach_id: user.role === "coach" ? user.id : pkg.coach_id,
        milestone: parsed.data.milestone,
        text: parsed.data.text,
      });
      if (error) {
        if (error.code === "23505") {
          return reply.code(409).send({ error: "pt_comment_exists", message: "Комментарий за этот этап уже сохранён" });
        }
        return reply.code(500).send({ error: "pt_comment_failed", message: error.message });
      }
      return reply.code(201).send({ ok: true });
    }
  );

  // незаполненные комментарии тренера (требование системы, §16)
  app.get(
    "/v1/pt/comments/pending",
    { preHandler: [authenticate, requireRole("coach", ...PT_ADMIN)] },
    async (req, reply) => {
      const user = req.user!;
      let query = supabaseAdmin
        .from("pt_packages")
        .select("id, child_id, coach_id, lessons_used, lessons_total, status, child:children(full_name), service:pt_services(name)")
        .eq("organization_id", user.organization_id)
        .gte("lessons_used", 10);
      if (user.role === "coach") query = query.eq("coach_id", user.id);
      const { data: pkgs, error } = await query;
      if (error) return reply.code(500).send({ error: "pt_pending_failed", message: error.message });
      const ids = (pkgs ?? []).map((p) => p.id);
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: comments } = await supabaseAdmin
          .from("pt_coach_comments")
          .select("package_id")
          .in("package_id", ids);
        for (const c of comments ?? []) {
          counts.set(c.package_id, (counts.get(c.package_id) ?? 0) + 1);
        }
      }
      const items = (pkgs ?? [])
        .map((p) => {
          const due = Math.floor(Number(p.lessons_used) / 10);
          const have = counts.get(p.id) ?? 0;
          return { ...p, comments_due: due, comments_have: have, next_milestone: (have + 1) * 10 };
        })
        .filter((p) => p.comments_have < p.comments_due);
      return reply.send({ items });
    }
  );

  // =========================================================
  // ЗАРПЛАТА ПТ (§12, §20)
  // =========================================================
  app.get<{ Querystring: { from?: string; to?: string; coach_id?: string } }>(
    "/v1/pt/payroll",
    { preHandler: [authenticate, requireRole(...PT_ADMIN, "cashier")] },
    async (req, reply) => {
      const user = req.user!;
      const now = new Date();
      const from = req.query.from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const to = req.query.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      let coachQuery = supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .eq("organization_id", user.organization_id)
        .eq("role", "coach")
        .is("deleted_at", null);
      if (req.query.coach_id) coachQuery = coachQuery.eq("id", req.query.coach_id);
      const { data: coaches, error } = await coachQuery;
      if (error) return reply.code(500).send({ error: "pt_payroll_failed", message: error.message });
      const items = [];
      for (const c of coaches ?? []) {
        const { data } = await supabaseAdmin.rpc("compute_pt_coach_payroll", {
          p_coach: c.id,
          p_from: from,
          p_to: to,
        });
        const row = (Array.isArray(data) ? data[0] : data) ?? {};
        items.push({ coach_id: c.id, coach_name: c.full_name, ...row });
      }
      return reply.send({ from, to, items });
    }
  );

  // личная зарплата тренера по ПТ
  app.get<{ Querystring: { from?: string; to?: string } }>(
    "/v1/pt/payroll/me",
    { preHandler: [authenticate, requireRole("coach")] },
    async (req, reply) => {
      const user = req.user!;
      const now = new Date();
      const from = req.query.from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const to = req.query.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const { data, error } = await supabaseAdmin.rpc("compute_pt_coach_payroll", {
        p_coach: user.id,
        p_from: from,
        p_to: to,
      });
      if (error) return reply.code(500).send({ error: "pt_payroll_failed", message: error.message });
      const row = (Array.isArray(data) ? data[0] : data) ?? {};
      return reply.send({ from, to, ...row });
    }
  );

  // =========================================================
  // ОТЧЁТЫ (§13)
  // =========================================================
  app.get<{ Querystring: { from?: string; to?: string } }>(
    "/v1/pt/reports/summary",
    { preHandler: [authenticate, requireRole(...PT_ADMIN, "cashier")] },
    async (req, reply) => {
      const user = req.user!;
      const now = new Date();
      const from = req.query.from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const to = req.query.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

      const base = () =>
        supabaseAdmin
          .from("pt_sessions")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", user.organization_id)
          .gte("date", from)
          .lte("date", to);

      const [completed, cancelled, rescheduled] = await Promise.all([
        base().eq("status", "completed"),
        base().eq("status", "cancelled"),
        base().eq("status", "rescheduled"),
      ]);

      const { data: payroll } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("organization_id", user.organization_id)
        .eq("role", "coach")
        .is("deleted_at", null);
      let accruals = 0;
      for (const c of payroll ?? []) {
        const { data } = await supabaseAdmin.rpc("compute_pt_coach_payroll", {
          p_coach: c.id,
          p_from: from,
          p_to: to,
        });
        const row = (Array.isArray(data) ? data[0] : data) as { total_amount?: number } | null;
        accruals += Number(row?.total_amount ?? 0);
      }

      return reply.send({
        from,
        to,
        completed_sessions: completed.count ?? 0,
        cancelled_sessions: cancelled.count ?? 0,
        rescheduled_sessions: rescheduled.count ?? 0,
        coach_accruals: Math.round(accruals * 100) / 100,
      });
    }
  );
};
