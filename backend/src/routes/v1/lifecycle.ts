import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";

// POST /v1/lifecycle/refresh — call refresh_lifecycle() in Postgres.
// Use this from a Railway/Vercel cron (e.g. once an hour) when pg_cron
// is not available. Idempotent: safe to call any number of times.
//
// Restricted to office staff so it can also be triggered manually
// from the admin UI ("Force refresh statuses" button) — not exposed
// to coach/parent roles.
export const lifecycleRoutes = async (app: FastifyInstance) => {
  app.post(
    "/v1/lifecycle/refresh",
    {
      preHandler: [
        authenticate,
        // Не для кассира — это операция управления статусами (карты/заморозки),
        // не входит в круг обязанностей.
        requireRole("director", "fitness_director", "senior_manager", "manager"),
      ],
    },
    async (req, reply) => {
      const { error } = await supabaseAdmin.rpc("refresh_lifecycle");
      if (error) {
        req.log.error({ err: error }, "lifecycle_refresh_failed");
        return reply.code(500).send({ error: "refresh_failed", message: error.message });
      }
      return reply.send({ ok: true });
    },
  );
};
