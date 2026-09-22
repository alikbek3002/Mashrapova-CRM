// Каталог услуг ПТ по действующему прайсу офиса. До 2026-09-17 персоналки
// продавали как обычные абонементы через card_plans («1 перс.тр», «10 перс.тр»,
// «сплит», «мини группа (3 ребенка)»), а раздел «Персональные» стоял пустым:
// у менеджеров нет права создавать услуги (§19), у директора руки не дошли.
// Идемпотентно: услуга с таким name повторно не создаётся.
// Запуск из корня репо:  node backend/scripts/seed-pt-services.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, "..", ".env"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORG = "00000000-0000-0000-0000-000000000001";

const common = {
  organization_id: ORG,
  duration_min: 60,
  activation_deadline_days: 30,
  reschedule_limit_hours: 24,
  cancel_limit_hours: 24,
  coach_edit_limit_hours: 2,
  mark_deadline_hours: 24,
  freeze_allowed: false,
  refundable: true,
  blockable: true,
  coach_percent_default: 50,
  is_active: true,
};

const services = [
  { name: "Персональная тренировка (разовая)",            type: "personal",   capacity: 1, price: 2000,  lessons_count: 1,  validity_days: 30 },
  { name: "Персональные — 10 тренировок",                 type: "personal",   capacity: 1, price: 15000, lessons_count: 10, validity_days: 90 },
  { name: "Сплит (2 участника) — разовая",                type: "mini_group", capacity: 2, price: 3000,  lessons_count: 1,  validity_days: 30 },
  { name: "Сплит (2 участника) — 10 тренировок",          type: "mini_group", capacity: 2, price: 20000, lessons_count: 10, validity_days: 90 },
  // В card_plans у «мини группа (3 ребенка)» стояло 1 занятие за 24 000 —
  // явная ошибка ввода; по прогрессии 15 000 → 20 000 → 24 000 это пакет на 10.
  { name: "Мини-группа (3 участника) — 10 тренировок",    type: "mini_group", capacity: 3, price: 24000, lessons_count: 10, validity_days: 90 },
];

const { data: existing, error: e0 } = await sb
  .from("pt_services")
  .select("id, name")
  .eq("organization_id", ORG)
  .is("deleted_at", null);
if (e0) { console.error(e0); process.exit(1); }

const have = new Set((existing ?? []).map((s) => s.name));
const toInsert = services.filter((s) => !have.has(s.name)).map((s) => ({ ...common, ...s }));
if (toInsert.length === 0) {
  console.log("Все услуги уже есть, ничего не добавлено");
  process.exit(0);
}
const { data, error } = await sb.from("pt_services").insert(toInsert).select("id, name, price, lessons_count");
if (error) { console.error(error); process.exit(1); }
for (const s of data) console.log(`+ ${s.name} — ${s.price} с / ${s.lessons_count} тр.`);
