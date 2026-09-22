import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { coachCreateSchema } from "../../schemas/coaches.js";
import { normalizeE164KG, phoneToPseudoEmail } from "../../lib/phone.js";

export const coachesRoutes = async (app: FastifyInstance) => {
  app.post(
    "/v1/coaches",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      const parsed = coachCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const input = parsed.data;
      const user = req.user!;

      let e164: string;
      try {
        e164 = normalizeE164KG(input.phone);
      } catch {
        return reply.code(400).send({ error: "phone_invalid_format" });
      }
      const loginEmail = input.email && input.email.trim()
        ? input.email.trim()
        : phoneToPseudoEmail(e164);

      // Уникальность телефона
      // 1) Активный профиль с таким телефоном — явная коллизия.
      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("phone", e164)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing) {
        return reply.code(409).send({ error: "phone_already_exists" });
      }

      // 2) Архивный профиль с тем же телефоном — auth.user не удалён,
      // создать дубликат не получится. Подсказываем восстановить из архива.
      const { data: archived } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, deleted_at")
        .eq("phone", e164)
        .not("deleted_at", "is", null)
        .maybeSingle();
      if (archived) {
        return reply.code(409).send({
          error: "phone_previously_used",
          message: `Тренер с этим телефоном был архивирован (${archived.full_name}). Восстановите его на странице «Архив» или используйте другой телефон.`,
          archived_profile_id: archived.id,
        });
      }

      // Set actor for audit log triggers
      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      // 1. Create auth.users entry
      const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: loginEmail,
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: input.full_name, phone: e164 },
      });

      if (authErr || !created?.user) {
        req.log.error({ err: authErr }, "coach_auth_create_failed");
        if (authErr?.message?.includes("already")) {
          return reply.code(409).send({ error: "email_already_exists" });
        }
        return reply.code(500).send({ error: "auth_create_failed", message: authErr?.message });
      }

      const newUserId = created.user.id;

      // 2. Insert profile
      const { error: profErr } = await supabaseAdmin.from("profiles").insert({
        id: newUserId,
        organization_id: user.organization_id,
        role: "coach",
        full_name: input.full_name,
        phone: e164,
        email: input.email && input.email.trim() ? input.email.trim() : null,
        is_active: true,
      });

      if (profErr) {
        req.log.error({ err: profErr }, "coach_profile_insert_failed");
        // Rollback auth user
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return reply.code(500).send({ error: "profile_insert_failed" });
      }

      // 3. Insert coach record
      const { error: coachErr } = await supabaseAdmin.from("coaches").insert({
        id: newUserId,
        bio: input.bio ?? null,
        achievements: input.achievements ?? null,
        experience_years: input.experience_years ?? 0,
      });

      if (coachErr) {
        req.log.error({ err: coachErr }, "coach_record_insert_failed");
        // Rollback profile + auth
        await supabaseAdmin.from("profiles").delete().eq("id", newUserId);
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return reply.code(500).send({ error: "coach_insert_failed" });
      }

      return reply.code(201).send({ ok: true, coach_id: newUserId, phone: e164 });
    }
  );

  // PATCH /v1/coaches/:id — обновить full_name / email / phone / password.
  // Зеркало PATCH /v1/parents/:id: меняем profiles.* и auth.users.{email,password}.
  const coachUpdateSchema = z.object({
    full_name: z.string().min(1).optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().min(7).optional(),
    password: z.string().min(8).optional(),
  });
  app.patch<{ Params: { id: string } }>(
    "/v1/coaches/:id",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
      ],
    },
    async (req, reply) => {
      const parsed = coachUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const input = parsed.data;
      const user = req.user!;
      const coachId = req.params.id;

      // Убедимся, что это тренер из этой же организации.
      const { data: target, error: tErr } = await supabaseAdmin
        .from("profiles")
        .select("id, role, organization_id, phone, email")
        .eq("id", coachId)
        .maybeSingle();
      if (tErr || !target) {
        return reply.code(404).send({ error: "coach_not_found" });
      }
      if (target.role !== "coach" || target.organization_id !== user.organization_id) {
        return reply.code(403).send({ error: "not_a_coach_in_org" });
      }

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const profilePatch: Record<string, unknown> = {};
      if (input.full_name !== undefined) profilePatch.full_name = input.full_name;

      // phone — нормализуем, проверяем уникальность среди других активных профилей.
      let newE164: string | null = null;
      if (input.phone !== undefined) {
        try {
          newE164 = normalizeE164KG(input.phone);
        } catch {
          return reply.code(400).send({ error: "phone_invalid_format" });
        }
        const { data: existing } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("phone", newE164)
          .neq("id", coachId)
          .is("deleted_at", null)
          .maybeSingle();
        if (existing) {
          return reply.code(409).send({ error: "phone_already_exists" });
        }
        profilePatch.phone = newE164;
      }

      if (input.email !== undefined) {
        profilePatch.email = input.email === null ? null : input.email.trim();
      }

      // auth.users.email — реальный email если задан, иначе pseudo от телефона.
      const authUpdate: { email?: string; password?: string; email_confirm?: boolean } = {};
      if (input.email !== undefined || input.phone !== undefined) {
        const finalEmail = input.email && input.email.trim()
          ? input.email.trim()
          : (newE164 ? phoneToPseudoEmail(newE164)
              : (target.email && target.email.trim()
                  ? target.email.trim()
                  : phoneToPseudoEmail(target.phone!)));
        authUpdate.email = finalEmail;
        authUpdate.email_confirm = true;
      }
      if (input.password !== undefined) {
        authUpdate.password = input.password;
      }

      if (Object.keys(authUpdate).length > 0) {
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(
          coachId,
          authUpdate as never,
        );
        if (authErr) {
          req.log.error({ err: authErr }, "coach_auth_update_failed");
          if (authErr.message?.includes("already")) {
            return reply.code(409).send({ error: "email_already_exists" });
          }
          return reply.code(500).send({ error: "auth_update_failed", message: authErr.message });
        }
      }

      if (Object.keys(profilePatch).length > 0) {
        const { error: pErr } = await supabaseAdmin
          .from("profiles")
          .update(profilePatch)
          .eq("id", coachId);
        if (pErr) {
          req.log.error({ err: pErr }, "coach_profile_update_failed");
          return reply.code(500).send({ error: "profile_update_failed" });
        }
      }

      return reply.send({ ok: true });
    },
  );
};
