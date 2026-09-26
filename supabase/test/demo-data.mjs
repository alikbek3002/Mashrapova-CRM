// Демонстрационный набор данных — чтобы интерфейс было на чём смотреть.
//
// Это НЕ тест: цель не проверить расчёт, а наполнить базу так, чтобы
// дашборд, отчёты и воронка показывали живые цифры. Данные правдоподобные
// по масштабу ТЗ §1.3: шесть дисциплин, ~15 тренеров, несколько сотен
// клиентов было бы долго, поэтому берём выборку того же вида.
import { readFileSync } from "node:fs";
import pg from "pg";

const c = new pg.Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "postgres" });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;
const ORG = "00000000-0000-0000-0000-000000000001";
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const int = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

// Каталог и секции — из seed, если ещё не применён.
const [cnt] = await q(`select count(*)::int n from card_plans where organization_id=$1`, [ORG]);
if (cnt.n === 0) {
  await q(`insert into organizations (id,name) values ($1,'Академия Машрапова') on conflict do nothing`, [ORG]);
  await c.query(readFileSync("../seed.sql", "utf8"));
}

const sections = await q(`select id, name_ru, category from sections where organization_id=$1 and deleted_at is null order by name_ru`, [ORG]);
const plans = await q(`select id, name_ru, type, price, lessons_count, duration_days, freeze_quota from card_plans where organization_id=$1 and is_active and lessons_count > 1`, [ORG]);

const mkUser = async (email) => (await q(`insert into auth.users (email) values ($1) returning id`, [email]))[0].id;

// ── Сотрудники: по одному на каждую роль из §2.1 ──────────────────────
const STAFF = [
  ["director",        "Машрапов Азамат",   "+996700000000"],
  ["fitness_director","Осмонова Айгуль",   "+996700000010"],
  ["senior_manager",  "Токтосунов Бектур", "+996700000003"],
  ["manager",         "Абдыкадырова Нурзат","+996700000004"],
  ["cashier",         "Жээнбеков Тилек",   "+996700000005"],
];
const staff = {};
for (const [role, name, phone] of STAFF) {
  const id = await mkUser(`${role}@mashrapov.test`);
  await q(`insert into profiles (id,organization_id,role,full_name,phone,is_active)
           values ($1,$2,$3::user_role,$4,$5,true)`, [id, ORG, role, name, phone]);
  staff[role] = id;
}
const managers = [staff.manager, staff.senior_manager];

// ── Тренеры: §1.3 говорит ~15, берём по два на дисциплину ────────────
const COACH_NAMES = ["Уметалиев Руслан","Садыков Эрнис","Байзаков Тимур","Молдалиев Канат",
  "Асанов Данияр","Керимов Улан","Турсунов Бакыт","Алиев Нурбек","Жумабаев Мирлан",
  "Орозов Азат","Касымов Эльдар","Мамытов Сыймык","Эсенов Талант","Нурланов Айбек"];
const coaches = [];
for (let i = 0; i < COACH_NAMES.length; i++) {
  const id = await mkUser(`coach${i}@mashrapov.test`);
  await q(`insert into profiles (id,organization_id,role,full_name,phone,is_active)
           values ($1,$2,'coach',$3,$4,true)`, [id, ORG, COACH_NAMES[i], `+99670010${String(i).padStart(4,"0")}`]);
  // §6.2: дежурный тренер фитнес-зоны — на фиксе, остальные на проценте.
  const isFitness = i === COACH_NAMES.length - 1;
  await q(`insert into coaches (id,bio,achievements,experience_years,pay_mode,percent_rate,fixed_monthly)
           values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, "Тренер по единоборствам", pick(["КМС","МС","Тренер сборной области","1 разряд"]), int(2,15),
     isFitness ? "fixed" : "percent", 40, isFitness ? 35000 : 0]);
  coaches.push({ id, name: COACH_NAMES[i], fitness: isFitness });
}

// ── Группы: по две на дисциплину ─────────────────────────────────────
const groups = [];
for (const s of sections) {
  for (const [n, aud] of [["Младшая","kids"],["Старшая","adults"]]) {
    const coach = pick(coaches.filter((x) => (s.category === "fitness") === x.fitness)) ?? pick(coaches);
    const [g] = await q(`insert into groups (organization_id,section_id,coach_id,name,max_capacity,audience,coach_rate_per_child)
      values ($1,$2,$3,$4,$5,$6,100) returning id`,
      [ORG, s.id, coach.id, `${s.name_ru} · ${n}`, int(10,14), aud]);
    groups.push({ id: g.id, section_id: s.id, coach_id: coach.id, name: `${s.name_ru} · ${n}` });
    // Расписание: три раза в неделю
    for (const dow of [1,3,5]) {
      await q(`insert into group_schedule (group_id,day_of_week,start_time,duration_min) values ($1,$2,$3,60)`,
        [g.id, dow, aud === "kids" ? "16:00" : "19:00"]).catch(()=>{});
    }
  }
}

// ── Семьи, ученики, абонементы, посещения ────────────────────────────
const FIRST_M = ["Азамат","Бекзат","Данияр","Эрлан","Нурсултан","Тимур","Санжар","Адилет","Бакыт","Илим"];
const FIRST_F = ["Айпери","Асель","Жаннат","Мээрим","Нургиза","Аяна","Бегимай","Динара"];
const LAST = ["Абдырахманов","Бекболотов","Жусупов","Исаков","Кадыров","Мамбетов","Ниязов",
  "Осмонов","Райымбеков","Сатыбалдиев","Токтогулов","Уметов","Чойбеков","Шаршеев"];
const mkName = () => `${pick(LAST)}${Math.random()<0.4?"а":""} ${pick(Math.random()<0.6?FIRST_M:FIRST_F)}`;

let kidsCount = 0, cardsCount = 0, attCount = 0, payCount = 0;
const kids = [];
for (let f = 0; f < 60; f++) {
  const last = pick(LAST);
  const [fam] = await q(`insert into families (organization_id,father_name,father_phone,mother_name,mother_phone,responsible_manager_id)
    values ($1,$2,$3,$4,$5,$6) returning id`,
    [ORG, `${last} ${pick(FIRST_M)}`, `+9967005${String(int(10000,99999))}`,
     `${last}а ${pick(FIRST_F)}`, `+9967007${String(int(10000,99999))}`, pick(managers)]);

  for (let k = 0; k < (Math.random() < 0.3 ? 2 : 1); k++) {
    const regAgo = int(5, 300);
    const [kid] = await q(`insert into children (organization_id,family_id,full_name,birth_date,status,source,responsible_manager_id,created_at)
      values ($1,$2,$3,$4,'active',$5,$6,$7) returning id`,
      [ORG, fam.id, `${last} ${pick(Math.random()<0.6?FIRST_M:FIRST_F)}`,
       iso(daysAgo(int(2200, 5500))), pick(["target","referral","other"]), pick(managers), daysAgo(regAgo)]);
    kidsCount++;
    kids.push(kid.id);

    const grp = pick(groups);
    const plan = pick(plans);
    // Часть абонементов истекает в ближайшие дни — чтобы §4.5 и зона риска ожили.
    const startAgo = Math.random() < 0.25 ? int(25, 29) : int(1, 24);
    const start = daysAgo(startAgo);
    const end = new Date(start); end.setDate(end.getDate() + plan.duration_days - 1);
    const [card] = await q(`insert into club_cards (organization_id,child_id,type,total_lessons,freeze_quota,
      price_paid,discount,start_date,end_date,status,section_id,plan_id,duration_days,created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,$12,$13) returning id`,
      [ORG, kid.id, plan.type, plan.lessons_count, plan.freeze_quota, plan.price,
       k === 1 ? 500 : 0, iso(start), iso(end), grp.section_id, plan.id, plan.duration_days, start]);
    cardsCount++;
    if (k === 1) await q(`update club_cards set discount_reason='auto_2nd_child' where id=$1`, [card.id]);

    await q(`insert into enrollments (child_id,group_id,enrolled_at,start_date,end_date)
             values ($1,$2,$3,$4,$5)`, [kid.id, grp.id, iso(start), iso(start), iso(end)]);

    await q(`insert into payments (organization_id,child_id,club_card_id,amount,method,received_by,paid_at)
      values ($1,$2,$3,$4,$5,$6,$7)`,
      [ORG, kid.id, card.id, Number(plan.price) - (k===1?500:0),
       pick(["cash","terminal"]), pick([...managers, staff.cashier]), start]);
    payCount++;
  }
}

// ── Занятия и посещаемость за последний месяц ─────────────────────────
for (const g of groups) {
  const roster = await q(`select child_id from enrollments where group_id=$1 and archived_at is null`, [g.id]);
  if (roster.length === 0) continue;
  for (let d = 30; d >= 1; d--) {
    const day = daysAgo(d);
    if (![1,3,5].includes(day.getDay())) continue;
    const [les] = await q(`insert into lessons (organization_id,group_id,coach_id,date,start_time,duration_min,status)
      values ($1,$2,$3,$4,'18:00',60,'completed') returning id`, [ORG, g.id, g.coach_id, iso(day)]);
    for (const r of roster) {
      // ~80% посещаемость — правдоподобно для зала
      const st = Math.random() < 0.8 ? "present" : (Math.random() < 0.6 ? "absent" : "excused");
      await q(`insert into attendance (lesson_id,child_id,status,marked_by,marked_at)
               values ($1,$2,$3,$4,$5) on conflict do nothing`, [les.id, r.child_id, st, g.coach_id, day]);
      attCount++;
    }
  }
  // Пара будущих занятий, чтобы расписание не было пустым
  for (let d = 1; d <= 10; d++) {
    const day = new Date(); day.setDate(day.getDate() + d);
    if (![1,3,5].includes(day.getDay())) continue;
    await q(`insert into lessons (organization_id,group_id,coach_id,date,start_time,duration_min,status)
      values ($1,$2,$3,$4,'18:00',60,'scheduled')`, [ORG, g.id, g.coach_id, iso(day)]);
  }
}

// ── Воронка лидов на всех этапах §8.2 ────────────────────────────────
const STAGES = ["new","contacted","trial_booked","trial_attended","no_show","converted","lost"];
let leadsCount = 0;
for (let i = 0; i < 40; i++) {
  const stage = pick(STAGES);
  const createdAgo = int(0, 45);
  const created = daysAgo(createdAgo);
  const contacted = stage === "new" ? null
    : new Date(created.getTime() + int(2, 40) * 60000);
  const trialAt = ["trial_booked","trial_attended","no_show","converted"].includes(stage)
    ? new Date(created.getTime() + int(1, 5) * 86400000) : null;
  await q(`insert into leads (organization_id,parent_name,phone,instagram,child_name,child_age,
      section_interest_id,stage,responsible_manager_id,source,created_at,first_contact_at,trial_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [ORG, mkName(), `+9967009${String(int(10000,99999))}`,
     Math.random()<0.5 ? `client_${i}` : null, mkName(), int(5,17),
     pick(sections).id, stage, pick(managers), pick(["target","target","referral","direct"]),
     created, contacted, trialAt]);
  leadsCount++;
}

// ── Зарплатные периоды за прошлый месяц ──────────────────────────────
const now = new Date();
const pStart = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
const pEnd = iso(new Date(now.getFullYear(), now.getMonth(), 0));
for (const co of coaches) {
  const [amt] = await q(`select compute_coach_payroll($1,$2,$3) a`, [co.id, pStart, pEnd]);
  await q(`insert into payroll_periods (organization_id,coach_id,period_start,period_end,computed_amount,status)
    values ($1,$2,$3,$4,$5,'draft') on conflict do nothing`, [ORG, co.id, pStart, pEnd, amt.a]);
}

// ── Статусы и события по календарю ───────────────────────────────────
await q(`select refresh_lifecycle()`);
await q(`select refresh_card_notices()`);
await q(`select refresh_lead_sla()`);

const [sum] = await q(`select
  (select count(*) from children where deleted_at is null) kids,
  (select count(*) from families) fams,
  (select count(*) from profiles where role='coach') coaches,
  (select count(*) from groups) groups,
  (select count(*) from club_cards) cards,
  (select count(*) from lessons) lessons,
  (select count(*) from attendance) att,
  (select count(*) from payments) pays,
  (select count(*) from leads) leads,
  (select count(*) from notifications) notifs,
  (select count(*) from outbound_messages) outbox,
  (select coalesce(sum(amount),0) from payments) revenue`);

console.log(`
Демо-данные готовы:
  семей ................ ${sum.fams}
  учеников ............. ${sum.kids}
  тренеров ............. ${sum.coaches}
  групп ................ ${sum.groups}
  абонементов .......... ${sum.cards}
  занятий .............. ${sum.lessons}
  отметок посещаемости . ${sum.att}
  платежей ............. ${sum.pays}  (выручка ${Number(sum.revenue).toLocaleString("ru-RU")} сом)
  лидов ................ ${sum.leads}
  уведомлений .......... ${sum.notifs}
  в очереди SMS ........ ${sum.outbox}
`);
await c.end();
