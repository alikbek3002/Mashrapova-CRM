import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { normalizeE164KG, phoneToPseudoEmail } from "../../lib/phone.js";

// Creates a new parent auth account (auth.users + profiles row with role=parent)
// and either attaches it to an existing family (via family_id) or creates a new
// family on the fly (via family fields). The parent_user_id of the family gets
// set to the new user.
//
// Логин: телефон (обязательно) + пароль. email опционален; если не указан,
// для auth.users используется pseudo-email из телефона.
const parentCreateSchema = z.object({
  email: z.string().email().optional().nullable(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  phone: z.string().min(7),

  // Either link to an existing family
  family_id: z.string().uuid().optional(),
  // ...or create a fresh one
  father_name: z.string().optional().nullable(),
  father_phone: z.string().optional().nullable(),
  mother_name: z.string().optional().nullable(),
  mother_phone: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
});

export const parentsRoutes = async (app: FastifyInstance) => {
  app.post(
    "/v1/parents",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
      ],
    },
    async (req, reply) => {
      const parsed = parentCreateSchema.safeParse(req.body);
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

      // Уникальность телефона среди активных профилей
      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("phone", e164)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing) {
        return reply.code(409).send({ error: "phone_already_exists" });
      }

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      // 1. Create auth.users
      const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: loginEmail,
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: input.full_name, phone: e164 },
      });
      if (authErr || !created?.user) {
        req.log.error({ err: authErr }, "parent_auth_create_failed");
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
        role: "parent",
        full_name: input.full_name,
        phone: e164,
        email: input.email && input.email.trim() ? input.email.trim() : null,
        is_active: true,
      });
      if (profErr) {
        req.log.error({ err: profErr }, "parent_profile_insert_failed");
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return reply.code(500).send({ error: "profile_insert_failed" });
      }

      // 3. Family — either link to existing or create new
      let familyId = input.family_id;
      if (familyId) {
        // Refuse to silently overwrite an existing parent_user_id.
        const { data: famRow, error: famGetErr } = await supabaseAdmin
          .from("families")
          .select("parent_user_id")
          .eq("id", familyId)
          .maybeSingle();
        if (famGetErr || !famRow) {
          await supabaseAdmin.from("profiles").delete().eq("id", newUserId);
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
          return reply.code(404).send({ error: "family_not_found" });
        }
        if (famRow.parent_user_id) {
          await supabaseAdmin.from("profiles").delete().eq("id", newUserId);
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
          return reply.code(409).send({ error: "family_already_has_parent" });
        }

        const { error: linkErr } = await supabaseAdmin
          .from("families")
          .update({ parent_user_id: newUserId })
          .eq("id", familyId)
          .is("parent_user_id", null); // double-check: prevents race overwrite
        if (linkErr) {
          req.log.error({ err: linkErr }, "parent_family_link_failed");
          await supabaseAdmin.from("profiles").delete().eq("id", newUserId);
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
          return reply.code(500).send({ error: "family_link_failed" });
        }
      } else {
        const { data: fam, error: famErr } = await supabaseAdmin
          .from("families")
          .insert({
            organization_id: user.organization_id,
            parent_user_id: newUserId,
            father_name: input.father_name ?? null,
            father_phone: input.father_phone ?? null,
            mother_name: input.mother_name ?? null,
            mother_phone: input.mother_phone ?? null,
            comment: input.comment ?? null,
          })
          .select("id")
          .single();
        if (famErr || !fam) {
          req.log.error({ err: famErr }, "parent_family_create_failed");
          await supabaseAdmin.from("profiles").delete().eq("id", newUserId);
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
          return reply.code(500).send({ error: "family_create_failed" });
        }
        familyId = fam.id;
      }

      return reply.code(201).send({ ok: true, parent_id: newUserId, family_id: familyId });
    },
  );

  // PATCH /v1/parents/:id — обновить full_name / email / phone / password
  // (любой набор полей; password ≥ 8). Меняет также auth.users (email + password).
  const parentUpdateSchema = z.object({
    full_name: z.string().min(1).optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().min(7).optional(),
    password: z.string().min(8).optional(),
  });
  app.patch<{ Params: { id: string } }>(
    "/v1/parents/:id",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
      ],
    },
    async (req, reply) => {
      const parsed = parentUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const input = parsed.data;
      const user = req.user!;
      const parentId = req.params.id;

      // Убедимся, что это родитель из этой же организации.
      const { data: target, error: tErr } = await supabaseAdmin
        .from("profiles")
        .select("id, role, organization_id, phone, email")
        .eq("id", parentId)
        .maybeSingle();
      if (tErr || !target) {
        return reply.code(404).send({ error: "parent_not_found" });
      }
      if (target.role !== "parent" || target.organization_id !== user.organization_id) {
        return reply.code(403).send({ error: "not_a_parent_in_org" });
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
          .neq("id", parentId)
          .is("deleted_at", null)
          .maybeSingle();
        if (existing) {
          return reply.code(409).send({ error: "phone_already_exists" });
        }
        profilePatch.phone = newE164;
      }

      // email — null или валидный.
      if (input.email !== undefined) {
        profilePatch.email = input.email === null ? null : input.email.trim();
      }

      // auth.users.email — реальный email если задан, иначе pseudo от телефона.
      // Меняем только если меняется email или phone.
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
          parentId,
          authUpdate as never,
        );
        if (authErr) {
          req.log.error({ err: authErr }, "parent_auth_update_failed");
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
          .eq("id", parentId);
        if (pErr) {
          req.log.error({ err: pErr }, "parent_profile_update_failed");
          return reply.code(500).send({ error: "profile_update_failed" });
        }
      }

      return reply.send({ ok: true });
    },
  );
};
