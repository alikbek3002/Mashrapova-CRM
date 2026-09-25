// Что тренер получает за одного пришедшего ребёнка по каждому тарифу,
// при подтверждённых 12 занятиях в месяце и ставке 40% (ТЗ §10.1).
// Считает сама база — не арифметика в уме.
import pg from "pg";
const c = new pg.Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "postgres" });
await c.connect();
const ORG = "00000000-0000-0000-0000-000000000001";

const [sec] = (await c.query(
  `insert into sections (organization_id,name_ru,name_ky,category)
   values ($1,'Тариф-тест','Тариф-тест','martial_arts') returning id`, [ORG])).rows;
const [au] = (await c.query(`insert into auth.users (email) values ('t@t') returning id`)).rows;
await c.query(`insert into profiles (id,organization_id,role,full_name,is_active)
  values ($1,$2,'coach','Тренер',true)`, [au.id, ORG]);
await c.query(`insert into coaches (id,pay_mode,percent_rate) values ($1,'percent',40)`, [au.id]);
const [grp] = (await c.query(`insert into groups (organization_id,section_id,coach_id,name)
  values ($1,$2,$3,'Г') returning id`, [ORG, sec.id, au.id])).rows;
const [fam] = (await c.query(`insert into families (organization_id) values ($1) returning id`, [ORG])).rows;

const plans = (await c.query(
  `select name_ru, price, lessons_count from card_plans
    where organization_id=$1 and lessons_count>1 and is_active order by sort_order`, [ORG])).rows;

console.log("\nТариф                             цена  зан.  за занятие  тренеру 40%");
console.log("─".repeat(74));
for (const p of plans) {
  const [kid] = (await c.query(`insert into children (organization_id,family_id,full_name,birth_date,status)
    values ($1,$2,$3,'2015-01-01','active') returning id`, [ORG, fam.id, "Ребёнок " + p.name_ru])).rows;
  await c.query(`insert into club_cards (organization_id,child_id,type,total_lessons,freeze_quota,
    price_paid,discount,start_date,end_date,status,section_id)
    values ($1,$2,'monthly',$3,0,$4,0,current_date-2,current_date+300,'active',$5)`,
    [ORG, kid.id, p.lessons_count, p.price, sec.id]);
  const [les] = (await c.query(`insert into lessons (organization_id,group_id,coach_id,date,start_time,duration_min,status)
    values ($1,$2,$3,current_date-1,'18:00',60,'completed') returning id`, [ORG, grp.id, au.id])).rows;
  await c.query(`insert into attendance (lesson_id,child_id,status) values ($1,$2,'present')`, [les.id, kid.id]);
  const [r] = (await c.query(`select amount from v_payroll_attendance where lesson_id=$1`, [les.id])).rows;
  const perLesson = (Number(p.price) / p.lessons_count).toFixed(2);
  console.log(
    p.name_ru.padEnd(33) +
    String(Number(p.price).toFixed(0)).padStart(6) +
    String(p.lessons_count).padStart(6) +
    perLesson.padStart(12) +
    String(r.amount).padStart(13));
}
await c.end();
