import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { bulkCancelSchema, bulkRescheduleSchema, lessonCancelSchema } from "../../schemas/lessons.js";
import { extendEnrollmentWindowsForMove } from "../../lib/enrollment-window.js";

const lessonUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  duration_min: z.number().int().min(15).max(360).optional(),
  coach_id: z.string().uuid().optional(),
  substitute_coach_id: z.string().uuid().nullable().optional(),
  capacity_limit: z.number().int().nullable().optional(),
});

export const lessonsRoutes = async (app: FastifyInstance) => {
  // Edit lesson (reschedule, change coach, set substitute)
  app.patch(
    "/v1/lessons/:id",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = lessonUpdateSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const user = req.user!;
      await supabaseAdmin.rpc("set_config", { setting_name: "app.actor_id", new_value: user.id, is_local: true } as never);

      // Дата до правки нужна, чтобы после переноса подтянуть окна записи.
      const { data: before } = await supabaseAdmin
        .from("lessons")
        .select("date, group_id")
        .eq("id", id)
        .maybeSingle();

      const { data, error } = await supabaseAdmin
        .from("lessons")
        .update(parsed.data)
        .eq("id", id)
        .select()
        .single();
      if (error || !data) return reply.code(500).send({ error: "update_failed", message: error?.message });

      if (before && parsed.data.date && parsed.data.date !== before.date) {
        await extendEnrollmentWindowsForMove([
          { group_id: before.group_id, previous_date: before.date, new_date: parsed.data.date },
        ]);
      }
      return reply.code(200).send({ ok: true, lesson: data });
    }
  );


  // Cancel a lesson. If force_majeure=true → +1 lesson to all enrolled children
  // (implemented by inserting approved freezes for each enrollment).
  app.post(
    "/v1/lessons/:id/cancel",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = lessonCancelSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      }
      const user = req.user!;

      const { data: lesson, error: lessonErr } = await supabaseAdmin
        .from("lessons")
        .select("id, group_id, organization_id, status")
        .eq("id", id)
        .single();
      if (lessonErr || !lesson) return reply.code(404).send({ error: "lesson_not_found" });
      if (lesson.status === "cancelled" || lesson.status === "force_majeure") {
        return reply.code(409).send({ error: "lesson_already_cancelled" });
      }

      const newStatus = parsed.data.force_majeure ? "force_majeure" : "cancelled";

      const { error: updateErr } = await supabaseAdmin
        .from("lessons")
        .update({
          status: newStatus,
          cancellation_reason: parsed.data.reason,
        })
        .eq("id", id);
      if (updateErr) return reply.code(500).send({ error: "cancel_failed" });

      // Force-majeure: credit +1 lesson to each enrolled child
      if (parsed.data.force_majeure) {
        const { data: enrolled } = await supabaseAdmin
          .from("enrollments")
          .select("child_id")
          .eq("group_id", lesson.group_id)
          .is("archived_at", null);

        if (enrolled && enrolled.length > 0) {
          const childIds = enrolled.map((e) => e.child_id);
          const { data: cards } = await supabaseAdmin
            .from("club_cards")
            .select("id, child_id")
            .in("child_id", childIds)
            .eq("status", "active");

          if (cards && cards.length > 0) {
            await supabaseAdmin.from("freezes").insert(
              cards.map((c) => ({
                child_id: c.child_id,
                club_card_id: c.id,
                initiated_by: user.id,
                initiator_role: "manager",
                reason: `force_majeure:${parsed.data.reason}`,
                status: "approved",
                approved_by: user.id,
                approved_at: new Date().toISOString(),
              }))
            );
          }
        }
      }

      return reply.send({ ok: true, status: newStatus });
    }
  );

  // Bulk reschedule: move a set of lessons either by shifting N days or to
  // a specific target date. Does NOT touch attendance / club_cards (the
  // subscription balance is unaffected). Parents get a notification per
  // affected lesson with old + new date/time.
  app.post(
    "/v1/lessons/bulk-reschedule",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      const parsed = bulkRescheduleSchema.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const user = req.user!;
      const orgId = user.organization_id;

      const { data: lessons, error: lessonsErr } = await supabaseAdmin
        .from("lessons")
        .select(
          "id, organization_id, group_id, coach_id, date, start_time, duration_min, status, group:groups(name)"
        )
        .in("id", parsed.data.lesson_ids);
      if (lessonsErr || !lessons)
        return reply.code(500).send({ error: "fetch_failed", message: lessonsErr?.message });
      if (lessons.length !== parsed.data.lesson_ids.length)
        return reply.code(404).send({ error: "some_lessons_not_found" });

      const wrongOrg = lessons.find((l) => l.organization_id !== orgId);
      if (wrongOrg) return reply.code(403).send({ error: "wrong_organization" });
      const alreadyClosed = lessons.find(
        (l) => l.status === "cancelled" || l.status === "force_majeure"
      );
      if (alreadyClosed)
        return reply
          .code(409)
          .send({ error: "lesson_already_cancelled", lesson_id: alreadyClosed.id });

      // Compute new date/time for each lesson
      const updates = lessons.map((l) => {
        let newDate = l.date;
        if (parsed.data.mode === "shift_days" && parsed.data.shift_days != null) {
          const d = new Date(l.date + "T00:00:00");
          d.setDate(d.getDate() + parsed.data.shift_days);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          newDate = `${y}-${m}-${day}`;
        } else if (parsed.data.mode === "set_date" && parsed.data.new_date) {
          newDate = parsed.data.new_date;
        }
        const rawNewTime = parsed.data.new_start_time ?? l.start_time;
        const newStartTime = rawNewTime.length === 5 ? `${rawNewTime}:00` : rawNewTime;
        return {
          id: l.id,
          group_id: l.group_id,
          coach_id: l.coach_id,
          duration_min: l.duration_min,
          previous_date: l.date,
          previous_start_time: l.start_time,
          new_date: newDate,
          new_start_time: newStartTime,
          group_name: (l as any).group?.name ?? null,
        };
      });

      // Collision check: same coach + same date + same start_time on a lesson
      // that isn't itself being moved. Done in batch with one query per coach.
      const movingIds = new Set(updates.map((u) => u.id));
      const coachKeys = Array.from(new Set(updates.map((u) => u.coach_id))).filter(Boolean);
      for (const coachId of coachKeys) {
        const myMoves = updates.filter((u) => u.coach_id === coachId);
        const dates = Array.from(new Set(myMoves.map((u) => u.new_date)));
        const { data: existing } = await supabaseAdmin
          .from("lessons")
          .select("id, date, start_time, status")
          .eq("coach_id", coachId)
          .in("date", dates)
          .in("status", ["scheduled", "completed"]);
        const conflicts: { lesson_id: string; date: string; start_time: string }[] = [];
        for (const m of myMoves) {
          // Conflict with another lesson not in the move set
          const hit = (existing ?? []).find(
            (e) =>
              !movingIds.has(e.id) &&
              e.date === m.new_date &&
              e.start_time.slice(0, 5) === m.new_start_time.slice(0, 5)
          );
          if (hit)
            conflicts.push({
              lesson_id: m.id,
              date: m.new_date,
              start_time: m.new_start_time,
            });
          // Conflict between two moves landing on the same slot
          const sameMove = myMoves.find(
            (o) =>
              o.id !== m.id &&
              o.new_date === m.new_date &&
              o.new_start_time.slice(0, 5) === m.new_start_time.slice(0, 5)
          );
          if (sameMove)
            conflicts.push({
              lesson_id: m.id,
              date: m.new_date,
              start_time: m.new_start_time,
            });
        }
        if (conflicts.length > 0) return reply.code(409).send({ error: "conflicts", conflicts });
      }

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      // Apply updates one by one (Supabase JS has no batch update with
      // per-row values). Volume capped at 200 via the zod schema.
      for (const u of updates) {
        const { error: updErr } = await supabaseAdmin
          .from("lessons")
          .update({ date: u.new_date, start_time: u.new_start_time })
          .eq("id", u.id);
        if (updErr)
          return reply.code(500).send({ error: "update_failed", message: updErr.message });
      }

      // Перенос вперёд может вытолкнуть занятие за границу окна записи —
      // тогда ребёнок пропадёт из ростера перенесённого урока. Подтягиваем.
      await extendEnrollmentWindowsForMove(updates);

      // Notify parents of enrolled children
      const groupIds = Array.from(new Set(updates.map((u) => u.group_id)));
      const { data: enrolls } = await supabaseAdmin
        .from("enrollments")
        .select("group_id, child_id")
        .in("group_id", groupIds)
        .is("archived_at", null);
      const childIds = Array.from(new Set((enrolls ?? []).map((e) => e.child_id)));
      const { data: kids } = await supabaseAdmin
        .from("children")
        .select("id, parent_user_id")
        .in("id", childIds);
      const parentByChild = new Map(
        (kids ?? []).filter((k) => k.parent_user_id).map((k) => [k.id, k.parent_user_id as string])
      );
      const byGroup = new Map<string, string[]>();
      for (const e of enrolls ?? []) {
        const pid = parentByChild.get(e.child_id);
        if (!pid) continue;
        const arr = byGroup.get(e.group_id) ?? [];
        if (!arr.includes(pid)) arr.push(pid);
        byGroup.set(e.group_id, arr);
      }
      const notifRows: { recipient_id: string; type: string; payload: any }[] = [];
      for (const u of updates) {
        const recipients = byGroup.get(u.group_id) ?? [];
        for (const rid of recipients) {
          notifRows.push({
            recipient_id: rid,
            type: "lesson.rescheduled",
            payload: {
              lesson_id: u.id,
              group_name: u.group_name,
              previous_date: u.previous_date,
              previous_start_time: u.previous_start_time,
              new_date: u.new_date,
              new_start_time: u.new_start_time,
              reason: parsed.data.reason ?? null,
            },
          });
        }
      }
      if (notifRows.length > 0) await supabaseAdmin.from("notifications").insert(notifRows);

      return reply.send({ ok: true, moved: updates.length, notified: notifRows.length });
    }
  );

  // Bulk cancel: mark several lessons as cancelled. force_majeure is always
  // false here (no balance change — by product decision). Parents notified
  // per affected lesson.
  app.post(
    "/v1/lessons/bulk-cancel",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      const parsed = bulkCancelSchema.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const user = req.user!;
      const orgId = user.organization_id;

      const { data: lessons, error: lessonsErr } = await supabaseAdmin
        .from("lessons")
        .select(
          "id, organization_id, group_id, date, start_time, status, group:groups(name)"
        )
        .in("id", parsed.data.lesson_ids);
      if (lessonsErr || !lessons)
        return reply.code(500).send({ error: "fetch_failed", message: lessonsErr?.message });
      if (lessons.length !== parsed.data.lesson_ids.length)
        return reply.code(404).send({ error: "some_lessons_not_found" });
      const wrongOrg = lessons.find((l) => l.organization_id !== orgId);
      if (wrongOrg) return reply.code(403).send({ error: "wrong_organization" });
      const alreadyClosed = lessons.find(
        (l) => l.status === "cancelled" || l.status === "force_majeure"
      );
      if (alreadyClosed)
        return reply
          .code(409)
          .send({ error: "lesson_already_cancelled", lesson_id: alreadyClosed.id });

      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);

      const { error: updErr } = await supabaseAdmin
        .from("lessons")
        .update({ status: "cancelled", cancellation_reason: parsed.data.reason })
        .in("id", parsed.data.lesson_ids);
      if (updErr) return reply.code(500).send({ error: "cancel_failed", message: updErr.message });

      // Notify parents
      const groupIds = Array.from(new Set(lessons.map((l) => l.group_id)));
      const { data: enrolls } = await supabaseAdmin
        .from("enrollments")
        .select("group_id, child_id")
        .in("group_id", groupIds)
        .is("archived_at", null);
      const childIds = Array.from(new Set((enrolls ?? []).map((e) => e.child_id)));
      const { data: kids } = await supabaseAdmin
        .from("children")
        .select("id, parent_user_id")
        .in("id", childIds);
      const parentByChild = new Map(
        (kids ?? []).filter((k) => k.parent_user_id).map((k) => [k.id, k.parent_user_id as string])
      );
      const byGroup = new Map<string, string[]>();
      for (const e of enrolls ?? []) {
        const pid = parentByChild.get(e.child_id);
        if (!pid) continue;
        const arr = byGroup.get(e.group_id) ?? [];
        if (!arr.includes(pid)) arr.push(pid);
        byGroup.set(e.group_id, arr);
      }
      const notifRows: { recipient_id: string; type: string; payload: any }[] = [];
      for (const l of lessons) {
        const recipients = byGroup.get(l.group_id) ?? [];
        for (const rid of recipients) {
          notifRows.push({
            recipient_id: rid,
            type: "lesson.cancelled",
            payload: {
              lesson_id: l.id,
              group_name: (l as any).group?.name ?? null,
              date: l.date,
              start_time: l.start_time,
              reason: parsed.data.reason,
            },
          });
        }
      }
      if (notifRows.length > 0) await supabaseAdmin.from("notifications").insert(notifRows);

      return reply.send({ ok: true, cancelled: lessons.length, notified: notifRows.length });
    }
  );
};
