import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { ensureLessonsForGroup } from "../../lib/lesson-generator.js";
import { requireIdempotencyKey, storeIdempotencyResponse } from "../../middleware/idempotency.js";

const extendSchema = z.object({
  card_id: z.string().uuid(),
  new_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const cancelSchema = z.object({
  card_id: z.string().uuid(),
  reason: z.string().min(1),
});

const closeSchema = z.object({
  card_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

const removeLessonsSchema = z.object({
  card_id: z.string().uuid(),
  lesson_ids: z.array(z.string().uuid()).min(1).max(200),
  reason: z.string().max(300).nullable().optional(),
});
const restoreLessonsSchema = z.object({
  card_id: z.string().uuid(),
  lesson_ids: z.array(z.string().uuid()).min(1).max(200),
});

const addLessonsSchema = z.object({
  card_id: z.string().uuid(),
  count: z.number().int().min(1).max(300),
  // Оплата за добавленные занятия (0 = компенсация/бесплатно).
  price: z.number().nonnegative().default(0),
  payment_method: z.enum(["cash", "terminal"]).default("cash"),
  deposit_amount: z.number().nonnegative().default(0),
  comment: z.string().max(300).nullable().optional(),
});

// День недели даты (0 = Вс … 6 = Сб) — как в lesson-generator / enrollmentWindow.
const dowOfIso = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
};

// Дата N-го занятия группы по её расписанию, считая от from (включительно).
// Считаем ЗАНЯТИЯ, не дни: два слота в день = два занятия (как генератор).
// Дни заморозки пропускаем. null — расписание пустое / N не достигнут.
const nthLessonDate = (
  from: string,
  count: number,
  schedule: Array<{ day_of_week: number }>,
  skip: (d: string) => boolean,
): string | null => {
  if (count <= 0 || schedule.length === 0) return null;
  let seen = 0;
  let cursor = from;
  for (let i = 0; i < 732; i++) {
    if (!skip(cursor)) {
      const slots = schedule.filter((s) => s.day_of_week === dowOfIso(cursor)).length;
      if (slots > 0) {
        seen += slots;
        if (seen >= count) return cursor;
      }
    }
    cursor = addDaysIso(cursor, 1);
  }
  return null;
};

// Сегодня по клубному времени (Asia/Bishkek): закрытие «сегодняшним
// числом» вечером не должно уезжать на завтра/вчера из-за UTC.
const todayIsoBishkek = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bishkek" });

const addDaysIso = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};
const todayIsoUtc = (): string => new Date().toISOString().slice(0, 10);

export const cardsManageRoutes = async (app: FastifyInstance) => {
  // Изменить дату окончания абонемента («Продлить» в истории карточки).
  // Двигает не только карту: окно записи (enrollment) и занятия группы
  // тоже приводятся к новой дате — иначе ребёнок «продлён», но в табеле
  // и «Предстоит» тренировки не появляются (жалоба офиса 2026-08-26).
  app.post(
    "/v1/cards/extend",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      const parsed = extendSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const user = req.user!;
      const newEnd = parsed.data.new_end_date;
      await supabaseAdmin.rpc("set_config", { setting_name: "app.actor_id", new_value: user.id, is_local: true } as never);

      const today = todayIsoUtc();
      // Защита от опечатки в годе (реальный кейс: 22.08.2027 вместо 2026 —
      // карта «жила» лишний год, а генератор насоздавал занятий до 2027).
      // Самый длинный тариф — 9 месяцев; больше 400 дней вперёд не бывает.
      if (newEnd > addDaysIso(today, 400)) {
        return reply.code(400).send({
          error: "date_too_far",
          message: `Дата ${newEnd} слишком далеко в будущем — проверьте год.`,
        });
      }
      const { data, error } = await supabaseAdmin
        .from("club_cards")
        .update({ end_date: newEnd, status: newEnd >= today ? "active" : "expired" })
        .eq("id", parsed.data.card_id)
        .select()
        .single();
      if (error || !data) return reply.code(500).send({ error: "extend_failed", message: error?.message });

      // Окно записи ребёнка в группах секции карты — двигаем конец вслед
      // за картой (и поднимаем авто-архив, если запись успели закрыть).
      if (data.section_id) {
        const { data: enrRows } = await supabaseAdmin
          .from("enrollments")
          .select("id, group_id, end_date, archived_at, group:groups!inner(section_id)")
          .eq("child_id", data.child_id)
          .order("enrolled_at", { ascending: false });
        type EnrRow = {
          id: string; group_id: string; end_date: string | null; archived_at: string | null;
          group?: { section_id?: string } | { section_id?: string }[] | null;
        };
        const sectionOf = (g: EnrRow["group"]) => (Array.isArray(g) ? g[0]?.section_id : g?.section_id);
        const target = ((enrRows ?? []) as EnrRow[]).find((e) => sectionOf(e.group) === data.section_id);
        if (target) {
          await supabaseAdmin
            .from("enrollments")
            .update({ end_date: newEnd, ...(newEnd >= today ? { archived_at: null } : {}) })
            .eq("id", target.id);
          // Занятия группы должны существовать до новой даты — иначе окно
          // продлено «в пустоту» и в табеле нечего показывать.
          if (newEnd >= today) {
            const gen = await ensureLessonsForGroup(target.group_id, today, newEnd, user.id);
            if (!gen.ok) req.log.warn({ err: gen }, "extend_lessons_generate_failed");
            else if (gen.inserted > 0) req.log.info({ inserted: gen.inserted }, "extend_lessons_generated");
          }
        }
      }

      return reply.code(200).send({ ok: true, card: data });
    }
  );

  // Добавить занятия к абонементу («+ занятия» в истории карточки).
  //
  // Запрос офиса 2026-09-02: «у него 36 тренировок — добавить ещё 10».
  // «Продлить» двигает только дату, а число занятий (total_lessons) —
  // источник остатка (v_child_card_balance) и пула ячеек в табелях. Здесь:
  //   • total_lessons += N;
  //   • срок карты продлевается так, чтобы (остаток + N) будущих занятий
  //     по расписанию группы поместились до end_date (иначе добавленные
  //     занятия некуда ставить); дни заморозки пропускаются;
  //   • окно записи в группе и сами занятия догенерируются до новой даты;
  //   • оплата (нал/терминал и/или депозит) — необязательна: 0 = компенсация;
  //   • факт — в комментариях ребёнка и в комментарии платежа.
  // Идемпотентно (Idempotency-Key): повтор не удвоит ни занятия, ни оплату.
  app.post(
    "/v1/cards/add-lessons",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager"),
        requireIdempotencyKey,
      ],
    },
    async (req, reply) => {
      const parsed = addLessonsSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const input = parsed.data;
      const user = req.user!;
      const key = req.idempotencyKey!;
      await supabaseAdmin.rpc("set_config", { setting_name: "app.actor_id", new_value: user.id, is_local: true } as never);

      const { data: card, error: cErr } = await supabaseAdmin
        .from("club_cards")
        .select("id, child_id, organization_id, type, status, start_date, end_date, section_id, total_lessons")
        .eq("id", input.card_id)
        .maybeSingle();
      if (cErr || !card) return reply.code(404).send({ error: "card_not_found" });
      if (card.status === "archived") {
        return reply.code(409).send({ error: "card_archived", message: "Абонемент отменён — добавить занятия нельзя." });
      }
      if (card.total_lessons == null) {
        return reply.code(409).send({
          error: "unlimited_card",
          message: "У этого абонемента нет счётчика занятий — продлите его по дате.",
        });
      }
      const today = todayIsoBishkek();

      // Срок продлевается РОВНО на N занятий по расписанию после текущего
      // конца карты (или после сегодня, если карта уже истекла).
      // Раньше конец пересчитывался под «остаток + N» — и при 1 добавленном
      // занятии у ребёнка появлялось ещё +5 (жалоба офиса 2026-09-10:
      // пропущенные без отметки занятия «оживали» в продлённом сроке).
      const futureNeeded = input.count;

      // Группа ребёнка в секции карты: действующая запись, иначе последняя
      // архивная (её поднимем — занятиям нужна группа).
      const { data: enrRows } = await supabaseAdmin
        .from("enrollments")
        .select("id, group_id, end_date, archived_at, group:groups!inner(section_id)")
        .eq("child_id", card.child_id)
        .order("enrolled_at", { ascending: false });
      type EnrRow = {
        id: string; group_id: string; end_date: string | null; archived_at: string | null;
        group?: { section_id?: string } | { section_id?: string }[] | null;
      };
      const sectionOf = (g: EnrRow["group"]) => (Array.isArray(g) ? g[0]?.section_id : g?.section_id);
      const inSection = ((enrRows ?? []) as EnrRow[]).filter((e) => !card.section_id || sectionOf(e.group) === card.section_id);
      const target = inSection.find((e) => !e.archived_at) ?? inSection[0] ?? null;

      const base = card.end_date >= today ? card.end_date : addDaysIso(today, -1);
      const fromDate = addDaysIso(base, 1);
      let newEnd = card.end_date < today ? today : card.end_date;
      let endSource: "schedule" | "estimate" = "estimate";
      if (target) {
        const [{ data: schedule }, { data: frz }] = await Promise.all([
          supabaseAdmin.from("group_schedule").select("day_of_week").eq("group_id", target.group_id),
          supabaseAdmin.from("freezes").select("start_date, end_date").eq("child_id", card.child_id).eq("status", "approved"),
        ]);
        const freezes = (frz ?? []) as Array<{ start_date: string | null; end_date: string | null }>;
        const inFreeze = (d: string) =>
          freezes.some((f) => (f.start_date == null || d >= f.start_date) && (f.end_date == null || d <= f.end_date));
        const nth = nthLessonDate(fromDate, futureNeeded, (schedule ?? []) as Array<{ day_of_week: number }>, inFreeze);
        if (nth) {
          endSource = "schedule";
          if (nth > newEnd) newEnd = nth;
        }
      }
      if (endSource === "estimate") {
        // Без расписания — грубо: ~3 занятия в неделю.
        const est = addDaysIso(newEnd, Math.ceil(input.count / 3) * 7);
        if (est > newEnd) newEnd = est;
      }
      const cap = addDaysIso(today, 400);
      if (newEnd > cap) newEnd = cap;

      // 1. Оплата — первой: если депозита не хватает, ничего не меняем.
      const depositAmount = Math.min(input.deposit_amount, input.price);
      const cashAmount = Math.max(0, input.price - depositAmount);
      let paymentId: string | null = null;
      let balanceAfter: number | null = null;
      if (cashAmount > 0 || depositAmount > 0) {
        const { data: pay, error: pErr } = await supabaseAdmin.rpc("record_payment_with_deposit", {
          p_organization_id: card.organization_id,
          p_child_id: card.child_id,
          p_received_by: user.id,
          p_club_card_id: card.id,
          p_amount: cashAmount,
          p_method: input.payment_method,
          p_use_deposit: depositAmount,
          p_comment: `Доп. занятия +${input.count} к абонементу${input.comment ? ` · ${input.comment}` : ""}`,
          p_idempotency_key: key,
        });
        if (pErr) {
          const msg = pErr.message ?? "";
          if (pErr.code === "23505" || msg.includes("duplicate key")) {
            return reply.code(200).send({ ok: true, duplicate: true });
          }
          if (msg.includes("deposit_insufficient")) {
            return reply.code(422).send({ error: "deposit_insufficient", message: "На депозите недостаточно средств" });
          }
          req.log.error({ err: pErr }, "add_lessons_payment_failed");
          return reply.code(500).send({ error: "payment_failed", message: msg });
        }
        const row = (Array.isArray(pay) ? pay[0] : pay) as { payment_id: string | null; balance_after: number | null } | null;
        paymentId = row?.payment_id ?? null;
        balanceAfter = row?.balance_after != null ? Number(row.balance_after) : null;
      }

      // 2. Карта: счётчик + срок. Истёкшая карта оживает.
      const newTotal = Number(card.total_lessons) + input.count;
      const newStatus = newEnd >= today
        ? (card.status === "frozen" ? "frozen" : "active")
        : card.status;
      const { error: uErr } = await supabaseAdmin
        .from("club_cards")
        .update({ total_lessons: newTotal, end_date: newEnd, status: newStatus })
        .eq("id", card.id);
      if (uErr) {
        req.log.error({ err: uErr, payment_id: paymentId }, "add_lessons_card_update_failed");
        return reply.code(500).send({ error: "update_failed", message: uErr.message });
      }

      // 3. Окно записи и занятия группы — до новой даты.
      if (target) {
        const patch: Record<string, unknown> = {};
        if (target.end_date == null || target.end_date < newEnd) patch.end_date = newEnd;
        if (target.archived_at && newEnd >= today) patch.archived_at = null;
        if (Object.keys(patch).length > 0) {
          await supabaseAdmin.from("enrollments").update(patch).eq("id", target.id);
        }
        if (newEnd >= today) {
          const gen = await ensureLessonsForGroup(target.group_id, today, newEnd, user.id);
          if (!gen.ok) req.log.warn({ err: gen }, "add_lessons_generate_failed");
          else if (gen.inserted > 0) req.log.info({ inserted: gen.inserted }, "add_lessons_generated");
        }
      }

      // 4. След в комментариях ребёнка.
      const payText = input.price > 0
        ? `Оплата ${input.price} с (${depositAmount > 0 ? `депозит ${depositAmount}` : ""}${depositAmount > 0 && cashAmount > 0 ? " + " : ""}${cashAmount > 0 ? `${input.payment_method === "cash" ? "наличные" : "терминал"} ${cashAmount}` : ""}).`
        : "Без оплаты (компенсация).";
      await supabaseAdmin.from("child_internal_notes").insert({
        organization_id: card.organization_id,
        child_id: card.child_id,
        author_id: user.id,
        text: `К абонементу ${card.type} добавлено ${input.count} занятий (${card.total_lessons} → ${newTotal}), срок до ${newEnd}${endSource === "estimate" ? " (оценка: у группы нет расписания)" : ""}. ${payText}${input.comment ? ` ${input.comment}` : ""}`,
      });

      const response = {
        ok: true,
        total_lessons: newTotal,
        end_date: newEnd,
        end_source: endSource,
        payment_id: paymentId,
        balance_after: balanceAfter,
      };
      await storeIdempotencyResponse(key, "/v1/cards/add-lessons", user.id, response);
      req.log.info({ card_id: card.id, count: input.count, end_date: newEnd }, "card_lessons_added");
      return reply.code(201).send(response);
    }
  );

  // Снять тренировки с абонемента («Удалить тренировки»).
  //
  // Запрос офиса 2026-09-02: старший менеджер выбирает из предстоящих
  // тренировок ребёнка те, что нужно убрать; они пропадают у ребёнка
  // (карточка, журнал, табель тренера, состав занятия — через
  // card_lesson_exclusions), а число занятий абонемента уменьшается на
  // столько же. Занятие группы для остальных детей остаётся.
  // Только предстоящие занятия в сроке карты без отметки. Идемпотентно.
  app.post(
    "/v1/cards/remove-lessons",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager"),
        requireIdempotencyKey,
      ],
    },
    async (req, reply) => {
      const parsed = removeLessonsSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const input = parsed.data;
      const user = req.user!;
      const key = req.idempotencyKey!;
      await supabaseAdmin.rpc("set_config", { setting_name: "app.actor_id", new_value: user.id, is_local: true } as never);

      const { data: card, error: cErr } = await supabaseAdmin
        .from("club_cards")
        .select("id, child_id, organization_id, type, status, start_date, end_date, section_id, total_lessons")
        .eq("id", input.card_id)
        .maybeSingle();
      if (cErr || !card) return reply.code(404).send({ error: "card_not_found" });
      if (card.status === "archived") {
        return reply.code(409).send({ error: "card_archived", message: "Абонемент отменён." });
      }
      const today = todayIsoBishkek();
      const ids = Array.from(new Set(input.lesson_ids));

      const [{ data: lessons }, { data: att }, { data: already }] = await Promise.all([
        supabaseAdmin
          .from("lessons")
          .select("id, date, status, group:groups!inner(section_id)")
          .in("id", ids),
        supabaseAdmin
          .from("attendance")
          .select("lesson_id")
          .eq("child_id", card.child_id)
          .in("lesson_id", ids),
        supabaseAdmin
          .from("card_lesson_exclusions")
          .select("lesson_id")
          .eq("child_id", card.child_id)
          .in("lesson_id", ids),
      ]);
      type LRow = { id: string; date: string; status: string; group?: { section_id?: string | null } | { section_id?: string | null }[] | null };
      const sectionOf = (g: LRow["group"]) => (Array.isArray(g) ? g[0]?.section_id : g?.section_id) ?? null;
      const marked = new Set((att ?? []).map((a: { lesson_id: string }) => a.lesson_id));
      const excluded = new Set((already ?? []).map((x: { lesson_id: string }) => x.lesson_id));

      const rejected: Array<{ lesson_id: string; reason: string }> = [];
      const accept: LRow[] = [];
      for (const id of ids) {
        const l = ((lessons ?? []) as LRow[]).find((x) => x.id === id);
        if (!l) { rejected.push({ lesson_id: id, reason: "not_found" }); continue; }
        if (excluded.has(id)) continue; // уже снято — повтор не ошибка
        if (l.date < today) { rejected.push({ lesson_id: id, reason: "past" }); continue; }
        if (l.date < card.start_date || l.date > card.end_date) { rejected.push({ lesson_id: id, reason: "outside_card" }); continue; }
        if (l.status === "cancelled" || l.status === "force_majeure") { rejected.push({ lesson_id: id, reason: "cancelled" }); continue; }
        if (card.section_id && sectionOf(l.group) && sectionOf(l.group) !== card.section_id) { rejected.push({ lesson_id: id, reason: "other_section" }); continue; }
        if (marked.has(id)) { rejected.push({ lesson_id: id, reason: "has_attendance" }); continue; }
        accept.push(l);
      }
      if (accept.length === 0) {
        return reply.code(409).send({
          error: "nothing_to_remove",
          message: "Ни одну из выбранных тренировок снять нельзя (прошла, вне срока абонемента или уже отмечена).",
          rejected,
        });
      }

      const { error: iErr } = await supabaseAdmin.from("card_lesson_exclusions").insert(
        accept.map((l) => ({
          organization_id: card.organization_id,
          club_card_id: card.id,
          child_id: card.child_id,
          lesson_id: l.id,
          reason: input.reason ?? null,
          created_by: user.id,
        })),
      );
      if (iErr) return reply.code(500).send({ error: "insert_failed", message: iErr.message });

      // Счётчик занятий уменьшается на число снятых (не ниже нуля).
      let newTotal: number | null = card.total_lessons;
      if (card.total_lessons != null) {
        newTotal = Math.max(0, Number(card.total_lessons) - accept.length);
        const { error: uErr } = await supabaseAdmin
          .from("club_cards")
          .update({ total_lessons: newTotal })
          .eq("id", card.id);
        if (uErr) return reply.code(500).send({ error: "update_failed", message: uErr.message });
      }

      const dates = accept.map((l) => l.date).sort();
      await supabaseAdmin.from("child_internal_notes").insert({
        organization_id: card.organization_id,
        child_id: card.child_id,
        author_id: user.id,
        text: `С абонемента ${card.type} снято ${accept.length} тренировок (${dates.join(", ")}). Занятий: ${card.total_lessons ?? "∞"} → ${newTotal ?? "∞"}.${input.reason ? ` Причина: ${input.reason}` : ""}`,
      });

      const response = { ok: true, removed: accept.length, total_lessons: newTotal, rejected };
      await storeIdempotencyResponse(key, "/v1/cards/remove-lessons", user.id, response);
      req.log.info({ card_id: card.id, removed: accept.length }, "card_lessons_removed");
      return reply.code(201).send(response);
    }
  );

  // Вернуть снятые тренировки: исключения удаляются, счётчик растёт обратно.
  app.post(
    "/v1/cards/restore-lessons",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager")] },
    async (req, reply) => {
      const parsed = restoreLessonsSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const input = parsed.data;
      const user = req.user!;
      await supabaseAdmin.rpc("set_config", { setting_name: "app.actor_id", new_value: user.id, is_local: true } as never);

      const { data: card, error: cErr } = await supabaseAdmin
        .from("club_cards")
        .select("id, child_id, organization_id, type, total_lessons")
        .eq("id", input.card_id)
        .maybeSingle();
      if (cErr || !card) return reply.code(404).send({ error: "card_not_found" });

      const { data: removedRows, error: dErr } = await supabaseAdmin
        .from("card_lesson_exclusions")
        .delete()
        .eq("club_card_id", card.id)
        .in("lesson_id", Array.from(new Set(input.lesson_ids)))
        .select("lesson_id");
      if (dErr) return reply.code(500).send({ error: "delete_failed", message: dErr.message });
      const n = removedRows?.length ?? 0;
      if (n === 0) return reply.code(200).send({ ok: true, restored: 0, total_lessons: card.total_lessons });

      let newTotal: number | null = card.total_lessons;
      if (card.total_lessons != null) {
        newTotal = Number(card.total_lessons) + n;
        const { error: uErr } = await supabaseAdmin.from("club_cards").update({ total_lessons: newTotal }).eq("id", card.id);
        if (uErr) return reply.code(500).send({ error: "update_failed", message: uErr.message });
      }
      await supabaseAdmin.from("child_internal_notes").insert({
        organization_id: card.organization_id,
        child_id: card.child_id,
        author_id: user.id,
        text: `Возвращено ${n} снятых тренировок абонемента ${card.type}. Занятий: ${card.total_lessons ?? "∞"} → ${newTotal ?? "∞"}.`,
      });
      req.log.info({ card_id: card.id, restored: n }, "card_lessons_restored");
      return reply.code(200).send({ ok: true, restored: n, total_lessons: newTotal });
    }
  );

  // Закрыть абонемент досрочно (заблокировать) — С СОХРАНЕНИЕМ истории.
  //
  // Запрос старшего менеджера 2026-09-02: «в любой момент заблокировать
  // актуальную карту, сохранив когда был / когда пропустил, и привязать
  // новый абонемент» — ребёнок переходит в другую группу или на другое
  // время. «Отменить» (archived) для этого не годится: архивная карта
  // выпадает из табелей и истории посещений. Здесь карта остаётся
  // видимой: срок обрезается сегодняшним (или вчерашним) числом, статус
  // expired, остаток фиксируется. Окно записи в группах секции сжимается
  // до той же даты — дальше по этой карте ячеек нет; при продаже нового
  // абонемента окно расширится заново.
  app.post(
    "/v1/cards/close",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      const parsed = closeSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const user = req.user!;
      await supabaseAdmin.rpc("set_config", { setting_name: "app.actor_id", new_value: user.id, is_local: true } as never);

      const { data: card, error: cErr } = await supabaseAdmin
        .from("club_cards")
        .select("id, child_id, type, status, start_date, end_date, section_id, total_lessons")
        .eq("id", parsed.data.card_id)
        .maybeSingle();
      if (cErr || !card) return reply.code(404).send({ error: "card_not_found" });
      if (card.status === "archived") {
        return reply.code(409).send({ error: "card_archived", message: "Абонемент уже отменён." });
      }
      const today = todayIsoBishkek();
      if (card.start_date > today) {
        return reply.code(409).send({
          error: "not_started",
          message: "Абонемент ещё не начался — для него используйте «Отменить».",
        });
      }
      if (card.end_date < today) {
        return reply.code(409).send({ error: "already_ended", message: "Срок абонемента уже закончился." });
      }

      // Если сегодня ребёнок уже был на занятии — закрываем сегодняшним
      // числом (иначе эта отметка выпадет из срока карты и не спишется).
      const { data: todayAtt } = await supabaseAdmin
        .from("attendance")
        .select("id, lesson:lessons!inner(date)")
        .eq("child_id", card.child_id)
        .eq("lesson.date", today)
        .limit(1);
      let newEnd = (todayAtt ?? []).length > 0 ? today : addDaysIso(today, -1);
      if (newEnd < card.start_date) newEnd = card.start_date;

      const { error: uErr } = await supabaseAdmin
        .from("club_cards")
        .update({ end_date: newEnd, status: "expired" })
        .eq("id", card.id);
      if (uErr) return reply.code(500).send({ error: "close_failed", message: uErr.message });

      // Окно записи в группах секции — не дальше даты закрытия.
      const { data: enrRows } = await supabaseAdmin
        .from("enrollments")
        .select("id, end_date, group:groups!inner(section_id)")
        .eq("child_id", card.child_id)
        .is("archived_at", null);
      type EnrRow = { id: string; end_date: string | null; group?: { section_id?: string } | { section_id?: string }[] | null };
      const sectionOf = (g: EnrRow["group"]) => (Array.isArray(g) ? g[0]?.section_id : g?.section_id);
      const toShrink = ((enrRows ?? []) as EnrRow[]).filter((e) =>
        (!card.section_id || sectionOf(e.group) === card.section_id)
        && (e.end_date == null || e.end_date > newEnd));
      for (const e of toShrink) {
        await supabaseAdmin.from("enrollments").update({ end_date: newEnd }).eq("id", e.id);
      }

      // Причина — в комментарии ребёнка: видна офису во вкладке «Комментарии».
      const { data: me } = await supabaseAdmin.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
      await supabaseAdmin.from("child_internal_notes").insert({
        organization_id: me?.organization_id ?? user.organization_id,
        child_id: card.child_id,
        author_id: user.id,
        text: `Абонемент ${card.type}${card.total_lessons ? ` · ${card.total_lessons}` : ""} (${card.start_date} → ${card.end_date}) закрыт досрочно ${newEnd}. Причина: ${parsed.data.reason}`,
      });

      req.log.info({ card_id: card.id, end_date: newEnd, enrollments_shrunk: toShrink.length }, "card_closed");
      return reply.code(200).send({ ok: true, end_date: newEnd });
    }
  );

  // Cancel/archive card (admin/manager only)
  app.post(
    "/v1/cards/cancel",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      const parsed = cancelSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.flatten() });
      const user = req.user!;
      await supabaseAdmin.rpc("set_config", { setting_name: "app.actor_id", new_value: user.id, is_local: true } as never);

      const { error } = await supabaseAdmin
        .from("club_cards")
        .update({ status: "archived" })
        .eq("id", parsed.data.card_id);
      if (error) return reply.code(500).send({ error: "cancel_failed", message: error.message });

      // Audit comment via payments? skip — audit_log triggers fire on update.
      return reply.code(200).send({ ok: true });
    }
  );

};
