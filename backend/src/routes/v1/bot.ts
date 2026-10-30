import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../lib/env.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { handleBotLead } from "../../lib/kommo-bot.js";

// Справочник для ИИ-агента Nextbot в Instagram (docs/Nextbot_агент.md).
// Только чтение и только то, что можно сказать клиенту: секции, цены,
// группы с расписанием, тренеры. Ни учеников, ни телефонов, ни ставок.
// Ответы короткие и уже «человеческие»: агент пересказывает их клиенту.

const keyMatches = (given: unknown) => {
  const expected = env.NEXTBOT_API_KEY;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Без ключа — 404, как у вебхука Kommo: адрес не должен выдавать себя.
const requireBotKey = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!keyMatches(req.headers["x-bot-key"])) return reply.code(404).send({ error: "not_found" });
};

// Организация та же, в которую синхронизируется Kommo: агент работает в
// его воронке. Пусто — единственная в базе.
let organizationId: string | undefined;
const organization = async () => {
  if (organizationId) return organizationId;
  if (env.KOMMO_ORGANIZATION_ID) return (organizationId = env.KOMMO_ORGANIZATION_ID);
  const { data, error } = await supabaseAdmin.from("organizations").select("id").limit(2);
  if (error) throw error;
  const only = data?.length === 1 ? data[0] : undefined;
  if (!only) throw new Error("bot_organization_ambiguous: задайте KOMMO_ORGANIZATION_ID");
  return (organizationId = only.id as string);
};

const must = <T,>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
};

// ----------------------------------------------------------------------
// Секция словами клиента
//
// Клиент пишет «борьба», «күрөш», «бокс для сына». Сначала ищем по
// синонимам, потом по вхождению названия. Кикбоксинг стоит раньше бокса:
// в «кикбоксинг» есть «бокс».
// ----------------------------------------------------------------------
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/ё/g, "е").trim();

const ALIASES: { ask: RegExp; name: RegExp; not?: RegExp }[] = [
  { ask: /кик|kick/, name: /кик|kick/ },
  { ask: /бокс|box|мушташ/, name: /бокс|box/, not: /кик|kick/ },
  { ask: /мм[аa]|mma|смешан|без правил/, name: /мма|mma/ },
  { ask: /вольн|борьб|борц|күрөш|курош|wrestl/, name: /вольн|борьб|күрөш|wrestl/ },
  { ask: /дзю|дзу|джу|judo/, name: /дзю|judo/ },
  { ask: /тхэк|таэк|таек|тхек|тэкв|taekw/, name: /тхэк|таэк|таек|taekw/ },
  { ask: /фитнес|fitness|тренаж|спортзал|качал|gym|похуд/, name: /фитнес|fitness|тренаж/ },
];

type SectionRow = { id: string; name_ru: string; name_ky: string | null; category: string };

export const matchSections = (all: SectionRow[], asked: string): SectionRow[] => {
  const q = norm(asked);
  const alias = ALIASES.find((a) => a.ask.test(q));
  if (alias) {
    return all.filter((s) => {
      const name = norm(`${s.name_ru} ${s.name_ky}`);
      return alias.name.test(name) && !alias.not?.test(name);
    });
  }
  return all.filter((s) => {
    const ru = norm(s.name_ru);
    const ky = norm(s.name_ky);
    return ru.includes(q) || q.includes(ru) || (ky !== "" && (ky.includes(q) || q.includes(ky)));
  });
};

const loadSections = async (org: string) =>
  must(
    await supabaseAdmin
      .from("sections")
      .select("id, name_ru, name_ky, category")
      .eq("organization_id", org)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name_ru"),
  ) as SectionRow[];

// Секция не нашлась — отвечаем 200 со списком: скрипт агента не падает на
// raise_for_status, а агент переспрашивает клиента.
const notFound = (all: SectionRow[]) => ({
  error: "section_not_found",
  message: "Такой секции нет. Уточни у клиента, какая из списка ему нужна.",
  sections: all.map((s) => s.name_ru),
});

// ----------------------------------------------------------------------
// Группы
// ----------------------------------------------------------------------
const DAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const AUDIENCE: Record<string, string> = { kids: "дети", adults: "взрослые", mixed: "дети и взрослые" };

// Места словами, без точного числа: «в группе трое» отпугивает.
const places = (free: number, capacity: number) => {
  if (free <= 0) return "мест нет";
  if (free <= Math.max(2, Math.ceil(capacity * 0.15))) return "мало мест";
  return "есть места";
};

const ages = (min: number | null, max: number | null) => {
  if (min != null && max != null) return `${min}–${max} лет`;
  if (min != null) return `от ${min} лет`;
  if (max != null) return `до ${max} лет`;
  return null;
};

type GroupRow = {
  id: string;
  name: string;
  section_id: string;
  coach_id: string | null;
  audience: string;
  age_min: number | null;
  age_max: number | null;
  level: string | null;
  starts_on: string | null;
  ends_on: string | null;
  coach: { profile: { full_name: string } | null } | null;
  schedule: { day_of_week: number; start_time: string; duration_min: number | null }[];
};

const loadGroups = async (org: string, sectionIds: string[]) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = must(
    await supabaseAdmin
      .from("groups")
      .select(
        "id, name, section_id, coach_id, audience, age_min, age_max, level, starts_on, ends_on, " +
          "coach:coaches(profile:profiles(full_name)), schedule:group_schedule(day_of_week, start_time, duration_min)",
      )
      .eq("organization_id", org)
      .in("section_id", sectionIds)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
  ) as unknown as GroupRow[];
  return rows.filter((g) => !g.ends_on || g.ends_on >= today);
};

const audienceParam = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (/^(kid|child|дет|ребен|ребён|бала)/.test(v) ? "kids" : /^(adult|взросл|чоң)/.test(v) ? "adults" : null))
  .optional();

const catalogQuery = z.object({ section: z.string().trim().min(1).max(80).optional() });

// Модель часто присылает пустые строки и числа строкой — пустое считаем
// отсутствующим, возраст приводим к числу, а неразобранный — отбрасываем.
const text = (max: number) =>
  z.preprocess((v) => (v == null ? undefined : String(v).trim() || undefined), z.string().max(max).optional());
const TEMPERATURE: Record<string, "hot" | "warm" | "cold"> = {
  hot: "hot", warm: "warm", cold: "cold",
  горячий: "hot", тёплый: "warm", теплый: "warm", холодный: "cold",
  ысык: "hot", жылуу: "warm", суук: "cold",
};
const leadBody = z.object({
  event: z.enum(["info", "temperature", "trial", "handoff"]),
  test: z.boolean().optional(),
  messenger: text(60),
  instagram_username: text(100),
  instagram_user_id: text(100),
  profile_link: text(300),
  dialog_link: text(300),
  client_name: text(100),
  phone: text(40),
  student_name: text(100),
  student_age: z.preprocess((v) => {
    const n = Number.parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) && n > 0 && n < 100 ? n : undefined;
  }, z.number().int().optional()),
  section: text(80),
  temperature: z.preprocess((v) => (v == null ? undefined : TEMPERATURE[String(v).trim().toLowerCase()]),
    z.enum(["hot", "warm", "cold"]).optional()),
  reason: text(500),
  preferred_time: text(300),
});
const scheduleQuery = z.object({
  section: z.string().trim().min(1).max(80),
  age: z.coerce.number().int().min(1).max(99).optional(),
  audience: audienceParam,
});

export const botRoutes = async (app: FastifyInstance) => {
  const opts = {
    preHandler: [requireBotKey],
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  };

  // GET /v1/bot/sections — какие секции есть и для кого.
  app.get("/v1/bot/sections", opts, async () => {
    const org = await organization();
    const sections = await loadSections(org);
    const groups = await loadGroups(org, sections.map((s) => s.id));
    return {
      sections: sections.map((s) => {
        const own = groups.filter((g) => g.section_id === s.id);
        const mins = own.map((g) => g.age_min).filter((v): v is number => v != null);
        const maxs = own.map((g) => g.age_max).filter((v): v is number => v != null);
        return {
          name: s.name_ru,
          name_ky: s.name_ky,
          kids: own.some((g) => g.audience !== "adults"),
          adults: own.some((g) => g.audience !== "kids"),
          ages: ages(mins.length ? Math.min(...mins) : null, maxs.length && maxs.length === own.length ? Math.max(...maxs) : null),
          groups: own.length,
        };
      }),
    };
  });

  // GET /v1/bot/prices?section= — пробное и разовое по секции (section_price
  // через v_section_prices) и абонементы из каталога.
  app.get("/v1/bot/prices", opts, async (req, reply) => {
    const parsed = catalogQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.issues });
    const org = await organization();
    const all = await loadSections(org);
    const picked = parsed.data.section ? matchSections(all, parsed.data.section) : all;
    if (!picked.length) return notFound(all);

    const [prices, plans] = await Promise.all([
      supabaseAdmin
        .from("v_section_prices")
        .select("section_id, name_ru, trial_price, single_price")
        .in("section_id", picked.map((s) => s.id)),
      supabaseAdmin
        .from("card_plans")
        .select("name_ru, name_ky, type, duration_days, lessons_count, price")
        .eq("organization_id", org)
        .eq("is_active", true)
        .not("type", "in", "(trial,single,personal)")
        .order("sort_order"),
    ]);
    type PriceRow = { section_id: string; name_ru: string; trial_price: number | null; single_price: number | null };
    type PlanRow = { name_ru: string; name_ky: string | null; type: string; duration_days: number | null; lessons_count: number | null; price: number };

    return {
      currency: "сом",
      sections: (must(prices) as PriceRow[]).map((p) => ({
        section: p.name_ru,
        trial: p.trial_price == null ? null : Number(p.trial_price),
        single: p.single_price == null ? null : Number(p.single_price),
      })),
      subscriptions: (must(plans) as PlanRow[]).map((p) => ({
        name: p.name_ru,
        name_ky: p.name_ky,
        months: p.duration_days ? Math.max(1, Math.round(p.duration_days / 30)) : null,
        lessons: p.lessons_count ?? "безлимит",
        price: Number(p.price),
      })),
      note: "Абонемент выбирай по названию: «Детский» — для детей, «Взрослый» — для взрослых, «Фитнес» — для фитнес-зоны. Пакеты на 3, 6 и 12 месяцев — для любой секции.",
    };
  });

  // GET /v1/bot/schedule?section=&age=&audience= — группы секции: дни,
  // время, тренер, возраст, места.
  app.get("/v1/bot/schedule", opts, async (req, reply) => {
    const parsed = scheduleQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.issues });
    const { section, age, audience } = parsed.data;
    const org = await organization();
    const all = await loadSections(org);
    const picked = matchSections(all, section);
    if (!picked.length) return notFound(all);

    const groups = (await loadGroups(org, picked.map((s) => s.id))).filter((g) => {
      if (age != null && ((g.age_min != null && age < g.age_min) || (g.age_max != null && age > g.age_max))) return false;
      if (audience === "kids" && g.audience === "adults") return false;
      if (audience === "adults" && g.audience === "kids") return false;
      return true;
    });
    const occupancy = groups.length
      ? (must(
          await supabaseAdmin.from("v_group_occupancy").select("group_id, max_capacity, free").in("group_id", groups.map((g) => g.id)),
        ) as { group_id: string; max_capacity: number; free: number }[])
      : [];
    const byGroup = new Map(occupancy.map((o) => [o.group_id, o]));
    const sectionName = new Map(picked.map((s) => [s.id, s.name_ru]));

    return {
      groups: groups.map((g) => {
        const o = byGroup.get(g.id);
        return {
          section: sectionName.get(g.section_id),
          group: g.name,
          for: AUDIENCE[g.audience] ?? g.audience,
          ages: ages(g.age_min, g.age_max),
          level: g.level,
          coach: g.coach?.profile?.full_name ?? null,
          schedule: [...g.schedule]
            .sort((a, b) => (a.day_of_week + 6) % 7 - (b.day_of_week + 6) % 7 || a.start_time.localeCompare(b.start_time))
            .map((s) => ({ day: DAYS[s.day_of_week], time: s.start_time.slice(0, 5), minutes: s.duration_min })),
          starts_on: g.starts_on && g.starts_on > new Date().toISOString().slice(0, 10) ? g.starts_on : null,
          places: o ? places(Number(o.free), Number(o.max_capacity)) : "есть места",
        };
      }),
      ...(groups.length ? {} : { message: "Подходящих групп нет. Предложи другую секцию или передай менеджеру." }),
    };
  });

  // GET /v1/bot/coaches?section= — тренеры секции: закреплённые за секцией
  // и ведущие её группы.
  app.get("/v1/bot/coaches", opts, async (req, reply) => {
    const parsed = scheduleQuery.pick({ section: true }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.issues });
    const org = await organization();
    const all = await loadSections(org);
    const picked = matchSections(all, parsed.data.section);
    if (!picked.length) return notFound(all);
    const sectionIds = picked.map((s) => s.id);

    const [linked, groups] = await Promise.all([
      supabaseAdmin.from("section_coaches").select("coach_id").in("section_id", sectionIds),
      loadGroups(org, sectionIds),
    ]);
    const ids = [
      ...new Set([
        ...(must(linked) as { coach_id: string }[]).map((r) => r.coach_id),
        ...groups.map((g) => g.coach_id).filter((v): v is string => v != null),
      ]),
    ];
    if (!ids.length) return { coaches: [] };

    type CoachRow = {
      bio: string | null;
      achievements: string | null;
      experience_years: number | null;
      profile: { full_name: string; is_active: boolean; deleted_at: string | null } | null;
    };
    const coaches = must(
      await supabaseAdmin
        .from("coaches")
        .select("bio, achievements, experience_years, profile:profiles(full_name, is_active, deleted_at)")
        .in("id", ids),
    ) as unknown as CoachRow[];

    return {
      coaches: coaches
        .filter((c) => c.profile?.is_active && !c.profile.deleted_at)
        .map((c) => ({
          name: c.profile!.full_name,
          experience_years: c.experience_years || null,
          achievements: c.achievements || null,
          about: c.bio || null,
        })),
    };
  });

  // POST /v1/bot/lead — агент сообщает, что узнал о клиенте: данные,
  // горячесть, желание на пробное, просьбу позвать менеджера. Пишется в
  // сделку Kommo и в leads (lib/kommo-bot.ts). Ответ агенту короткий: он
  // не пересказывает его клиенту.
  app.post("/v1/bot/lead", opts, async (req, reply) => {
    const parsed = leadBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.issues });
    const { messenger, ...input } = parsed.data;
    // Пишем только переписку из Instagram. Тестовый чат Nextbot и другие
    // каналы — пробный прогон: поиск без записи.
    const test = input.test ?? !/insta/i.test(messenger ?? "");
    // messenger — первое, что смотреть, если из Instagram ничего не пишется.
    req.log.info({ event: input.event, messenger: messenger ?? null, test }, "bot_lead_call");
    const result = await handleBotLead(await organization(), { ...input, test }, req.log);
    return { ...result, messenger: messenger ?? null };
  });
};
