import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";

export const notificationsRoutes = async (app: FastifyInstance) => {
  app.get("/v1/notifications", { preHandler: [authenticate] }, async (req, reply) => {
    const user = req.user!;
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("recipient_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return reply.code(500).send({ error: "fetch_failed" });
    return reply.send({ items: data ?? [] });
  });

  app.post(
    "/v1/notifications/:id/read",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user!;
      const { error } = await supabaseAdmin
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id)
        .eq("recipient_id", user.id);
      if (error) return reply.code(500).send({ error: "mark_read_failed" });
      return reply.send({ ok: true });
    }
  );
};
