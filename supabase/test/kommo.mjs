// Проверка интеграции Kommo (миграция 20261001000001) на синтетических
// данных: загрузка сделок, факты по событиям, SLA и отчёт.
// Запуск: npm run db:start && npm run migrate && npm run kommo
import pg from "pg";

const c = new pg.Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "postgres" });
await c.connect();
const q = async (sql, params) => (await c.query(sql, params)).rows;
let fails = 0;
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? "OK  " : "ФЕЙЛ"} ${name}: получили ${actual}${ok ? "" : `, ждали ${expected}`}`);
  if (!ok) fails++;
};

const ORG = "00000000-0000-0000-0000-00000000a001";
await q(`insert into organizations (id, name) values ($1, 'Kommo тест') on conflict do nothing`, [ORG]);
await q(`insert into org_settings (organization_id) values ($1) on conflict do nothing`, [ORG]);
for (const [ru, cat] of [["ММА", "martial_arts"], ["Вольная борьба", "martial_arts"], ["Фитнес-зона", "fitness"]]) {
  await q(`insert into sections (organization_id, name_ru, name_ky, category) values ($1, $2, $2, $3)`, [ORG, ru, cat]);
}
const [au] = await q(`insert into auth.users (email) values ('kommo-manager@test') returning id`);
const [mgr] = await q(`insert into profiles (id, organization_id, role, full_name, is_active)
  values ($1, $2, 'manager', 'Марлен Тестов', true) returning id`, [au.id, ORG]);

// Воронка 100: неразобранное → связались → записались → пришли → 142/143
await q(`insert into kommo_statuses (organization_id, pipeline_id, status_id, pipeline_name, status_name, sort, is_unsorted, stage) values
  ($1, 100, 1, 'Pipeline', 'Неразобранное', 10, true,  'new'),
  ($1, 100, 2, 'Pipeline', 'переписка',     20, false, 'contacted'),
  ($1, 100, 3, 'Pipeline', 'Записались',    30, false, 'trial_booked'),
  ($1, 100, 4, 'Pipeline', 'Пришли',        40, false, 'trial_attended'),
  ($1, 100, 142, 'Pipeline', 'Closed - won',  10000, false, 'converted'),
  ($1, 100, 143, 'Pipeline', 'Closed - lost', 11000, false, 'lost')`, [ORG]);

const now = Date.now();
const at = (msAgo) => new Date(now - msAgo).toISOString();
const MIN = 60_000, DAY = 86_400_000;
const t0 = 30 * DAY; // сделка 1001 создана 30 дней назад

// События: 1001 — автоответ через 2 с, человек через 7 мин, затем этапы.
const ev = (id, type, entity, msAgo, extra = {}) => ({
  id, type, entity_type: "lead", entity_id: entity, created_at: at(msAgo), created_by: 0,
  talk_id: null, origin: null, status_before: null, status_after: null, pipeline_after: null, tag: null, ...extra,
});
const events = [
  ev("e1", "lead_added", 1001, t0),
  ev("e2", "incoming_chat_message", 1001, t0, { talk_id: 501, origin: "waba" }),
  ev("e3", "outgoing_chat_message", 1001, t0 - 2_000, { talk_id: 501, origin: "waba" }),
  ev("e4", "outgoing_chat_message", 1001, t0 - 7 * MIN, { talk_id: 501, origin: "waba" }),
  ev("e5", "lead_status_changed", 1001, t0 - 20 * MIN, { status_after: 2, pipeline_after: 100, created_by: 77 }),
  ev("e6", "lead_status_changed", 1001, t0 - DAY, { status_after: 3, pipeline_after: 100, created_by: 77 }),
  // 1002 — свежая заявка из Instagram, без ответа
  ev("e7", "lead_added", 1002, 15 * MIN),
  ev("e8", "incoming_chat_message", 1002, 15 * MIN, { talk_id: 502, origin: "instagram_business" }),
  // 1003 — сделку завели руками
  ev("e9", "lead_added", 1003, 5 * DAY, { created_by: 77 }),
];
for (const e of events) {
  await q(`insert into kommo_events (organization_id, id, type, entity_type, entity_id, created_at, created_by,
      talk_id, origin, status_before, status_after, pipeline_after, tag)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [ORG, e.id, e.type, e.entity_type, e.entity_id, e.created_at, e.created_by, e.talk_id, e.origin,
     e.status_before, e.status_after, e.pipeline_after, e.tag]);
}

const row = (id, status, msAgo, extra = {}) => ({
  kommo_lead_id: id, kommo_contact_id: id + 9000, pipeline_id: 100, status_id: status,
  parent_name: `Родитель ${id}`, phone: "+996700000000", child_name: null, child_age: null,
  section_text: null, coach_name: null, manager_tag: null, responsible_user_id: 77, price: null,
  created_at: at(msAgo), updated_at: at(0), closed_at: null, loss_reason: null, is_deleted: false, ...extra,
});
const rows = [
  row(1001, 3, t0, { section_text: "мма", manager_tag: "Марлен", child_age: 12 }),
  row(1002, 1, 15 * MIN, { section_text: "вольная борьбай" }),
  row(1003, 142, 5 * DAY, { price: 2500, closed_at: at(4 * DAY), manager_tag: "Марлен" }),
  row(1004, 1, 10 * DAY),                       // старая неразобранная без ответа
  row(1005, 4, 3 * DAY, { price: 0 }),          // старая, уже после пробной
];
const quiet = at(60 * MIN);
const [{ n }] = await q(`select kommo_upsert_leads($1, $2::jsonb, $3) as n`, [ORG, JSON.stringify(rows), quiet]);
check("загружено сделок", n, 5);
await q(`select kommo_refresh_lead_facts($1, $2::bigint[])`, [ORG, [1001, 1002, 1003, 1004, 1005]]);

const lead = async (id) => (await q(`select l.*, s.name_ru as section_name from leads l
  left join sections s on s.id = l.section_interest_id where l.organization_id = $1 and l.kommo_lead_id = $2`, [ORG, id]))[0];

console.log("\n── Сопоставления ──");
const l1 = await lead(1001), l2 = await lead(1002), l3 = await lead(1003);
check("1001: этап", l1.stage, "trial_booked");
check("1001: секция «мма» → ММА", l1.section_name, "ММА");
check("1001: тег «Марлен» → менеджер", l1.responsible_manager_id, mgr.id);
check("1002: «вольная борьбай» → Вольная борьба", l2.section_name, "Вольная борьба");
check("1003: 142 → converted", l3.stage, "converted");
check("1003: converted_at из closed_at", l3.converted_at?.toISOString(), at(4 * DAY));

console.log("\n── Факты по событиям ──");
check("1001: первый контакт — человек через 7 мин, не автоответ", l1.first_contact_at?.toISOString(), at(t0 - 7 * MIN));
check("1001: записан на пробную — время перехода", l1.trial_booked_at?.toISOString(), at(t0 - DAY));
check("1001: канал", l1.channel, "whatsapp");
check("1002: без ответа — контакта нет", l2.first_contact_at, null);
check("1002: канал", l2.channel, "instagram");
check("1003: заведена вручную", l3.channel, "manual");

console.log("\n── SLA §8.3: история молчит, свежее срабатывает ──");
await q(`select refresh_lead_sla()`);
const notes = async (type) => Number((await q(`select count(*) n from notifications
  where recipient_id = $1 and type = $2`, [mgr.id, type]))[0].n);
check("просрочка первого контакта — только свежая 1002", await notes("lead_first_contact_overdue"), 1);
check("задача после пробной по старой 1005 не создана", await notes("lead_conversion_call"), 0);
const smsCount = async () => Number((await q(`select count(*) n from outbound_messages
  where organization_id = $1 and channel = 'sms'`, [ORG]))[0].n);
check("синхронизация SMS не порождает", await smsCount(), 0);

// 1001 дошла до пробной уже после подключения — задача должна появиться.
// Заодно ERP записала её на пробную: trial_at синхронизация не трогает.
await q(`update leads set trial_at = now() + interval '3 days' where organization_id = $1 and kommo_lead_id = 1001`, [ORG]);
const smsAfterBooking = await smsCount();
await q(`select kommo_upsert_leads($1, $2::jsonb, $3)`, [ORG, JSON.stringify([row(1001, 4, t0, { manager_tag: "Марлен" })]), quiet]);
await q(`select refresh_lead_sla()`);
check("1001 перешла на «Пришли» → задача «предложить абонемент»", await notes("lead_conversion_call"), 1);
const l1b = await lead(1001);
check("trial_at, поставленный в ERP, сохранился", l1b.trial_at != null, true);
check("секция не стёрлась пустым значением", l1b.section_name, "ММА");

// SMS о записи на пробную (§9.1) — дело ERP; повторная синхронизация
// новых не добавляет.
check("после синхронизации SMS не прибавилось", await smsCount(), smsAfterBooking);

console.log("\n── KPI §7.4 и отчёт ──");
const kpi = await q(`select * from manager_kpi(current_date - 60, current_date) where manager_id = $1`, [mgr.id]);
// Накопительно (20261006000001): 1001 записана, 1003 купила минуя запись —
// обе прошли этап записи. Пришедших не может быть больше записанных.
check("manager_kpi: записанных на пробную у Марлена", kpi[0]?.trial_booked_total, 2);
check("manager_kpi: пришедших не больше записанных", Number(kpi[0]?.trial_attended_total) <= Number(kpi[0]?.trial_booked_total), true);
const [{ r }] = await q(`select kommo_report(current_date - 60, current_date, $1) as r`, [ORG]);
check("отчёт: бесед", r.response.all.talks, 2);
check("отчёт: без ответа", r.response.all.no_reply, 1);
check("отчёт: медиана ответа, мин", r.response.all.median_min, 7);
check("отчёт: сделок за период", r.funnel.leads, 5);
check("отчёт: выручка по выигранным", r.funnel.revenue, 2500);
check("отчёт: в «Неразобранном» сейчас", r.backlog.unsorted_total, 2);

console.log(fails ? `\nФЕЙЛОВ: ${fails}` : "\nВСЁ СОШЛОСЬ");
await c.end();
process.exit(fails ? 1 : 0);
