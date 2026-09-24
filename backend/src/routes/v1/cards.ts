import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { requireIdempotencyKey, storeIdempotencyResponse } from "../../middleware/idempotency.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { ensureLessonsForGroup } from "../../lib/lesson-generator.js";
import { cardSellSchema } from "../../schemas/cards.js";

type SellRpcResult = {
  card_id: string;
  applied_discount: number;
  applied_discount_pct: number;
  discount_reason: string | null;
  enrollment_id: string | null;
};

export const cardsRoutes = async (app: FastifyInstance) => {
  app.post(
    "/v1/cards/sell",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
        requireIdempotencyKey,
      ],
    },
    async (req, reply) => {
      const parsed = cardSellSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const input = parsed.data;
      const user = req.user!;
      const key = req.idempotencyKey!;

      // Set actor for audit log triggers.
      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      // Атомарно: club_card + опц. deposit_tx + опц. payment + опц. enrollment.
      // RPC сам проверяет, что нет active/ending карты у ребёнка (P0001),
      // считает скидку по % + auto sibling (из org_settings), и через
      // триггер на deposit_transactions ловит deposit_insufficient.
      const { data, error } = await supabaseAdmin.rpc("sell_card_with_deposit", {
        p_organization_id: user.organization_id,
        p_child_id: input.child_id,
        p_received_by: user.id,
        p_type: input.type,
        p_total_lessons: input.total_lessons ?? null,
        p_freeze_quota: input.freeze_quota,
        p_price: input.price,
        p_discount_pct: input.discount_pct,
        p_start_date: input.start_date,
        p_end_date: input.end_date,
        p_section_id: input.section_id ?? null,
        p_group_id: input.group_id ?? null,
        p_payment_method: input.payment_method,
        p_deposit_amount: input.deposit_amount,
        p_cash_amount: input.cash_amount,
        p_idempotency_key: key,
        p_enrollment_start_date: input.enrollment_start_date ?? null,
        p_enrollment_end_date: input.enrollment_end_date ?? null,
        p_coach_rate_per_lesson: input.coach_rate_per_lesson,
        p_plan_id: input.plan_id ?? null,
        p_duration_days: input.duration_days ?? null,
        p_discount_reason: input.discount_reason ?? null,
      });

      if (error) {
        const msg = error.message ?? "";
        // Повтор в окне гонки (idempotency_key уже записан) → продажа уже прошла.
        if (error.code === "23505" || msg.includes("duplicate key")) {
          return reply.code(200).send({ ok: true, duplicate: true });
        }
        if (msg.includes("active_card_exists")) {
          return reply.code(409).send({
            error: "active_card_exists",
            message: "У ребёнка уже есть активный абонемент. Закройте его перед продажей нового.",
          });
        }
        if (msg.includes("discount_reason_required")) {
          return reply.code(422).send({
            error: "discount_reason_required",
            message: "Укажите причину скидки — этого требует регламент (ТЗ §3.3).",
          });
        }
        if (msg.includes("deposit_insufficient")) {
          return reply.code(422).send({
            error: "deposit_insufficient",
            message: "На депозите недостаточно средств для оплаты выбранной суммой",
          });
        }
        req.log.error({ err: error }, "sell_card_failed");
        return reply.code(500).send({ error: "card_insert_failed", message: msg });
      }

      const row = (Array.isArray(data) ? data[0] : data) as SellRpcResult | null;
      if (!row) {
        return reply.code(500).send({ error: "card_insert_failed" });
      }

      // Догенерировать занятия группы под окно записи: иначе при окне
      // дальше сгенерированного горизонта ребёнок «записан» только на
      // существующие уроки. Ошибка генерации продажу не откатывает.
      if (input.group_id && input.enrollment_start_date && input.enrollment_end_date) {
        const gen = await ensureLessonsForGroup(
          input.group_id,
          input.enrollment_start_date,
          input.enrollment_end_date,
          user.id,
        );
        if (!gen.ok) req.log.warn({ err: gen }, "sell_lessons_generate_failed");
        else if (gen.inserted > 0) req.log.info({ inserted: gen.inserted }, "sell_lessons_generated");
      }

      const response = {
        ok: true,
        card_id: row.card_id,
        applied_discount: Number(row.applied_discount),
        applied_discount_pct: Number(row.applied_discount_pct),
        discount_reason: row.discount_reason,
        enrollment_id: row.enrollment_id,
      };
      await storeIdempotencyResponse(key, "/v1/cards/sell", user.id, response);
      return reply.code(201).send(response);
    }
  );
};
