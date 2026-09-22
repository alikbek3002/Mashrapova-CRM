import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { requireIdempotencyKey, storeIdempotencyResponse } from "../../middleware/idempotency.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import {
  depositTopUpSchema,
  depositWithdrawSchema,
  depositChargeSchema,
  depositAdjustmentSchema,
} from "../../schemas/deposits.js";

type RpcResult = { tx_id: string; balance_after: number } | null;

const extractRow = (data: unknown): RpcResult => {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as RpcResult) ?? null;
  return data as RpcResult;
};

const isInsufficientError = (msg: string | undefined): boolean =>
  !!msg && msg.includes("deposit_insufficient");

// Повтор запроса в узком окне гонки (RPC прошёл, но HTTP-ответ не дошёл и
// idempotency_keys не записался) → unique violation на idempotency_key.
// Это значит операция УЖЕ выполнена предыдущим запросом (RPC атомарен, при
// частичном сбое всё откатилось бы и ключ не записался). Трактуем как успех.
const isDuplicateKey = (err: { code?: string; message?: string }): boolean =>
  err.code === "23505" || !!err.message?.includes("duplicate key");

export const depositsRoutes = async (app: FastifyInstance) => {
  // POST /v1/deposits/topup — пополнение нал/терминалом
  app.post(
    "/v1/deposits/topup",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager", "cashier"),
        requireIdempotencyKey,
      ],
    },
    async (req, reply) => {
      const parsed = depositTopUpSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const key = req.idempotencyKey!;

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const { data, error } = await supabaseAdmin.rpc("record_deposit_topup", {
        p_organization_id: user.organization_id,
        p_child_id: parsed.data.child_id,
        p_received_by: user.id,
        p_amount: parsed.data.amount,
        p_method: parsed.data.method,
        p_comment: parsed.data.comment ?? null,
        p_idempotency_key: key,
      });
      if (error) {
        if (isDuplicateKey(error)) return reply.code(200).send({ ok: true, duplicate: true });
        req.log.error({ err: error }, "deposit_topup_failed");
        return reply.code(500).send({ error: "topup_failed", message: error.message });
      }
      const row = extractRow(data);
      if (!row) return reply.code(500).send({ error: "topup_failed" });

      const response = { ok: true, tx_id: row.tx_id, balance_after: Number(row.balance_after) };
      await storeIdempotencyResponse(key, "/v1/deposits/topup", user.id, response);
      return reply.code(201).send(response);
    }
  );

  // POST /v1/deposits/withdraw — возврат депозита наличными родителю.
  // С 2026-09-10 доступен и менеджерам (просьба офиса): кто вернул — в журнале.
  app.post(
    "/v1/deposits/withdraw",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
        requireIdempotencyKey,
      ],
    },
    async (req, reply) => {
      const parsed = depositWithdrawSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const key = req.idempotencyKey!;

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const { data, error } = await supabaseAdmin.rpc("record_deposit_withdraw", {
        p_organization_id: user.organization_id,
        p_child_id: parsed.data.child_id,
        p_received_by: user.id,
        p_amount: parsed.data.amount,
        p_comment: parsed.data.comment,
        p_idempotency_key: key,
      });
      if (error) {
        if (isDuplicateKey(error)) return reply.code(200).send({ ok: true, duplicate: true });
        if (isInsufficientError(error.message)) {
          return reply.code(422).send({
            error: "deposit_insufficient",
            message: "На депозите недостаточно средств",
          });
        }
        req.log.error({ err: error }, "deposit_withdraw_failed");
        return reply.code(500).send({ error: "withdraw_failed", message: error.message });
      }
      const row = extractRow(data);
      if (!row) return reply.code(500).send({ error: "withdraw_failed" });

      const response = { ok: true, tx_id: row.tx_id, balance_after: Number(row.balance_after) };
      await storeIdempotencyResponse(key, "/v1/deposits/withdraw", user.id, response);
      return reply.code(201).send(response);
    }
  );

  // POST /v1/deposits/charge — разовое списание (без записи в payments)
  app.post(
    "/v1/deposits/charge",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager", "cashier"),
        requireIdempotencyKey,
      ],
    },
    async (req, reply) => {
      const parsed = depositChargeSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const key = req.idempotencyKey!;

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const { data, error } = await supabaseAdmin.rpc("record_deposit_charge", {
        p_organization_id: user.organization_id,
        p_child_id: parsed.data.child_id,
        p_received_by: user.id,
        p_amount: parsed.data.amount,
        p_comment: parsed.data.comment,
        p_idempotency_key: key,
      });
      if (error) {
        if (isDuplicateKey(error)) return reply.code(200).send({ ok: true, duplicate: true });
        if (isInsufficientError(error.message)) {
          return reply.code(422).send({
            error: "deposit_insufficient",
            message: "На депозите недостаточно средств",
          });
        }
        req.log.error({ err: error }, "deposit_charge_failed");
        return reply.code(500).send({ error: "charge_failed", message: error.message });
      }
      const row = extractRow(data);
      if (!row) return reply.code(500).send({ error: "charge_failed" });

      const response = { ok: true, tx_id: row.tx_id, balance_after: Number(row.balance_after) };
      await storeIdempotencyResponse(key, "/v1/deposits/charge", user.id, response);
      return reply.code(201).send(response);
    }
  );

  // POST /v1/deposits/adjustment — ручная корректировка (только директор)
  app.post(
    "/v1/deposits/adjustment",
    {
      preHandler: [authenticate, requireRole("director"), requireIdempotencyKey],
    },
    async (req, reply) => {
      const parsed = depositAdjustmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const key = req.idempotencyKey!;

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const { data, error } = await supabaseAdmin.rpc("record_deposit_adjustment", {
        p_organization_id: user.organization_id,
        p_child_id: parsed.data.child_id,
        p_received_by: user.id,
        p_amount: parsed.data.amount,
        p_reason: parsed.data.reason,
        p_idempotency_key: key,
      });
      if (error) {
        if (isDuplicateKey(error)) return reply.code(200).send({ ok: true, duplicate: true });
        if (isInsufficientError(error.message)) {
          return reply.code(422).send({
            error: "deposit_insufficient",
            message: "Корректировка ушла бы в минус — баланс не позволяет",
          });
        }
        req.log.error({ err: error }, "deposit_adjustment_failed");
        return reply.code(500).send({ error: "adjustment_failed", message: error.message });
      }
      const row = extractRow(data);
      if (!row) return reply.code(500).send({ error: "adjustment_failed" });

      const response = { ok: true, tx_id: row.tx_id, balance_after: Number(row.balance_after) };
      await storeIdempotencyResponse(key, "/v1/deposits/adjustment", user.id, response);
      return reply.code(201).send(response);
    }
  );
};
