import type { FastifyRequest, FastifyReply } from "fastify";
import { supabaseAdmin } from "../lib/supabase.js";

const HEADER = "idempotency-key";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module "fastify" {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

export const requireIdempotencyKey = async (req: FastifyRequest, reply: FastifyReply) => {
  const key = req.headers[HEADER];
  if (typeof key !== "string" || !UUID_RE.test(key)) {
    return reply.code(400).send({ error: "missing_or_invalid_idempotency_key" });
  }

  const { data: existing } = await supabaseAdmin
    .from("idempotency_keys")
    .select("response")
    .eq("key", key)
    .maybeSingle();

  if (existing?.response) {
    return reply.code(200).send(existing.response);
  }

  req.idempotencyKey = key;
};

export const storeIdempotencyResponse = async (
  key: string,
  endpoint: string,
  userId: string | null,
  response: unknown
) => {
  await supabaseAdmin.from("idempotency_keys").insert({
    key,
    endpoint,
    user_id: userId,
    response,
  });
};
