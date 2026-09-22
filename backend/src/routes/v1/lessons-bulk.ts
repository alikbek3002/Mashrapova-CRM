import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { ensureLessonsForGroup } from "../../lib/lesson-generator.js";
import { lessonsBulkGenerateSchema } from "../../schemas/lessons-bulk.js";

export const lessonsBulkRoutes = async (app: FastifyInstance) => {
  app.post(
    "/v1/lessons/bulk-generate",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      const parsed = lessonsBulkGenerateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const { group_id, from, to } = parsed.data;
      const user = req.user!;

      // Audit context
      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const res = await ensureLessonsForGroup(group_id, from, to, user.id);
      if (!res.ok) {
        if (res.error === "group_not_found") return reply.code(404).send({ error: "group_not_found" });
        if (res.error === "schedule_load_failed") return reply.code(500).send({ error: "schedule_load_failed" });
        req.log.error({ err: res }, "lessons_bulk_insert_failed");
        return reply.code(500).send({ error: res.error, message: res.message });
      }
      if (res.reason === "no_schedule_defined") {
        return reply.code(400).send({ error: "no_schedule_defined" });
      }
      return reply
        .code(res.inserted > 0 ? 201 : 200)
        .send({ ok: true, inserted: res.inserted, ...(res.reason ? { reason: res.reason } : {}) });
    }
  );
};
