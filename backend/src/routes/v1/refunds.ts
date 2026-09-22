import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { requireIdempotencyKey, storeIdempotencyResponse } from "../../middleware/idempotency.js";
import { supabaseAdmin } from "../../lib/supabase.js";

const refundCreateSchema = z.object({
  club_card_id: z.string().uuid(),
  kind: z.enum(["with_30pct", "full_no_fee"]),
  reason: z.string().min(1, "Reason required"),
});

const FULL_REFUND_ROLES: Array<"director" | "fitness_director" | "senior_manager"> = [
  "director", "fitness_director", "senior_manager",
];

export const refundsRoutes = async (app: FastifyInstance) => {
  app.get(
    "/v1/refunds",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager", "cashier")] },
    async (req, reply) => {
      const { card_id } = req.query as { card_id?: string };
      let q = supabaseAdmin
        .from("refunds")
        .select("*, child:children(full_name), processor:profiles!processed_by(full_name)")
        .order("processed_at", { ascending: false });
      if (card_id) q = q.eq("club_card_id", card_id);
      const { data, error } = await q;
      if (error) return reply.code(500).send({ error: "list_failed", message: error.message });
      return reply.send({ refunds: data ?? [] });
    },
  );

  // Create a refund. Backend computes amount + fee per ТЗ formula:
  //   refund = (remaining/total) * card_price - 30% (if kind=with_30pct)
  //   refund = (remaining/total) * card_price       (if kind=full_no_fee)
  // full_no_fee additionally requires director / fitness_director / senior_manager.
  //
  // Возврат идёт АВТОМАТОМ на депозит ребёнка (deposit_transactions.type=refund_in).
  // Для отчётов сохраняется компенсирующий payment с отрицательной суммой
  // (revenue нетто остаётся корректным).
  app.post(
    "/v1/refunds",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
        requireIdempotencyKey,
      ],
    },
    async (req, reply) => {
      const parsed = refundCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const key = req.idempotencyKey!;
      const { club_card_id, kind, reason } = parsed.data;

      if (kind === "full_no_fee" && !FULL_REFUND_ROLES.includes(user.role as never)) {
        return reply.code(403).send({ error: "full_refund_forbidden" });
      }

      // Pull card info (price + lessons left).
      const { data: card, error: cErr } = await supabaseAdmin
        .from("club_cards")
        .select("id, child_id, price_paid, total_lessons, organization_id")
        .eq("id", club_card_id)
        .single();
      if (cErr || !card) return reply.code(404).send({ error: "card_not_found" });

      // Authoritative remaining-lessons source — v_child_card_balance.remaining
      // (counts present+late+makeup, accounts for approved freezes).
      const { data: bal } = await supabaseAdmin
        .from("v_child_card_balance")
        .select("remaining")
        .eq("club_card_id", club_card_id)
        .maybeSingle();
      const remaining = Number(bal?.remaining ?? card.total_lessons ?? 0);
      const total = Number(card.total_lessons ?? 0) || 1;
      const price = Number(card.price_paid ?? 0);
      const baseRefund = total > 0 ? (remaining / total) * price : 0;
      const fee = kind === "with_30pct" ? baseRefund * 0.3 : 0;
      const refundAmount = Math.max(0, Math.round((baseRefund - fee) * 100) / 100);
      const feeAmount = Math.round(fee * 100) / 100;

      // Подтянуть метод оригинального платежа — для согласованности отчётов по cash/terminal.
      const { data: origPayment } = await supabaseAdmin
        .from("payments")
        .select("method")
        .eq("club_card_id", club_card_id)
        .gt("amount", 0)
        .order("paid_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const method = (origPayment?.method as "cash" | "terminal") ?? "cash";

      // Атомарно: refund + payment(-amount) + deposit_tx(+amount) + archive card.
      const { data, error: rpcErr } = await supabaseAdmin.rpc("create_refund_with_deposit", {
        p_organization_id: card.organization_id,
        p_club_card_id: club_card_id,
        p_child_id: card.child_id,
        p_kind: kind,
        p_remaining_lessons: remaining,
        p_total_lessons: total,
        p_card_price: price,
        p_refund_amount: refundAmount,
        p_fee_amount: feeAmount,
        p_reason: reason,
        p_processed_by: user.id,
        p_payment_method: method,
        p_idempotency_key: key,
      });
      if (rpcErr) {
        // Повтор в окне гонки: deposit_transactions.idempotency_key уже занят →
        // вся RPC-транзакция откатывается, возврат уже был оформлен ранее.
        if (rpcErr.code === "23505" || rpcErr.message?.includes("duplicate key")) {
          return reply.code(200).send({ ok: true, duplicate: true });
        }
        req.log.error({ err: rpcErr }, "refund_create_failed");
        return reply.code(500).send({ error: "refund_create_failed", message: rpcErr.message });
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { refund_id: string; deposit_tx_id: string | null; balance_after: number | null }
        | null;
      if (!row) {
        return reply.code(500).send({ error: "refund_create_failed" });
      }

      const response = {
        ok: true,
        refund_id: row.refund_id,
        refund_amount: refundAmount,
        fee_amount: feeAmount,
        balance_after: row.balance_after != null ? Number(row.balance_after) : null,
      };
      await storeIdempotencyResponse(key, "/v1/refunds", user.id, response);
      return reply.code(201).send(response);
    },
  );
};
