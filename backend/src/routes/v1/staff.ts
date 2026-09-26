import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { normalizeE164KG, phoneToPseudoEmail } from "../../lib/phone.js";

// Роли, которые директор может создавать через эту ручку.
// Coach создаётся через /v1/coaches (там ещё запись в coaches),
// Parent — через /v1/parents (там ещё families).
const STAFF_ROLES = [
  "fitness_director",
  "senior_manager",
  "manager",
  "cashier",
] as const;

const optionalNullableString = (max = 500) =>
  z.union([z.string().max(max), z.literal(""), z.null()]).optional();

const optionalDate = () =>
  z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()]).optional();

const optionalInn = () =>
  z.union([z.string().regex(/^\d{14}$/), z.literal(""), z.null()]).optional();

const optionalEmail = () =>
  z.union([z.string().email(), z.literal(""), z.null()]).optional();

const staffCreateSchema = z.object({
  phone: z.string().min(7),
  password: z.string().min(8),
  full_name: z.string().min(2),
  role: z.enum(STAFF_ROLES),
  // Опциональные расширенные поля.
  email: optionalEmail(),
  avatar_url: optionalNullableString(1000),
  inn: optionalInn(),
  birthday: optionalDate(),
  hire_date: optionalDate(),
  address: optionalNullableString(500),
  notes: optionalNullableString(2000),
});

const staffUpdateSchema = z.object({
  full_name: z.string().min(2).optional(),
  phone: z.string().min(7).optional(),
  role: z.enum(STAFF_ROLES).optional(),
  is_active: z.boolean().optional(),
  email: optionalEmail(),
  avatar_url: optionalNullableString(1000),
  inn: optionalInn(),
  birthday: optionalDate(),
  hire_date: optionalDate(),
  address: optionalNullableString(500),
  notes: optionalNullableString(2000),
});

const passwordSchema = z.object({ password: z.string().min(8) });

// Поля, которые отдаём в GET. Заметки `notes` отдаём только директору.
const PUBLIC_COLUMNS =
  "id, full_name, phone, email, role, is_active, avatar_url, inn, birthday, hire_date, address, created_at, deleted_at";
const DIRECTOR_COLUMNS = `${PUBLIC_COLUMNS}, notes`;

// Конвертация пустых строк в null перед записью в БД.
const toNull = (v: unknown): unknown => (v === "" ? null : v);

export const staffRoutes = async (app: FastifyInstance) => {
  // GET /v1/staff?include_archived=true — список сотрудников организации
  app.get<{ Querystring: { include_archived?: string } }>(
    "/v1/staff",
    { preHandler: [authenticate, requireRole("director", "fitness_director")] },
    async (req, reply) => {
      const user = req.user!;
      const includeArchived = req.query.include_archived === "true";
      const columns = user.role === "director" ? DIRECTOR_COLUMNS : PUBLIC_COLUMNS;

      let q = supabaseAdmin
        .from("profiles")
        .select(columns)
        .eq("organization_id", user.organization_id)
        .in("role", [...STAFF_ROLES, "director"])
        .order("role")
        .order("full_name");

      if (!includeArchived) {
        q = q.is("deleted_at", null);
      }

      const { data, error } = await q;
      if (error) {
        req.log.error({ err: error }, "staff_list_failed");
        return reply.code(500).send({ error: "list_failed" });
      }
      return reply.send({ staff: data ?? [] });
    },
  );

  // POST /v1/staff — создать сотрудника
  app.post(
    "/v1/staff",
    { preHandler: [authenticate, requireRole("director")] },
    async (req, reply) => {
      const parsed = staffCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const input = parsed.data;
      const user = req.user!;

      let e164: string;
      let pseudoEmail: string;
      try {
        e164 = normalizeE164KG(input.phone);
        pseudoEmail = phoneToPseudoEmail(e164);
      } catch {
        return reply.code(400).send({ error: "phone_invalid_format" });
      }

      // Проверка уникальности телефона
      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("phone", e164)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing) {
        return reply.code(409).send({ error: "phone_already_exists" });
      }

      // Проверка уникальности ИНН в организации
      const innValue = toNull(input.inn) as string | null;
      if (innValue) {
        const { data: innClash } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("organization_id", user.organization_id)
          .eq("inn", innValue)
          .is("deleted_at", null)
          .maybeSingle();
        if (innClash) {
          return reply.code(409).send({ error: "inn_already_exists" });
        }
      }

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      // 1. Создать auth.users
      const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: pseudoEmail,
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: input.full_name, phone: e164 },
      });
      if (authErr || !created?.user) {
        req.log.error({ err: authErr }, "staff_auth_create_failed");
        if (authErr?.message?.includes("already")) {
          return reply.code(409).send({ error: "phone_already_exists" });
        }
        return reply.code(500).send({ error: "auth_create_failed", message: authErr?.message });
      }

      const newUserId = created.user.id;

      // 2. Profile (с расширенными полями)
      const { error: profErr } = await supabaseAdmin.from("profiles").insert({
        id: newUserId,
        organization_id: user.organization_id,
        role: input.role,
        full_name: input.full_name,
        phone: e164,
        email: toNull(input.email),
        avatar_url: toNull(input.avatar_url),
        inn: innValue,
        birthday: toNull(input.birthday),
        hire_date: toNull(input.hire_date),
        address: toNull(input.address),
        notes: toNull(input.notes),
        is_active: true,
      });
      if (profErr) {
        req.log.error({ err: profErr }, "staff_profile_insert_failed");
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return reply.code(500).send({ error: "profile_insert_failed" });
      }

      return reply.code(201).send({ ok: true, staff_id: newUserId, phone: e164 });
    },
  );

  // PATCH /v1/staff/:id — обновить
  app.patch<{ Params: { id: string } }>(
    "/v1/staff/:id",
    { preHandler: [authenticate, requireRole("director")] },
    async (req, reply) => {
      const parsed = staffUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const input = parsed.data;
      const user = req.user!;
      const staffId = req.params.id;

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const patch: Record<string, unknown> = {};
      if (input.full_name !== undefined) patch.full_name = input.full_name;
      if (input.role !== undefined) patch.role = input.role;
      if (input.is_active !== undefined) patch.is_active = input.is_active;
      if (input.email !== undefined) patch.email = toNull(input.email);
      if (input.avatar_url !== undefined) patch.avatar_url = toNull(input.avatar_url);
      if (input.birthday !== undefined) patch.birthday = toNull(input.birthday);
      if (input.hire_date !== undefined) patch.hire_date = toNull(input.hire_date);
      if (input.address !== undefined) patch.address = toNull(input.address);
      if (input.notes !== undefined) patch.notes = toNull(input.notes);

      // ИНН — отдельно с проверкой уникальности
      if (input.inn !== undefined) {
        const innValue = toNull(input.inn) as string | null;
        if (innValue) {
          const { data: innClash } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("organization_id", user.organization_id)
            .eq("inn", innValue)
            .neq("id", staffId)
            .is("deleted_at", null)
            .maybeSingle();
          if (innClash) {
            return reply.code(409).send({ error: "inn_already_exists" });
          }
        }
        patch.inn = innValue;
      }

      if (input.phone !== undefined) {
        let e164: string;
        try {
          e164 = normalizeE164KG(input.phone);
        } catch {
          return reply.code(400).send({ error: "phone_invalid_format" });
        }
        const { data: existing } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("phone", e164)
          .neq("id", staffId)
          .is("deleted_at", null)
          .maybeSingle();
        if (existing) {
          return reply.code(409).send({ error: "phone_already_exists" });
        }
        patch.phone = e164;
        const { error: authUpdErr } = await supabaseAdmin.auth.admin.updateUserById(staffId, {
          email: phoneToPseudoEmail(e164),
          email_confirm: true,
        } as never);
        if (authUpdErr) {
          req.log.error({ err: authUpdErr }, "staff_auth_email_update_failed");
          return reply.code(500).send({ error: "auth_update_failed" });
        }
      }

      if (Object.keys(patch).length === 0) {
        return reply.send({ ok: true });
      }

      const { error } = await supabaseAdmin
        .from("profiles")
        .update(patch)
        .eq("id", staffId)
        .eq("organization_id", user.organization_id);
      if (error) {
        req.log.error({ err: error }, "staff_update_failed");
        return reply.code(500).send({ error: "update_failed" });
      }
      return reply.send({ ok: true });
    },
  );

  // DELETE /v1/staff/:id — soft delete
  app.delete<{ Params: { id: string } }>(
    "/v1/staff/:id",
    { preHandler: [authenticate, requireRole("director")] },
    async (req, reply) => {
      const user = req.user!;
      const staffId = req.params.id;

      if (staffId === user.id) {
        return reply.code(403).send({ error: "cannot_delete_self" });
      }

      const { data: target, error: getErr } = await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("id", staffId)
        .eq("organization_id", user.organization_id)
        .maybeSingle();
      if (getErr) {
        req.log.error({ err: getErr }, "staff_delete_lookup_failed");
        return reply.code(500).send({ error: "lookup_failed" });
      }
      if (!target) return reply.code(404).send({ error: "not_found" });
      if (target.role === "director") {
        return reply.code(403).send({ error: "cannot_delete_director" });
      }

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const { error: updErr } = await supabaseAdmin
        .from("profiles")
        .update({
          deleted_at: new Date().toISOString(),
          is_active: false,
        })
        .eq("id", staffId);
      if (updErr) {
        req.log.error({ err: updErr }, "staff_soft_delete_failed");
        return reply.code(500).send({ error: "soft_delete_failed" });
      }

      // Бан в auth, чтобы существующие токены перестали работать.
      const banErr = await supabaseAdmin.auth.admin.updateUserById(staffId, {
        ban_duration: "876000h",
      } as never).then((r) => r.error);
      if (banErr) {
        req.log.warn({ err: banErr }, "staff_auth_ban_failed");
      }

      return reply.send({ ok: true });
    },
  );

  // POST /v1/staff/:id/restore — восстановить
  app.post<{ Params: { id: string } }>(
    "/v1/staff/:id/restore",
    { preHandler: [authenticate, requireRole("director")] },
    async (req, reply) => {
      const user = req.user!;
      const staffId = req.params.id;

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ deleted_at: null, is_active: true })
        .eq("id", staffId)
        .eq("organization_id", user.organization_id);
      if (error) {
        req.log.error({ err: error }, "staff_restore_failed");
        return reply.code(500).send({ error: "restore_failed" });
      }

      const unbanErr = await supabaseAdmin.auth.admin.updateUserById(staffId, {
        ban_duration: "none",
      } as never).then((r) => r.error);
      if (unbanErr) {
        req.log.warn({ err: unbanErr }, "staff_auth_unban_failed");
      }

      return reply.send({ ok: true });
    },
  );

  // POST /v1/staff/:id/password — сброс пароля
  app.post<{ Params: { id: string } }>(
    "/v1/staff/:id/password",
    { preHandler: [authenticate, requireRole("director")] },
    async (req, reply) => {
      const parsed = passwordSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const staffId = req.params.id;

      const { data: target, error: getErr } = await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("id", staffId)
        .eq("organization_id", user.organization_id)
        .maybeSingle();
      if (getErr) return reply.code(500).send({ error: "lookup_failed" });
      if (!target) return reply.code(404).send({ error: "not_found" });
      if (target.role === "director" && target.id !== user.id) {
        return reply.code(403).send({ error: "cannot_change_director_password" });
      }

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(staffId, {
        password: parsed.data.password,
      });
      if (updErr) {
        req.log.error({ err: updErr }, "staff_password_reset_failed");
        return reply.code(500).send({ error: "password_reset_failed" });
      }

      return reply.send({ ok: true });
    },
  );

  // ТЗ §12.3: сброс второго фактора.
  //
  // Без этого потерянный или перепрошитый телефон означает необратимую
  // блокировку: RLS-политика mfa_required требует aal2, а пройти его
  // нечем. Сбрасывает только директор и только сотруднику своей
  // организации; себе — нельзя, иначе смысл второго фактора теряется
  // (достаточно угнать сессию и сбросить фактор).
  app.post<{ Params: { id: string } }>(
    "/v1/staff/:id/reset-mfa",
    { preHandler: [authenticate, requireRole("director")] },
    async (req, reply) => {
      const user = req.user!;
      const targetId = req.params.id;

      if (targetId === user.id) {
        return reply.code(400).send({
          error: "cannot_reset_own_mfa",
          message: "Свой второй фактор сбросить нельзя — попросите другого директора.",
        });
      }

      const { data: target, error: tErr } = await supabaseAdmin
        .from("profiles")
        .select("id, organization_id, full_name")
        .eq("id", targetId)
        .maybeSingle();
      if (tErr || !target) return reply.code(404).send({ error: "user_not_found" });
      if (target.organization_id !== user.organization_id) {
        return reply.code(403).send({ error: "user_outside_org" });
      }

      const { data: factors, error: fErr } = await supabaseAdmin.auth.admin.mfa.listFactors({
        userId: targetId,
      });
      if (fErr) {
        req.log.error({ err: fErr }, "mfa_list_factors_failed");
        return reply.code(500).send({ error: "mfa_list_failed", message: fErr.message });
      }

      let removed = 0;
      for (const f of factors?.factors ?? []) {
        const { error: dErr } = await supabaseAdmin.auth.admin.mfa.deleteFactor({
          id: f.id,
          userId: targetId,
        });
        if (dErr) {
          req.log.error({ err: dErr, factor: f.id }, "mfa_delete_factor_failed");
          continue;
        }
        removed += 1;
      }

      req.log.warn(
        { actor: user.id, target: targetId, removed },
        "mfa_reset_by_director",
      );
      return reply.send({ ok: true, removed });
    },
  );
};
