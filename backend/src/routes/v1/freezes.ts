import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { freezeCreateSchema } from "../../schemas/freezes.js";

// Загружает базовую инфу о ребёнке: organization, family.parent_user_id,
// responsible_manager_id. Нужно для notifications и проверки manager-scope.
async function loadChildContext(child_id: string) {
  const { data, error } = await supabaseAdmin
    .from("children")
    .select("id, organization_id, responsible_manager_id, family:families(parent_user_id)")
    .eq("id", child_id)
    .maybeSingle();
  if (error || !data) return null;
  const family = Array.isArray((data as any).family) ? (data as any).family[0] : (data as any).family;
  return {
    id: data.id,
    organization_id: data.organization_id as string,
    responsible_manager_id: (data as any).responsible_manager_id as string | null,
    parent_user_id: (family?.parent_user_id ?? null) as string | null,
  };
}

// Может ли пользователь распоряжаться этой заморозкой (одобрять/отклонять/завершать)?
// Все офис-роли с правом заморозок работают по всей базе детей (решение
// директора 08-20: у менеджеров больше нет привязки «только свои дети»).
function canManageFreeze(userRole: string): boolean {
  return ["director", "fitness_director", "senior_manager", "manager"].includes(userRole);
}

// Заморозить можно любой «живой» абонемент. Специально НЕ смотрим на остаток
// занятий: клиент вправе поставить на паузу карту, на которой осталась одна
// тренировка. Отсекаем только архив — там замораживать нечего.
const FREEZABLE_CARD_STATUSES = ["active", "ending", "frozen", "debt", "expired"];

export const freezesRoutes = async (app: FastifyInstance) => {
  // POST /v1/freezes — создать заявку. Доступно coach, parent и всем
  // staff-ролям. Статус по умолчанию: pending (для coach/parent/manager),
  // approved (для director/fitness_director/senior_manager — они «сразу
  // ставят» заморозку).
  app.post(
    "/v1/freezes",
    {
      preHandler: [
        authenticate,
        // ТЗ §4.3: заморозку ставит менеджер ИЛИ тренер (через своё
        // приложение). Тренеру вернули доступ миграцией 20260926000005 —
        // в движке Uniqum его отключали по решению того клиента.
        // Родитель по-прежнему не ставит: в ТЗ его среди инициаторов нет.
        requireRole("director", "fitness_director", "senior_manager", "manager", "coach"),
      ],
    },
    async (req, reply) => {
      const parsed = freezeCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const child = await loadChildContext(parsed.data.child_id);
      if (!child) return reply.code(404).send({ error: "child_not_found" });

      // parent может только своему — проверка через family.
      if (user.role === "parent" && child.parent_user_id !== user.id) {
        return reply.code(403).send({ error: "not_your_child" });
      }

      // Карта должна существовать и принадлежать этому ребёнку — иначе
      // триггер применит продление к чужому абонементу.
      const { data: card } = await supabaseAdmin
        .from("club_cards")
        .select("id, child_id, status, start_date, end_date")
        .eq("id", parsed.data.club_card_id)
        .maybeSingle();
      if (!card) return reply.code(404).send({ error: "card_not_found" });
      if (card.child_id !== parsed.data.child_id) {
        return reply.code(400).send({
          error: "card_child_mismatch",
          message: "Абонемент принадлежит другому ребёнку",
        });
      }
      if (!FREEZABLE_CARD_STATUSES.includes(card.status)) {
        return reply.code(409).send({
          error: "card_not_freezable",
          message: `Абонемент в статусе «${card.status}» нельзя заморозить`,
        });
      }

      // Пересечение с уже одобренной заморозкой этой же карты: иначе
      // абонемент продлевается дважды за один и тот же период.
      const { data: overlapping } = await supabaseAdmin
        .from("freezes")
        .select("id, start_date, end_date")
        .eq("club_card_id", parsed.data.club_card_id)
        .eq("status", "approved")
        .lte("start_date", parsed.data.end_date)
        .gte("end_date", parsed.data.start_date)
        .limit(1);
      if (overlapping && overlapping.length > 0) {
        return reply.code(409).send({
          error: "freeze_overlaps_existing",
          message: `На этот абонемент уже есть заморозка ${overlapping[0]!.start_date} — ${overlapping[0]!.end_date}`,
        });
      }

      // Кто авто-апрувит: только старшие роли. Остальные → pending.
      const autoApprove = ["director", "fitness_director", "senior_manager"].includes(user.role);
      const status = autoApprove ? "approved" : "pending";
      // initiator_role хранит только 'coach' | 'manager' (legacy enum).
      // parent инициатор → пишем 'coach' (ближе по смыслу: «не staff»),
      // т.к. enum старый. TODO: расширить enum в отдельной миграции.
      const initiator_role = user.role === "coach" || user.role === "parent" ? "coach" : "manager";

      const { data: freeze, error } = await supabaseAdmin
        .from("freezes")
        .insert({
          child_id: parsed.data.child_id,
          club_card_id: parsed.data.club_card_id,
          initiated_by: user.id,
          initiator_role,
          reason: parsed.data.reason,
          start_date: parsed.data.start_date,
          end_date: parsed.data.end_date,
          status,
          approved_by: autoApprove ? user.id : null,
          approved_at: autoApprove ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (error || !freeze) {
        // ТЗ §4.3: число заморозок ограничено типом абонемента.
        // Проверку делает триггер check_freeze_quota — правило одно для
        // всех путей создания (офис через API, тренер через RLS).
        if (error?.message?.includes("freeze_quota_exceeded")) {
          return reply.code(409).send({
            error: "freeze_quota_exceeded",
            message: "Лимит заморозок по этому абонементу исчерпан — он зависит от типа абонемента.",
          });
        }
        req.log.error({ err: error }, "freeze_insert_failed");
        // Гонка: параллельный approve мог создать пересечение уже после
        // нашей проверки — тогда сработает триггер trg_freezes_aa_no_overlap.
        if (error?.message?.includes("freeze_overlaps_existing")) {
          return reply.code(409).send({
            error: "freeze_overlaps_existing",
            message: "На этот абонемент уже есть заморозка на пересекающийся период",
          });
        }
        return reply.code(500).send({ error: "freeze_insert_failed", message: error?.message });
      }

      // Notification fan-out для pending: уведомляем director/fitness_director/senior_manager
      // + ответственного менеджера ребёнка (если он есть и manager-роль).
      if (status === "pending") {
        const recipientSet = new Set<string>();
        const { data: seniors } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("organization_id", user.organization_id)
          .in("role", ["director", "fitness_director", "senior_manager"])
          .eq("is_active", true);
        for (const s of seniors ?? []) recipientSet.add(s.id);
        if (child.responsible_manager_id) recipientSet.add(child.responsible_manager_id);

        if (recipientSet.size > 0) {
          await supabaseAdmin.from("notifications").insert(
            Array.from(recipientSet).map((rid) => ({
              recipient_id: rid,
              type: "freeze.pending",
              payload: {
                freeze_id: freeze.id,
                child_id: parsed.data.child_id,
                start_date: parsed.data.start_date,
                end_date: parsed.data.end_date,
                reason: parsed.data.reason,
              },
            }))
          );
        }
      } else if (status === "approved" && child.parent_user_id) {
        // Auto-approved старшей ролью — родитель сразу узнаёт.
        await supabaseAdmin.from("notifications").insert({
          recipient_id: child.parent_user_id,
          type: "freeze.approved",
          payload: {
            freeze_id: freeze.id,
            child_id: parsed.data.child_id,
            start_date: parsed.data.start_date,
            end_date: parsed.data.end_date,
          },
        });
      }

      return reply.code(201).send({ ok: true, freeze_id: freeze.id, status });
    }
  );

  // POST /v1/freezes/:id/approve — теперь доступно ещё и manager'у,
  // если ребёнок этой заявки закреплён за ним. Можно опционально
  // прислать start_date/end_date в body, чтобы скорректировать перед
  // одобрением (родитель мог указать неточно).
  app.post<{ Params: { id: string }; Body?: { start_date?: string; end_date?: string } }>(
    "/v1/freezes/:id/approve",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
      ],
    },
    async (req, reply) => {
      const { id } = req.params;
      const user = req.user!;

      const { data: freeze, error: fErr } = await supabaseAdmin
        .from("freezes")
        .select("id, child_id, club_card_id, status, start_date, end_date")
        .eq("id", id)
        .maybeSingle();
      if (fErr || !freeze) return reply.code(404).send({ error: "freeze_not_found" });
      if (freeze.status !== "pending") {
        return reply.code(409).send({ error: "not_pending", message: "Freeze is not in pending state" });
      }

      const child = await loadChildContext(freeze.child_id);
      if (!child) return reply.code(404).send({ error: "child_not_found" });
      if (!canManageFreeze(user.role)) {
        return reply.code(403).send({ error: "forbidden", message: "Manager can approve only freezes of own children" });
      }

      // Опциональная корректировка дат.
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      const newStart = req.body?.start_date && dateRegex.test(req.body.start_date) ? req.body.start_date : null;
      const newEnd = req.body?.end_date && dateRegex.test(req.body.end_date) ? req.body.end_date : null;
      if (newStart && newEnd && newEnd < newStart) {
        return reply.code(400).send({ error: "bad_dates", message: "end_date must be >= start_date" });
      }

      const patch: Record<string, unknown> = {
        status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      };
      if (newStart) patch.start_date = newStart;
      if (newEnd) patch.end_date = newEnd;

      // Одобрение = применение эффекта к карте, поэтому пересечение с уже
      // действующей заморозкой проверяем здесь так же, как при создании.
      const effStart = newStart ?? freeze.start_date;
      const effEnd = newEnd ?? freeze.end_date;
      const { data: overlapping } = await supabaseAdmin
        .from("freezes")
        .select("id, start_date, end_date")
        .eq("club_card_id", freeze.club_card_id)
        .eq("status", "approved")
        .neq("id", id)
        .lte("start_date", effEnd)
        .gte("end_date", effStart)
        .limit(1);
      if (overlapping && overlapping.length > 0) {
        return reply.code(409).send({
          error: "freeze_overlaps_existing",
          message: `На этот абонемент уже есть заморозка ${overlapping[0]!.start_date} — ${overlapping[0]!.end_date}`,
        });
      }

      const { error } = await supabaseAdmin
        .from("freezes")
        .update(patch)
        .eq("id", id)
        .eq("status", "pending");
      if (error) {
        if (error.message?.includes("freeze_overlaps_existing")) {
          return reply.code(409).send({
            error: "freeze_overlaps_existing",
            message: "На этот абонемент уже есть заморозка на пересекающийся период",
          });
        }
        return reply.code(500).send({ error: "approve_failed", message: error.message });
      }

      // Уведомление родителю.
      if (child.parent_user_id) {
        await supabaseAdmin.from("notifications").insert({
          recipient_id: child.parent_user_id,
          type: "freeze.approved",
          payload: {
            freeze_id: id,
            child_id: child.id,
            start_date: newStart ?? freeze.start_date,
            end_date: newEnd ?? freeze.end_date,
          },
        });
      }

      return reply.send({ ok: true });
    }
  );

  app.post<{ Params: { id: string }; Body?: { reason?: string } }>(
    "/v1/freezes/:id/reject",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
      ],
    },
    async (req, reply) => {
      const { id } = req.params;
      const user = req.user!;

      const { data: freeze } = await supabaseAdmin
        .from("freezes")
        .select("id, child_id, status, start_date, end_date")
        .eq("id", id)
        .maybeSingle();
      if (!freeze) return reply.code(404).send({ error: "freeze_not_found" });
      if (freeze.status !== "pending") {
        return reply.code(409).send({ error: "not_pending" });
      }

      const child = await loadChildContext(freeze.child_id);
      if (!child) return reply.code(404).send({ error: "child_not_found" });
      if (!canManageFreeze(user.role)) {
        return reply.code(403).send({ error: "forbidden" });
      }

      const { error } = await supabaseAdmin
        .from("freezes")
        .update({ status: "rejected", rejected_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending");
      if (error) return reply.code(500).send({ error: "reject_failed", message: error.message });

      // Уведомление родителю об отказе.
      if (child.parent_user_id) {
        await supabaseAdmin.from("notifications").insert({
          recipient_id: child.parent_user_id,
          type: "freeze.rejected",
          payload: {
            freeze_id: id,
            child_id: child.id,
            start_date: freeze.start_date,
            end_date: freeze.end_date,
            reason: req.body?.reason ?? null,
          },
        });
      }

      return reply.send({ ok: true });
    }
  );

  // Досрочное завершение активной заморозки. Те же права, что approve/reject.
  app.post<{ Params: { id: string } }>(
    "/v1/freezes/:id/end",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
      ],
    },
    async (req, reply) => {
      const { id } = req.params;
      const user = req.user!;

      const { data: freeze } = await supabaseAdmin
        .from("freezes")
        .select("id, child_id, status")
        .eq("id", id)
        .maybeSingle();
      if (!freeze) return reply.code(404).send({ error: "freeze_not_found" });
      if (freeze.status !== "approved") {
        return reply.code(409).send({ error: "not_active" });
      }

      const child = await loadChildContext(freeze.child_id);
      if (!child) return reply.code(404).send({ error: "child_not_found" });
      if (!canManageFreeze(user.role)) {
        return reply.code(403).send({ error: "forbidden" });
      }

      await supabaseAdmin.rpc("set_config", { setting_name: "app.actor_id", new_value: user.id, is_local: true } as never);
      const { error } = await supabaseAdmin
        .from("freezes")
        .update({ status: "rejected", rejected_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "approved");
      if (error) return reply.code(500).send({ error: "end_failed", message: error.message });
      return reply.send({ ok: true });
    }
  );
};
