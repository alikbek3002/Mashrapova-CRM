import pg from "pg";
const c = new pg.Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "postgres" });
await c.connect();
const q = async (sql, params) => (await c.query(sql, params)).rows;
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? "OK  " : "ФЕЙЛ"} ${name}: получили ${actual}${ok ? "" : `, ждали ${expected}`}`);
  return ok;
};
let fails = 0;

const ORG = "00000000-0000-0000-0000-000000000001";
await q(`insert into organizations (id, name) values ($1,'Академия Машрапова') on conflict do nothing`, [ORG]);
await q(`insert into org_settings (organization_id) values ($1) on conflict do nothing`, [ORG]);

// subscription_price/trial_price убраны миграцией 20260807000001
const [sec] = await q(`insert into sections (organization_id,name_ru,name_ky,category)
  values ($1,'Бокс','Бокс','martial_arts') returning id`, [ORG]);
const [au] = await q(`insert into auth.users (email) values ('coach@test') returning id`);
const [coachP] = await q(`insert into profiles (id,organization_id,role,full_name,is_active)
  values ($1,$2,'coach','Тренер Тест',true) returning id`, [au.id, ORG]);
// ТЗ §10.1: 40% от выручки занятия
await q(`insert into coaches (id,pay_mode,percent_rate) values ($1,'percent',40)`, [coachP.id]);
const [grp] = await q(`insert into groups (organization_id,section_id,coach_id,name,max_capacity)
  values ($1,$2,$3,'Бокс-1',12) returning id`, [ORG, sec.id, coachP.id]);
const [fam] = await q(`insert into families (organization_id,father_name,father_phone)
  values ($1,'Отец','+996700000001') returning id`, [ORG]);
const [kid] = await q(`insert into children (organization_id,family_id,full_name,birth_date,status)
  values ($1,$2,'Ребёнок Тест','2015-01-01','active') returning id`, [ORG, fam.id]);

console.log("\n── ТЗ §10.1: зарплата = 40% от доли занятия ──");
// Детский тариф 2500 сом / 12 занятий → 208.33 за занятие → 40% = 83.33
const [card] = await q(`insert into club_cards (organization_id,child_id,type,total_lessons,freeze_quota,
  price_paid,discount,start_date,end_date,status,section_id)
  values ($1,$2,'monthly',12,0,2500,0,current_date-5,current_date+25,'active',$3) returning id`, [ORG, kid.id, sec.id]);
const [les] = await q(`insert into lessons (organization_id,group_id,coach_id,date,start_time,duration_min,status)
  values ($1,$2,$3,current_date-1,'18:00',60,'completed') returning id`, [ORG, grp.id, coachP.id]);
await q(`insert into attendance (lesson_id,child_id,status) values ($1,$2,'present')`, [les.id, kid.id]);
const [pay] = await q(`select compute_coach_payroll($1, current_date-30, current_date) as amt`, [coachP.id]);
if (!check("2500 / 12 × 40%", pay.amt, "83.33")) fails++;

// Число занятий в месячном абонементе подтверждено владельцем — 12.
// Фиксируем его и по взрослому тарифу: 2800 / 12 × 40% = 93.33.
const [kidA] = await q(`insert into children (organization_id,family_id,full_name,birth_date,status)
  values ($1,$2,'Взрослый Тест','2000-01-01','active') returning id`, [ORG, fam.id]);
await q(`insert into club_cards (organization_id,child_id,type,total_lessons,freeze_quota,
  price_paid,discount,start_date,end_date,status,section_id)
  values ($1,$2,'monthly',12,0,2800,0,current_date-5,current_date+25,'active',$3)`, [ORG, kidA.id, sec.id]);
await q(`insert into attendance (lesson_id,child_id,status) values ($1,$2,'present')`, [les.id, kidA.id]);
const [payA] = await q(`select sum(amount) amt from v_payroll_attendance where child_id=$1`, [kidA.id]);
if (!check("2800 / 12 × 40%", payA.amt, "93.33")) fails++;

console.log("\n── ТЗ §7.3: возврат от уплаченного, а не от цены тарифа ──");
const [card2] = await q(`insert into club_cards (organization_id,child_id,type,total_lessons,freeze_quota,
  price_paid,discount,start_date,end_date,status)
  values ($1,$2,'monthly',12,0,2500,500,current_date,current_date+30,'active') returning id, price_paid-discount as net`, [ORG, kid.id]);
if (!check("чистая цена при скидке 500", card2.net, "2000.00")) fails++;

console.log("\n── ТЗ §4.3: лимит заморозок по типу абонемента ──");
// freeze_quota = 0 у месячного (§4.1 «Заморозка: Нет»)
try {
  await q(`insert into freezes (child_id,club_card_id,initiated_by,initiator_role,status,start_date,end_date)
    values ($1,$2,$3,'manager','approved',current_date,current_date+3)`, [kid.id, card.id, coachP.id]);
  console.log("ФЕЙЛ лимит заморозок: вставка прошла, хотя квота 0");
  fails++;
} catch (e) {
  check("квота 0 блокирует заморозку", /freeze_quota_exceeded/.test(e.message), "true") || fails++;
}

console.log("\n── ТЗ §9: матрица каналов и очередь исходящих ──");
const [m] = await q(`select count(*) n from notification_matrix where organization_id=$1`, [ORG]);
if (!check("строк матрицы засеяно", m.n, "24")) fails++;
const [t] = await q(`select count(*) n from message_templates where organization_id=$1`, [ORG]);
if (!check("шаблонов засеяно", t.n, "16")) fails++;

// Уведомление родителю должно породить исходящие по матрице
const [pu] = await q(`insert into auth.users (email) values ('parent@test') returning id`);
await q(`insert into profiles (id,organization_id,role,full_name,is_active) values ($1,$2,'parent','Родитель',true)`, [pu.id, ORG]);
await q(`update families set parent_user_id=$1 where id=$2`, [pu.id, fam.id]);
await q(`insert into notifications (recipient_id,type,payload) values ($1,'card_expiring',
  jsonb_build_object('child_id',$2::text,'child_name','Ребёнок Тест','end_date','01.10','days_left',7))`, [pu.id, kid.id]);
// Ограничиваем выборку ребёнком, созданным в ЭТОМ прогоне: тест можно
// запускать повторно на той же базе, и записи прошлых прогонов не должны
// ломать проверку.
const out = await q(`select channel, body, to_phone from outbound_messages
  where event_type='card_expiring' and payload->>'child_id' = $1 order by channel`, [kid.id]);
// Решение по вопросу 7 (миграция 20260926000014): в очередь идёт только
// SMS. Канал push доставляется самой таблицей notifications — приложение
// родителя читает её напрямую, дублировать в очереди незачем.
if (!check("в очереди только SMS", out.length, "1")) fails++;
if (!check("push в очередь не попал", out.every((r) => r.channel === "sms"), "true")) fails++;
const sms = out.find((r) => r.channel === "sms");
if (sms) {
  console.log(`     SMS на ${sms.to_phone}: «${sms.body}»`);
  if (!check("подстановка в шаблон сработала", /Ребёнок Тест/.test(sms.body), "true")) fails++;
}

console.log("\n── ТЗ §11.1: дашборд директора ──");
const [d] = await q(`select * from director_dashboard()`);
console.log(`     активных клиентов: ${d.active_clients}, новых за месяц: ${d.new_clients_month}`);
if (!check("функция дашборда отвечает", d.active_clients >= 1, "true")) fails++;

console.log(`\n${fails === 0 ? "ВСЁ СОШЛОСЬ" : `ПРОВАЛОВ: ${fails}`}`);
await c.end();
process.exit(fails ? 1 : 0);
