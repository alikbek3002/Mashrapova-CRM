import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { dispatchOutbound } from "../../lib/outbound.js";

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

  // ------------------------------------------------------------------
  // POST /v1/notifications/dispatch — разбор очереди исходящих (ТЗ §9).
  //
  // Вызывается тем же планировщиком, что и refresh_lifecycle. Пока
  // провайдер не подключён (SMS_PROVIDER=noop), сообщения помечаются
  // skipped с явной причиной — очередь не растёт бесконечно, и видно,
  // сколько SMS ушло бы при включённом провайдере.
  // ------------------------------------------------------------------
  app.post(
    "/v1/notifications/dispatch",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
      ],
    },
    async (req, reply) => {
      const user = req.user!;
      // Разбор очереди живёт в lib/outbound.ts: его же раз в час гоняет
      // планировщик, и две копии логики неизбежно разъехались бы.
      const result = await dispatchOutbound(req.log, user.organization_id);
      return reply.send({ ok: true, ...result });
    },
  );

  // ------------------------------------------------------------------
  // POST /v1/notifications/broadcast — массовая рассылка (ТЗ §9.2).
  //
  // «Массовая рассылка по фильтрам: секция, тренер, статус абонемента,
  //  дата окончания. Доступна старшему менеджеру и выше.»
  //
  // Сообщения кладутся в ту же очередь, что и транзакционные: один
  // транспорт, одна история отправок, один отчёт.
  // ------------------------------------------------------------------
  const broadcastSchema = z.object({
    text: z.string().trim().min(1).max(480),
    section_id: z.string().uuid().nullable().optional(),
    coach_id: z.string().uuid().nullable().optional(),
    card_status: z.enum(["active", "ending", "frozen", "expired", "debt"]).nullable().optional(),
    end_date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    end_date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    /** Не отправлять, только показать, скольким уйдёт. */
    dry_run: z.boolean().default(false),
  });

  app.post(
    "/v1/notifications/broadcast",
    {
      preHandler: [
        authenticate,
        // ТЗ §9.2: от старшего менеджера и выше.
        requireRole("director", "fitness_director", "senior_manager"),
      ],
    },
    async (req, reply) => {
      const parsed = broadcastSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;
      const f = parsed.data;

      // Кому: дети с абонементом под фильтр, через них — телефон семьи.
      let q = supabaseAdmin
        .from("club_cards")
        .select("child_id, section_id, end_date, status, child:children(id, full_name, family:families(father_phone, mother_phone))")
        .eq("organization_id", user.organization_id);
      if (f.section_id) q = q.eq("section_id", f.section_id);
      if (f.card_status) q = q.eq("status", f.card_status);
      else q = q.in("status", ["active", "ending", "frozen"]);
      if (f.end_date_from) q = q.gte("end_date", f.end_date_from);
      if (f.end_date_to) q = q.lte("end_date", f.end_date_to);

      const { data: cards, error: cErr } = await q;
      if (cErr) return reply.code(500).send({ error: "filter_failed", message: cErr.message });

      // Фильтр по тренеру — через активные зачисления в его группы:
      // у абонемента тренера нет, он есть у группы.
      let allowedChildIds: Set<string> | null = null;
      if (f.coach_id) {
        const { data: groups } = await supabaseAdmin
          .from("groups")
          .select("id")
          .eq("coach_id", f.coach_id)
          .is("deleted_at", null);
        const groupIds = (groups ?? []).map((g) => g.id);
        if (groupIds.length === 0) allowedChildIds = new Set();
        else {
          const { data: enrolls } = await supabaseAdmin
            .from("enrollments")
            .select("child_id")
            .in("group_id", groupIds)
            .is("archived_at", null);
          allowedChildIds = new Set((enrolls ?? []).map((e) => e.child_id));
        }
      }

      // Один телефон — одно сообщение: у семьи может быть несколько
      // детей и несколько абонементов, дублировать SMS нельзя.
      const byPhone = new Map<string, string>();
      for (const c of cards ?? []) {
        if (allowedChildIds && !allowedChildIds.has(c.child_id)) continue;
        const child = Array.isArray((c as any).child) ? (c as any).child[0] : (c as any).child;
        const fam = Array.isArray(child?.family) ? child.family[0] : child?.family;
        const phone: string | null = fam?.father_phone ?? fam?.mother_phone ?? null;
        if (!phone) continue;
        if (!byPhone.has(phone)) byPhone.set(phone, child?.full_name ?? "");
      }

      if (f.dry_run) {
        return reply.send({ ok: true, dry_run: true, recipients: byPhone.size });
      }

      const batchId = crypto.randomUUID();
      const rows = Array.from(byPhone.entries()).map(([phone, childName]) => ({
        organization_id: user.organization_id,
        channel: "sms",
        event_type: "broadcast",
        to_phone: phone,
        body: f.text.replace(/\{child_name\}/g, childName),
        payload: { batch_id: batchId, sent_by: user.id },
        // Рассылка идёт мимо матрицы и шаблонов: текст пишет человек.
        // Ключ дедупликации — пара «рассылка + телефон».
        dedup_key: `broadcast:${batchId}:${phone}`,
      }));

      if (rows.length === 0) return reply.send({ ok: true, recipients: 0, batch_id: batchId });

      const { error: insErr } = await supabaseAdmin.from("outbound_messages").insert(rows);
      if (insErr) return reply.code(500).send({ error: "enqueue_failed", message: insErr.message });

      req.log.info({ actor: user.id, batch: batchId, count: rows.length }, "broadcast_enqueued");
      return reply.send({ ok: true, recipients: rows.length, batch_id: batchId });
    },
  );
};
