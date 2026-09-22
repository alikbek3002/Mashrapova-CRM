import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";

const rateCreateSchema = z.object({
  coach_id: z.string().uuid(),
  group_id: z.string().uuid(),
  rate_per_kid: z.number().nonnegative(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  comment: z.string().optional().nullable(),
});

export const coachRatesRoutes = async (app: FastifyInstance) => {
  // List rates (current + history). Optional filter by coach/group.
  app.get(
    "/v1/coach-rates",
    { preHandler: [authenticate, requireRole("director", "fitness_director")] },
    async (req, reply) => {
      const { coach_id, group_id } = req.query as { coach_id?: string; group_id?: string };
      let q = supabaseAdmin
        .from("coach_rates")
        .select("*, coach:profiles!coach_id(full_name), group:groups(name, section_id)")
        .order("effective_from", { ascending: false });
      if (coach_id) q = q.eq("coach_id", coach_id);
      if (group_id) q = q.eq("group_id", group_id);
      const { data, error } = await q;
      if (error) return reply.code(500).send({ error: "list_failed", message: error.message });
      return reply.send({ rates: data ?? [] });
    },
  );

  // Create a new rate. Closes the previous active rate
  // (sets effective_to = new.effective_from - 1) so history is contiguous.
  app.post(
    "/v1/coach-rates",
    { preHandler: [authenticate, requireRole("director", "fitness_director")] },
    async (req, reply) => {
      const parsed = rateCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const { coach_id, group_id, rate_per_kid, effective_from, comment } = parsed.data;

      // Close any open (effective_to is null) rate for the same coach+group.
      const closeDate = new Date(effective_from);
      closeDate.setDate(closeDate.getDate() - 1);
      const closeStr = closeDate.toISOString().slice(0, 10);

      await supabaseAdmin
        .from("coach_rates")
        .update({ effective_to: closeStr })
        .eq("coach_id", coach_id)
        .eq("group_id", group_id)
        .is("effective_to", null);

      const { data, error } = await supabaseAdmin
        .from("coach_rates")
        .insert({
          organization_id: user.organization_id,
          coach_id,
          group_id,
          rate_per_kid,
          effective_from,
          comment: comment ?? null,
          set_by: user.id,
        })
        .select()
        .single();
      if (error || !data) return reply.code(500).send({ error: "create_failed", message: error?.message });
      return reply.code(201).send({ ok: true, rate: data });
    },
  );
};
