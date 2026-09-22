import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { requireIdempotencyKey, storeIdempotencyResponse } from "../../middleware/idempotency.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { paymentCreateSchema } from "../../schemas/payments.js";
import { z } from "zod";

const methodPatchSchema = z.object({
  method: z.enum(["cash", "terminal"]),
  reason: z.string().max(300).nullable().optional(),
});
const METHOD_LABEL: Record<"cash" | "terminal", string> = { cash: "нал", terminal: "терминал" };

export const paymentsRoutes = async (app: FastifyInstance) => {
  app.post(
    "/v1/payments",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager", "cashier"),
        requireIdempotencyKey,
      ],
    },
    async (req, reply) => {
      const parsed = paymentCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const input = parsed.data;
      const user = req.user!;
      const key = req.idempotencyKey!;

      // Атомарно: payment (если amount > 0) + deposit_tx (если use_deposit > 0).
      // RPC возвращает ошибку deposit_insufficient если не хватает на депозите.
      const { data, error } = await supabaseAdmin.rpc("record_payment_with_deposit", {
        p_organization_id: user.organization_id,
        p_child_id: input.child_id,
        p_received_by: user.id,
        p_club_card_id: input.club_card_id ?? null,
        p_amount: input.amount,
        p_method: input.method,
        p_use_deposit: input.use_deposit,
        p_comment: input.comment ?? null,
        p_idempotency_key: key,
      });

      if (error) {
        const msg = error.message ?? "";
        if (error.code === "23505" || msg.includes("duplicate key")) {
          return reply.code(200).send({ ok: true, duplicate: true });
        }
        if (msg.includes("deposit_insufficient")) {
          return reply.code(422).send({
            error: "deposit_insufficient",
            message: "На депозите недостаточно средств",
          });
        }
        req.log.error({ err: error }, "payment_insert_failed");
        return reply.code(500).send({ error: "payment_insert_failed", message: msg });
      }

      const row = (Array.isArray(data) ? data[0] : data) as {
        payment_id: string | null;
        deposit_tx_id: string | null;
        balance_after: number | null;
      } | null;

      const response = {
        ok: true,
        payment_id: row?.payment_id ?? null,
        deposit_tx_id: row?.deposit_tx_id ?? null,
        balance_after: row?.balance_after != null ? Number(row.balance_after) : null,
      };
      await storeIdempotencyResponse(key, "/v1/payments", user.id, response);
      return reply.code(201).send(response);
    }
  );
  // Сверка по кассе: исправить способ оплаты (нал ↔ терминал), если при
  // приёме выбрали не то (запрос офиса 2026-09-02). Сумма, дата и
  // получатель не трогаются. Факт правки дописывается в комментарий
  // платежа (виден в списках) и попадает в audit_log триггером.
  app.patch(
    "/v1/payments/:id/method",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "cashier")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send({ error: "validation" });
      const parsed = methodPatchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const user = req.user!;
      await supabaseAdmin.rpc("set_config", { setting_name: "app.actor_id", new_value: user.id, is_local: true } as never);

      const { data: pay, error: pErr } = await supabaseAdmin
        .from("payments")
        .select("id, method, comment")
        .eq("id", id)
        .maybeSingle();
      if (pErr || !pay) return reply.code(404).send({ error: "payment_not_found" });
      const from = pay.method as "cash" | "terminal";
      const to = parsed.data.method;
      if (from === to) return reply.code(200).send({ ok: true, unchanged: true });

      const { data: me } = await supabaseAdmin.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      const stamp = new Date().toLocaleDateString("ru-RU", { timeZone: "Asia/Bishkek" });
      const note = `[${METHOD_LABEL[from]}→${METHOD_LABEL[to]} · ${me?.full_name ?? user.email ?? "офис"} · ${stamp}${parsed.data.reason ? ` · ${parsed.data.reason}` : ""}]`;
      const base = (pay.comment ?? "").trim();
      // Колонка без лимита, но держим комментарий читаемым.
      const comment = (base ? `${base} ${note}` : note).slice(0, 500);

      const { error: uErr } = await supabaseAdmin
        .from("payments")
        .update({ method: to, comment })
        .eq("id", id);
      if (uErr) return reply.code(500).send({ error: "update_failed", message: uErr.message });
      req.log.info({ payment_id: id, from, to }, "payment_method_corrected");
      return reply.code(200).send({ ok: true });
    }
  );
};
