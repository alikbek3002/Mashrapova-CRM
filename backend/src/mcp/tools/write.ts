// Инструменты записи. Деньги и абонементы идут через маршруты /v1/*
// (ctx.api → app.inject) — те же проверки ролей, схемы, RPC и
// идемпотентность, что у кассы в интерфейсе. Клиенты и лиды интерфейс
// пишет напрямую в Supabase под RLS — так же делаем и здесь (ctx.db).
// Каждый вызов попадает в журнал mcp_audit (см. server.ts).
import { z } from "zod";
import { normalizeE164KG } from "../../lib/phone.js";
import {
  ok, must, today, addMonthsIso, addDaysIso, firstLessonOnOrAfter, nthLessonDate, ToolError, type Ctx,
} from "../context.js";
import type { ToolDef } from "./types.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");
const method = z.enum(["cash", "terminal", "transfer"]).describe("cash — наличные, terminal — терминал, transfer — перевод");

// Тот же список, что frontend/src/shared/sources.ts и CHECK в базе.
const SOURCES = [
  "target", "instagram", "tiktok", "blogger", "maps", "messenger",
  "referral", "sibling", "returning", "direct", "event", "offline_ads", "other",
] as const;
const sourceHelp =
  "Откуда пришёл: target — таргет Instagram, instagram — страница/сторис, tiktok, blogger — блогер, maps — 2ГИС/Google Карты, messenger — WhatsApp/Telegram, referral — рекомендация, sibling — брат/сестра уже занимается, returning — занимался раньше, direct — пришёл сам, event — соревнования, offline_ads — листовки/баннер, other — другое";

const CARD_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, half_year: 6, nine_month: 9, annual: 12 };

const phoneOrThrow = (p: string) => {
  try { return normalizeE164KG(p); } catch { throw new ToolError(`Телефон «${p}» не похож на кыргызский номер (+996 XXX XXX XXX)`); }
};

const childName = async (ctx: Ctx, id: string) => {
  const c = must(await ctx.db.from("children").select("full_name").eq("id", id).maybeSingle()) as { full_name: string } | null;
  if (!c) throw new ToolError("Ученик не найден");
  return c.full_name;
};

export const writeTools: ToolDef[] = [
  {
    name: "client_create",
    title: "Новый клиент",
    description:
      "Завести нового ученика вместе с семьёй (как «Новый клиент» в CRM). Перед вызовом проверь через clients_search, что такого ученика ещё нет. Абонемент продаётся отдельно — card_sell.",
    write: true,
    input: {
      child_full_name: z.string().trim().min(2).describe("ФИО ребёнка/клиента"),
      birth_date: date.optional(),
      parent_name: z.string().trim().min(2).optional().describe("Имя родителя (для взрослого клиента можно не указывать)"),
      parent_phone: z.string().min(7).describe("Телефон родителя или самого клиента"),
      parent_is: z.enum(["mother", "father"]).default("mother").describe("Кто этот родитель"),
      source: z.enum(SOURCES).optional().describe(sourceHelp),
      responsible_manager_id: z.string().uuid().optional().describe("Ответственный менеджер (id из reference_data). По умолчанию — вы"),
      comment: z.string().max(500).optional(),
    },
    run: async (ctx, a) => {
      const phone = phoneOrThrow(a.parent_phone);
      const manager = a.responsible_manager_id ?? ctx.user.id;
      const fam = must(await ctx.db.from("families").insert({
        organization_id: ctx.user.organization_id,
        responsible_manager_id: manager,
        comment: a.comment ?? null,
        ...(a.parent_is === "father"
          ? { father_name: a.parent_name ?? null, father_phone: phone }
          : { mother_name: a.parent_name ?? null, mother_phone: phone }),
      }).select("id").single()) as { id: string };
      const child = must(await ctx.db.from("children").insert({
        organization_id: ctx.user.organization_id,
        family_id: fam.id,
        full_name: a.child_full_name,
        birth_date: a.birth_date ?? null,
        responsible_manager_id: manager,
        source: a.source ?? null,
      }).select("id, full_name, status").single());
      return ok(`Клиент «${a.child_full_name}» заведён. Чтобы записать в группу, продайте абонемент (card_sell).`, { child, family_id: fam.id });
    },
  },
  {
    name: "client_update",
    title: "Изменить клиента",
    description: "Поправить данные ученика или телефоны родителей. Меняются только переданные поля.",
    write: true,
    input: {
      child_id: z.string().uuid(),
      full_name: z.string().trim().min(2).optional(),
      birth_date: date.optional(),
      source: z.enum(SOURCES).optional().describe(sourceHelp),
      responsible_manager_id: z.string().uuid().optional(),
      mother_name: z.string().optional(), mother_phone: z.string().optional(),
      father_name: z.string().optional(), father_phone: z.string().optional(),
    },
    run: async (ctx, a) => {
      const child = must(await ctx.db.from("children").select("id, family_id, full_name").eq("id", a.child_id).maybeSingle()) as { id: string; family_id: string; full_name: string } | null;
      if (!child) throw new ToolError("Ученик не найден");
      const cPatch: Record<string, unknown> = {};
      for (const k of ["full_name", "birth_date", "source", "responsible_manager_id"] as const) if (a[k] !== undefined) cPatch[k] = a[k];
      const fPatch: Record<string, unknown> = {};
      if (a.mother_name !== undefined) fPatch.mother_name = a.mother_name;
      if (a.father_name !== undefined) fPatch.father_name = a.father_name;
      if (a.mother_phone !== undefined) fPatch.mother_phone = phoneOrThrow(a.mother_phone);
      if (a.father_phone !== undefined) fPatch.father_phone = phoneOrThrow(a.father_phone);
      if (!Object.keys(cPatch).length && !Object.keys(fPatch).length) throw new ToolError("Нечего менять");
      if (Object.keys(cPatch).length) must(await ctx.db.from("children").update(cPatch).eq("id", a.child_id).select("id").single());
      if (Object.keys(fPatch).length) must(await ctx.db.from("families").update(fPatch).eq("id", child.family_id).select("id").single());
      return ok(`Данные «${child.full_name}» обновлены`, { child: cPatch, family: fPatch });
    },
  },
  {
    name: "lead_create",
    title: "Новый лид",
    description: "Записать заявку, которой нет в Kommo (например, пришёл в зал или позвонил). Заявки из Instagram/WhatsApp приходят из Kommo сами — их не дублируй.",
    write: true,
    input: {
      parent_name: z.string().trim().min(2).describe("Имя того, кто обратился"),
      phone: z.string().min(7),
      child_name: z.string().optional(),
      child_age: z.number().int().min(1).max(80).optional(),
      section_interest_id: z.string().uuid().optional().describe("Интересующая секция (id из reference_data)"),
      source: z.enum(SOURCES).optional().describe(sourceHelp),
      responsible_manager_id: z.string().uuid().optional().describe("По умолчанию — вы"),
      comment: z.string().max(1000).optional(),
    },
    run: async (ctx, a) => {
      const lead = must(await ctx.db.from("leads").insert({
        organization_id: ctx.user.organization_id,
        parent_name: a.parent_name,
        phone: phoneOrThrow(a.phone),
        child_name: a.child_name ?? null,
        child_age: a.child_age ?? null,
        section_interest_id: a.section_interest_id ?? null,
        source: a.source ?? null,
        responsible_manager_id: a.responsible_manager_id ?? ctx.user.id,
        comment: a.comment ?? null,
        stage: "new",
      }).select("id, stage, created_at").single());
      return ok(`Лид «${a.parent_name}» создан`, lead);
    },
  },
  {
    name: "lead_update",
    title: "Изменить лид",
    description:
      "Изменить лид: комментарий, ответственного, этап воронки, причину отказа. Этап лида из Kommo здесь не меняется — его перезапишет синхронизация; его двигают в Kommo.",
    write: true,
    input: {
      lead_id: z.string().uuid(),
      stage: z.enum(["new", "contacted", "trial_booked", "trial_attended", "no_show", "converted", "lost", "waiting"]).optional(),
      comment: z.string().max(1000).optional(),
      responsible_manager_id: z.string().uuid().optional(),
      lost_reason: z.string().max(300).optional().describe("Причина отказа (для этапа lost)"),
      trial_at: z.string().optional().describe("Дата и время пробной, ISO 8601"),
    },
    run: async (ctx, a) => {
      const lead = must(await ctx.db.from("leads").select("id, parent_name, kommo_lead_id").eq("id", a.lead_id).maybeSingle()) as { id: string; parent_name: string; kommo_lead_id: number | null } | null;
      if (!lead) throw new ToolError("Лид не найден");
      if (a.stage && lead.kommo_lead_id) {
        throw new ToolError("Это лид из Kommo: этап меняется в Kommo, иначе синхронизация вернёт его обратно через 5 минут. Комментарий и ответственного здесь поменять можно.");
      }
      const patch: Record<string, unknown> = {};
      for (const k of ["stage", "comment", "responsible_manager_id", "lost_reason", "trial_at"] as const) if (a[k] !== undefined) patch[k] = a[k];
      if (!Object.keys(patch).length) throw new ToolError("Нечего менять");
      const row = must(await ctx.db.from("leads").update(patch).eq("id", a.lead_id).select("id, stage, comment, responsible_manager_id").single());
      return ok(`Лид «${lead.parent_name}» обновлён`, row);
    },
  },
  {
    name: "payment_add",
    title: "Принять оплату",
    description:
      "Принять оплату от клиента (доплата долга по абонементу или разовая услуга). Можно часть списать с депозита (use_deposit). Перед вызовом назови человеку сумму, ученика и способ — и дождись подтверждения.",
    write: true,
    input: {
      child_id: z.string().uuid(),
      club_card_id: z.string().uuid().optional().describe("Абонемент, по которому платят (из client_card). Без него — оплата без привязки"),
      amount: z.number().nonnegative().describe("Сумма наличными/терминалом, сом"),
      method,
      use_deposit: z.number().nonnegative().default(0).describe("Сколько дополнительно списать с депозита"),
      comment: z.string().max(500).optional(),
    },
    run: async (ctx, a) => {
      const name = await childName(ctx, a.child_id);
      const res = await ctx.api("POST", "/v1/payments", a, { idempotent: true });
      return ok(`Оплата ${a.amount} сом (${({ cash: "наличные", terminal: "терминал", transfer: "перевод" } as Record<string, string>)[a.method]}) от «${name}» принята`, res);
    },
  },
  {
    name: "card_sell",
    title: "Продать абонемент",
    description:
      "Продать абонемент по тарифу из справочника (card_plans в reference_data) и сразу записать в группу. Срок считается как в кассе: пакет на месяцы — календарный («1 месяц» = с 13 октября по 13 ноября), но не короче, чем нужно на все занятия по расписанию; разовое и пробное — до N-го занятия. Если оплачено меньше цены — остаток станет долгом. Перед вызовом назови человеку тариф, цену, скидку, дату старта и группу — и дождись подтверждения.",
    write: true,
    input: {
      child_id: z.string().uuid(),
      plan_id: z.string().uuid().describe("Тариф из card_plans"),
      section_id: z.string().uuid().describe("Секция"),
      group_id: z.string().uuid().optional().describe("Группа, куда записать (из reference_data)"),
      start_date: date.optional().describe("С какого дня. С группой — первая тренировка с этой даты. По умолчанию — сегодня"),
      payment_method: method,
      paid_amount: z.number().nonnegative().optional().describe("Сколько платят сейчас наличными/терминалом. По умолчанию — вся цена после скидки и депозита"),
      deposit_amount: z.number().nonnegative().default(0).describe("Сколько списать с депозита"),
      discount_pct: z.number().min(0).max(100).default(0),
      discount_reason: z.string().optional().describe("Обязательна, если есть скидка"),
    },
    run: async (ctx, a) => {
      const name = await childName(ctx, a.child_id);
      const plan = must(await ctx.db.from("card_plans").select("id, name_ru, type, lessons_count, duration_days, price, freeze_quota").eq("id", a.plan_id).maybeSingle()) as
        { id: string; name_ru: string; type: string; lessons_count: number; duration_days: number; price: number; freeze_quota: number } | null;
      if (!plan) throw new ToolError("Тариф не найден — возьми id из reference_data → card_plans");
      if (a.discount_pct > 0 && !a.discount_reason?.trim()) throw new ToolError("Укажи причину скидки (discount_reason)");

      const schedule = a.group_id
        ? must(await ctx.db.from("group_schedule").select("day_of_week").eq("group_id", a.group_id)) as { day_of_week: number }[]
        : [];
      const from = a.start_date ?? today();
      const hasWindow = schedule.length > 0;
      const start = hasWindow ? firstLessonOnOrAfter(from, schedule) ?? from : from;
      const months = CARD_MONTHS[plan.type];
      const periodEnd = months ? addMonthsIso(start, months) : addDaysIso(start, plan.duration_days ?? 30);
      const nth = hasWindow ? nthLessonDate(start, plan.lessons_count, schedule) : null;
      const end = months ? (nth && nth > periodEnd ? nth : periodEnd) : (nth ?? periodEnd);

      const price = Number(plan.price);
      const final = Math.round(price * (1 - a.discount_pct / 100));
      const cash = Math.min(a.paid_amount ?? Math.max(0, final - a.deposit_amount), Math.max(0, final - a.deposit_amount));

      const res = await ctx.api("POST", "/v1/cards/sell", {
        child_id: a.child_id,
        type: plan.type,
        total_lessons: plan.lessons_count,
        plan_id: plan.id,
        duration_days: plan.duration_days,
        freeze_quota: plan.freeze_quota ?? 0,
        price,
        discount_pct: a.discount_pct,
        discount_reason: a.discount_reason?.trim() || null,
        start_date: start,
        end_date: end,
        payment_method: a.payment_method,
        section_id: a.section_id,
        group_id: a.group_id ?? null,
        enrollment_start_date: hasWindow ? start : null,
        enrollment_end_date: hasWindow ? end : null,
        deposit_amount: a.deposit_amount,
        cash_amount: cash,
      }, { idempotent: true });
      const debt = Math.max(0, final - a.deposit_amount - cash);
      return ok(
        `«${name}»: продан «${plan.name_ru}» с ${start} по ${end}, цена ${final} сом, оплачено ${cash + a.deposit_amount}${debt ? `, долг ${debt}` : ""}`,
        res,
      );
    },
  },
  {
    name: "card_extend",
    title: "Продлить срок абонемента",
    description: "Перенести дату окончания абонемента (без доплаты). Для продления с оплатой продай новый абонемент (card_sell).",
    write: true,
    input: { card_id: z.string().uuid(), new_end_date: date },
    run: async (ctx, a) => ok(`Срок абонемента продлён до ${a.new_end_date}`, await ctx.api("POST", "/v1/cards/extend", a)),
  },
  {
    name: "freeze_create",
    title: "Заморозить абонемент",
    description: "Создать заморозку абонемента на даты. Лимит заморозок по тарифу проверяет база; заявку затем подтверждают (freeze_approve).",
    write: true,
    input: { child_id: z.string().uuid(), club_card_id: z.string().uuid(), reason: z.string().min(1).max(500), start_date: date, end_date: date },
    run: async (ctx, a) => ok(`Заморозка с ${a.start_date} по ${a.end_date} создана`, await ctx.api("POST", "/v1/freezes", a)),
  },
  {
    name: "freeze_approve",
    title: "Подтвердить заморозку",
    description: "Подтвердить заявку на заморозку (например, от тренера). Можно поправить даты.",
    write: true,
    input: { freeze_id: z.string().uuid(), start_date: date.optional(), end_date: date.optional() },
    run: async (ctx, a) => {
      const { freeze_id, ...body } = a;
      return ok("Заморозка подтверждена", await ctx.api("POST", `/v1/freezes/${freeze_id}/approve`, body));
    },
  },
  {
    name: "deposit_topup",
    title: "Пополнить депозит",
    description: "Положить деньги на депозит клиента (аванс, из которого потом оплачиваются абонементы). Назови сумму и ученика и дождись подтверждения.",
    write: true,
    input: { child_id: z.string().uuid(), amount: z.number().positive(), method, comment: z.string().max(500).optional() },
    run: async (ctx, a) => {
      const name = await childName(ctx, a.child_id);
      return ok(`Депозит «${name}» пополнен на ${a.amount} сом`, await ctx.api("POST", "/v1/deposits/topup", a, { idempotent: true }));
    },
  },
];
