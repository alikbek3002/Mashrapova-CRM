// Инструменты чтения. Все расчёты — те же SQL-функции и представления,
// что у админки (director_dashboard, manager_kpi, kommo_report, …):
// цифры в чате совпадают с цифрами на экране.
import { z } from "zod";
import { ok, must, money, today, monthStart, ToolError, type Ctx } from "../context.js";
import type { ToolDef } from "./types.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");
const period = {
  from: date.optional().describe("Начало периода, ГГГГ-ММ-ДД. По умолчанию — 1-е число текущего месяца"),
  to: date.optional().describe("Конец периода включительно, ГГГГ-ММ-ДД. По умолчанию — сегодня"),
};
const span = (a: { from?: string; to?: string }) => ({ from: a.from ?? monthStart(), to: a.to ?? today() });

// Системные продажи начались 2026-08-20; более ранние карты — импорт,
// долг по ним без единой оплаты неизвестен (как в queries.ts → cardDebtOf).
const SYSTEM_SALES_SINCE = "2026-08-20";

const LEAD_STAGES = ["new", "contacted", "trial_booked", "trial_attended", "no_show", "converted", "lost", "waiting"] as const;

const phoneDigits = (s: string) => s.replace(/\D/g, "").slice(-9);

const managerNames = async (ctx: Ctx) => {
  const rows = must(await ctx.db.from("profiles").select("id, full_name").in(
    "role", ["director", "fitness_director", "senior_manager", "manager", "cashier"],
  )) as { id: string; full_name: string }[];
  return new Map(rows.map((r) => [r.id, r.full_name]));
};

// Карта → сколько по ней оплачено (оплаты + депозитные списания на покупку).
const paidByCard = async (ctx: Ctx, cardIds: string[]) => {
  const m = new Map<string, number>();
  for (let i = 0; i < cardIds.length; i += 200) {
    const ids = cardIds.slice(i, i + 200);
    const pays = must(await ctx.db.from("payments").select("club_card_id, amount").in("club_card_id", ids)) as { club_card_id: string; amount: number }[];
    for (const p of pays) m.set(p.club_card_id, (m.get(p.club_card_id) ?? 0) + Number(p.amount));
    const deps = must(await ctx.db.from("deposit_transactions").select("related_card_id, amount, type")
      .in("related_card_id", ids).in("type", ["card_purchase", "card_renewal"])) as { related_card_id: string; amount: number }[];
    for (const d of deps) m.set(d.related_card_id, (m.get(d.related_card_id) ?? 0) + Math.abs(Number(d.amount)));
  }
  return m;
};

type CardRow = { id: string; child_id: string; type: string; status: string; price_paid: number; discount: number | null; start_date: string; end_date: string; created_at: string };
const debtOf = (c: CardRow, paid: Map<string, number>) => {
  const price = Math.max(0, Number(c.price_paid) - Number(c.discount ?? 0));
  const p = paid.get(c.id) ?? 0;
  return { price, paid: p, debt: Math.max(0, Math.round(price - p)), known: p > 0 || c.created_at >= SYSTEM_SALES_SINCE };
};

const fetchAll = async <T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await q(from, from + 999)) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
};

export const readTools: ToolDef[] = [
  {
    name: "dashboard",
    title: "Сводка директора",
    description:
      "Главные цифры клуба на сегодня: выручка за день/неделю/месяц и прошлые периоды для сравнения, активные клиенты, новые за месяц, клиенты в зоне риска (нет посещений, абонемент кончается за 7 дней), загрузка секций. Начинай с него, когда спрашивают «как дела в клубе».",
    input: {},
    run: async (ctx) => {
      const [dash, load, risk] = await Promise.all([
        ctx.db.rpc("director_dashboard"),
        ctx.db.from("v_section_load").select("name_ru, groups_count, capacity, enrolled, fill_pct").order("fill_pct", { ascending: false }),
        ctx.db.from("v_clients_at_risk").select("reason"),
      ]);
      const d = (must(dash) as Record<string, unknown>[])[0] ?? {};
      const riskRows = must(risk) as { reason: string }[];
      return ok("Сводка по клубу (сумма в сомах)", {
        date: today(),
        revenue: {
          day: money(d.revenue_day), day_prev: money(d.revenue_day_prev),
          week: money(d.revenue_week), week_prev: money(d.revenue_week_prev),
          month: money(d.revenue_month), month_prev: money(d.revenue_month_prev),
        },
        clients: {
          active: Number(d.active_clients ?? 0),
          new_this_month: Number(d.new_clients_month ?? 0),
          new_prev_month: Number(d.new_clients_month_prev ?? 0),
          at_risk_no_visits: riskRows.filter((r) => r.reason === "no_visits").length,
          at_risk_expiring_7d: riskRows.filter((r) => r.reason === "expiring").length,
        },
        sections_load: must(load),
      });
    },
  },
  {
    name: "managers_kpi",
    title: "KPI менеджеров",
    description:
      "KPI отдела продаж за период по каждому менеджеру (ТЗ §7.4): лиды, первый контакт и среднее время до него (норма — до 10 минут), уложились ли в SLA, записи на пробную, пришли на пробную, продажи, продления (должны/сделали), продаж в день. Строка без менеджера — лиды без ответственного.",
    input: period,
    run: async (ctx, a) => {
      const p = span(a);
      const rows = must(await ctx.db.rpc("manager_kpi", { p_from: p.from, p_to: p.to }));
      return ok(`KPI менеджеров с ${p.from} по ${p.to}`, rows);
    },
  },
  {
    name: "leads_report",
    title: "Отчёт по заявкам (Kommo)",
    description:
      "Подробный отчёт по заявкам из Kommo за период: скорость ответа (вся/рабочее/нерабочее время, WhatsApp и Instagram отдельно — медиана, 75-й перцентиль, доля за 10 и 30 минут, без ответа), заявки по часам, воронка, по каналам, этапам, менеджерам и секциям, «хвост» неразобранных, состояние синхронизации.",
    input: period,
    run: async (ctx, a) => {
      const p = span(a);
      const r = must(await ctx.db.rpc("kommo_report", { p_from: p.from, p_to: p.to }));
      return ok(`Отчёт по заявкам с ${p.from} по ${p.to}`, r);
    },
  },
  {
    name: "leads_search",
    title: "Найти лиды",
    description:
      "Список лидов (заявок) с фильтрами: этап воронки, период создания, менеджер, поиск по имени родителя/ребёнка или телефону. Новые сверху. Этапы: new — новый, contacted — связались, trial_booked — записан на пробную, trial_attended — пришёл на пробную, no_show — не пришёл, converted — купил, lost — отказ, waiting — ждёт.",
    input: {
      stage: z.enum(LEAD_STAGES).optional().describe("Этап воронки"),
      ...period,
      manager_id: z.string().uuid().optional().describe("Ответственный менеджер (id из reference_data)"),
      query: z.string().min(2).optional().describe("Имя родителя или ребёнка, либо часть телефона"),
      limit: z.number().int().min(1).max(200).default(30),
    },
    run: async (ctx, a) => {
      let q = ctx.db.from("leads")
        .select("id, created_at, stage, parent_name, child_name, child_age, phone, channel, source, kommo_section, kommo_manager_tag, responsible_manager_id, first_contact_at, trial_at, lost_reason, comment, kommo_lead_id")
        .is("kommo_deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(a.limit);
      if (a.stage) q = q.eq("stage", a.stage);
      if (a.from) q = q.gte("created_at", a.from);
      if (a.to) q = q.lt("created_at", `${a.to}T23:59:59.999+06:00`);
      if (a.manager_id) q = q.eq("responsible_manager_id", a.manager_id);
      if (a.query) {
        const d = phoneDigits(a.query);
        const s = a.query.replace(/[,()%]/g, " ").trim();
        q = d.length >= 4
          ? q.ilike("phone", `%${d}%`)
          : q.or(`parent_name.ilike.%${s}%,child_name.ilike.%${s}%`);
      }
      const rows = must(await q) as Record<string, unknown>[];
      const names = await managerNames(ctx);
      return ok(`Найдено лидов: ${rows.length}`, rows.map((r) => ({
        ...r,
        manager: r.responsible_manager_id ? names.get(String(r.responsible_manager_id)) ?? null : null,
        from_kommo: r.kommo_lead_id != null,
      })));
    },
  },
  {
    name: "clients_search",
    title: "Найти клиента",
    description:
      "Поиск учеников (клиентов) по ФИО ребёнка или телефону родителя. Возвращает id, статус (active — действующий абонемент, frozen — заморозка, expired — абонемент закончился, debtor — долг), телефоны родителей, менеджера. Для подробностей — client_card.",
    input: {
      query: z.string().min(2).describe("ФИО ребёнка (можно часть) или телефон родителя"),
      status: z.enum(["active", "frozen", "expired", "debtor"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    run: async (ctx, a) => {
      const sel = "id, full_name, birth_date, status, source, responsible_manager_id, created_at, family:families(id, father_name, father_phone, mother_name, mother_phone)";
      const d = phoneDigits(a.query);
      let rows: Record<string, unknown>[];
      if (d.length >= 6) {
        const fams = must(await ctx.db.from("families").select("id")
          .or(`father_phone.ilike.%${d}%,mother_phone.ilike.%${d}%`).limit(50)) as { id: string }[];
        if (fams.length === 0) return ok("По этому телефону никого не нашлось", []);
        let q = ctx.db.from("children").select(sel).in("family_id", fams.map((f) => f.id)).is("deleted_at", null).limit(a.limit);
        if (a.status) q = q.eq("status", a.status);
        rows = must(await q);
      } else {
        const s = a.query.replace(/[,()%]/g, " ").trim();
        let q = ctx.db.from("children").select(sel).ilike("full_name", `%${s}%`).is("deleted_at", null).order("full_name").limit(a.limit);
        if (a.status) q = q.eq("status", a.status);
        rows = must(await q);
      }
      const names = await managerNames(ctx);
      return ok(`Найдено: ${rows.length}`, rows.map((r) => ({
        ...r, manager: r.responsible_manager_id ? names.get(String(r.responsible_manager_id)) ?? null : null,
      })));
    },
  },
  {
    name: "client_card",
    title: "Карточка клиента",
    description:
      "Всё по одному ученику: данные и родители, абонементы с остатком занятий и сроками, долг по каждому, депозит, группы, последние оплаты и посещения. Нужен id из clients_search.",
    input: { child_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
    run: async (ctx, a) => {
      const child = must(await ctx.db.from("children")
        .select("id, full_name, birth_date, status, source, card_number, created_at, deleted_at, responsible_manager_id, family:families(id, father_name, father_phone, mother_name, mother_phone, comment)")
        .eq("id", a.child_id).maybeSingle()) as Record<string, unknown> | null;
      if (!child) throw new ToolError("Ученик не найден");
      const [cards, bal, enr, pays, dep, att] = await Promise.all([
        ctx.db.from("club_cards").select("id, child_id, type, status, price_paid, discount, start_date, end_date, created_at, total_lessons, section:sections(name_ru)").eq("child_id", a.child_id).order("start_date", { ascending: false }),
        ctx.db.from("v_child_card_balance").select("club_card_id, attended_present, approved_freezes, remaining").eq("child_id", a.child_id),
        ctx.db.from("enrollments").select("id, start_date, end_date, archived_at, group:groups(id, name, section:sections(name_ru), coach:coaches(profile:profiles(full_name)))").eq("child_id", a.child_id).is("archived_at", null),
        ctx.db.from("payments").select("paid_at, amount, method, comment, club_card_id").eq("child_id", a.child_id).order("paid_at", { ascending: false }).limit(10),
        ctx.db.from("child_deposits").select("balance").eq("child_id", a.child_id).maybeSingle(),
        ctx.db.from("attendance").select("status, lesson:lessons(date, group:groups(name))").eq("child_id", a.child_id).order("marked_at", { ascending: false }).limit(10),
      ]);
      const cardRows = must(cards) as (CardRow & Record<string, unknown>)[];
      const balances = new Map((must(bal) as { club_card_id: string }[]).map((b) => [b.club_card_id, b]));
      const paid = await paidByCard(ctx, cardRows.map((c) => c.id));
      const names = await managerNames(ctx);
      return ok(`Карточка: ${child.full_name}`, {
        ...child,
        manager: child.responsible_manager_id ? names.get(String(child.responsible_manager_id)) ?? null : null,
        deposit_balance: money((must(dep) as { balance?: number } | null)?.balance),
        cards: cardRows.map((c) => {
          const d = debtOf(c, paid);
          return {
            ...c, balance: balances.get(c.id) ?? null,
            price_after_discount: d.price, paid: money(d.paid),
            debt: d.known ? d.debt : null,
            debt_note: d.known ? undefined : "импортная карта без оплат — долг неизвестен",
          };
        }),
        groups: must(enr),
        last_payments: must(pays),
        last_attendance: must(att),
      });
    },
  },
  {
    name: "debtors",
    title: "Должники",
    description:
      "Список должников: у кого по абонементу оплачено меньше цены (после скидки). Сортировка по сумме долга. Тем же правилом, что страница «Должники»: импортные карты без единой оплаты по умолчанию не считаются (их долг неизвестен).",
    input: {
      include_unknown: z.boolean().default(false).describe("Показать и импортные карты без оплат"),
      limit: z.number().int().min(1).max(300).default(50),
    },
    run: async (ctx, a) => {
      const cards = await fetchAll<CardRow & { child: { full_name: string; status: string; deleted_at: string | null; responsible_manager_id: string | null; family: { father_phone: string | null; mother_phone: string | null } | null } | null }>(
        (f, t) => ctx.db.from("club_cards")
          .select("id, child_id, type, status, price_paid, discount, start_date, end_date, created_at, child:children(full_name, status, deleted_at, responsible_manager_id, family:families(father_phone, mother_phone))")
          .neq("status", "archived").order("created_at", { ascending: false }).range(f, t),
      );
      // Все оплаты разом (как страница «Должники»): постранично быстрее, чем
      // тысячи id в фильтре.
      const [pays, deps] = await Promise.all([
        fetchAll<{ club_card_id: string; amount: number }>((f, t) => ctx.db.from("payments")
          .select("club_card_id, amount").not("club_card_id", "is", null).order("id").range(f, t)),
        fetchAll<{ related_card_id: string; amount: number }>((f, t) => ctx.db.from("deposit_transactions")
          .select("related_card_id, amount").in("type", ["card_purchase", "card_renewal"]).not("related_card_id", "is", null).order("id").range(f, t)),
      ]);
      const paid = new Map<string, number>();
      for (const p of pays) paid.set(p.club_card_id, (paid.get(p.club_card_id) ?? 0) + Number(p.amount));
      for (const d of deps) paid.set(d.related_card_id, (paid.get(d.related_card_id) ?? 0) + Math.abs(Number(d.amount)));
      const byChild = new Map<string, { child_id: string; full_name: string; phones: string[]; manager_id: string | null; total: number; cards: unknown[] }>();
      for (const c of cards) {
        if (!c.child || c.child.deleted_at) continue;
        const d = debtOf(c, paid);
        if (d.debt <= 0 || (!d.known && !a.include_unknown)) continue;
        const row = byChild.get(c.child_id) ?? {
          child_id: c.child_id, full_name: c.child.full_name, manager_id: c.child.responsible_manager_id,
          phones: [c.child.family?.father_phone, c.child.family?.mother_phone].filter(Boolean) as string[],
          total: 0, cards: [],
        };
        row.total += d.debt;
        row.cards.push({ card_id: c.id, type: c.type, start_date: c.start_date, end_date: c.end_date, price: d.price, paid: money(d.paid), debt: d.debt, known: d.known });
        byChild.set(c.child_id, row);
      }
      const names = await managerNames(ctx);
      const list = [...byChild.values()].sort((x, y) => y.total - x.total);
      const total = list.reduce((s, r) => s + r.total, 0);
      return ok(`Должников: ${list.length}, общий долг ${total} сом`, list.slice(0, a.limit).map((r) => ({
        ...r, manager: r.manager_id ? names.get(r.manager_id) ?? null : null,
      })));
    },
  },
  {
    name: "payments",
    title: "Оплаты за период",
    description:
      "Оплаты за период: итог, разбивка по способу (cash — наличные, terminal — терминал, transfer — перевод), по дням и последние операции. Возвраты хранятся отрицательными суммами.",
    input: { ...period, limit: z.number().int().min(0).max(300).default(30).describe("Сколько последних операций показать") },
    run: async (ctx, a) => {
      const p = span(a);
      const rows = await fetchAll<{ paid_at: string; amount: number; method: string; comment: string | null; child: { full_name: string } | null }>(
        (f, t) => ctx.db.from("payments").select("paid_at, amount, method, comment, child:children(full_name)")
          .gte("paid_at", `${p.from}T00:00:00+06:00`).lte("paid_at", `${p.to}T23:59:59.999+06:00`)
          .order("paid_at", { ascending: false }).range(f, t),
      );
      const sum = (xs: typeof rows) => money(xs.reduce((s, r) => s + Number(r.amount), 0));
      const byDay: Record<string, number> = {};
      for (const r of rows) {
        const d = new Date(r.paid_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Bishkek" });
        byDay[d] = money((byDay[d] ?? 0) + Number(r.amount));
      }
      return ok(`Оплаты с ${p.from} по ${p.to}: ${sum(rows)} сом, операций ${rows.length}`, {
        total: sum(rows),
        cash: sum(rows.filter((r) => r.method === "cash")),
        terminal: sum(rows.filter((r) => r.method === "terminal")),
        transfer: sum(rows.filter((r) => r.method === "transfer")),
        refunds: sum(rows.filter((r) => Number(r.amount) < 0)),
        by_day: byDay,
        latest: rows.slice(0, a.limit).map((r) => ({ ...r, child: r.child?.full_name ?? null })),
      });
    },
  },
  {
    name: "sales_by_section",
    title: "Продажи по секциям",
    description: "Сколько абонементов продано по каждой секции за период, выручка и средний чек.",
    input: period,
    run: async (ctx, a) => {
      const p = span(a);
      return ok(`Продажи по секциям с ${p.from} по ${p.to}`, must(await ctx.db.rpc("sales_by_section", { p_from: p.from, p_to: p.to })));
    },
  },
  {
    name: "attendance_by_group",
    title: "Посещаемость по группам",
    description: "Посещаемость за период по каждой группе: проведено занятий, посещений, пропусков, процент посещаемости, тренер.",
    input: period,
    run: async (ctx, a) => {
      const p = span(a);
      return ok(`Посещаемость с ${p.from} по ${p.to}`, must(await ctx.db.rpc("attendance_by_group", { p_from: p.from, p_to: p.to })));
    },
  },
  {
    name: "clients_at_risk",
    title: "Клиенты в зоне риска",
    description: "Кто может уйти: давно не ходит (no_visits) или абонемент кончается в ближайшие 7 дней (expiring). С ответственным менеджером — кому звонить.",
    input: { reason: z.enum(["no_visits", "expiring"]).optional(), limit: z.number().int().min(1).max(300).default(50) },
    run: async (ctx, a) => {
      let q = ctx.db.from("v_clients_at_risk").select("child_id, full_name, reason, churn_risk_at, card_end_date, responsible_manager_id").limit(a.limit);
      if (a.reason) q = q.eq("reason", a.reason);
      const rows = must(await q) as Record<string, unknown>[];
      const names = await managerNames(ctx);
      return ok(`В зоне риска: ${rows.length}`, rows.map((r) => ({
        ...r, manager: r.responsible_manager_id ? names.get(String(r.responsible_manager_id)) ?? null : null,
      })));
    },
  },
  {
    name: "reference_data",
    title: "Справочники",
    description:
      "Справочники для остальных инструментов: секции с ценами, группы (тренер, вместимость, расписание), тарифы абонементов (card_plans — нужен для card_sell), менеджеры. Вызывай, когда нужен id секции, группы, тарифа или менеджера.",
    input: {},
    run: async (ctx) => {
      const [sections, groups, plans, staff] = await Promise.all([
        ctx.db.from("sections").select("id, name_ru, category, trial_price, single_price, subscription_price").eq("is_active", true).order("name_ru"),
        ctx.db.from("groups").select("id, name, section_id, max_capacity, age_min, age_max, level, coach:coaches(profile:profiles(full_name)), schedule:group_schedule(day_of_week, start_time, duration_min)").eq("is_active", true).order("name"),
        ctx.db.from("card_plans").select("id, name_ru, type, lessons_count, duration_days, price, freeze_quota").eq("is_active", true).order("sort_order"),
        ctx.db.from("profiles").select("id, full_name, role").in("role", ["director", "fitness_director", "senior_manager", "manager", "cashier"]).eq("is_active", true).is("deleted_at", null).order("full_name"),
      ]);
      return ok("Справочники (day_of_week: 0 — воскресенье … 6 — суббота)", {
        sections: must(sections), groups: must(groups), card_plans: must(plans), staff: must(staff),
      });
    },
  },
  {
    name: "whoami",
    title: "Кто подключён",
    description: "От чьего имени ассистент работает в CRM и с какой ролью.",
    input: {},
    run: async (ctx) => ok(`Вы вошли как ${ctx.user.full_name} (${ctx.user.role === "director" ? "директор" : "старший менеджер"})`, {
      id: ctx.user.id, full_name: ctx.user.full_name, role: ctx.user.role, today: today(),
    }),
  },
];
