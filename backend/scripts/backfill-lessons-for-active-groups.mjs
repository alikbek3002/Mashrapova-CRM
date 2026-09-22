// Одноразовый backfill: для каждой активной группы материализует lessons
// на 8 недель ВПЕРЁД, начиная с понедельника текущей недели (KGT = UTC+6).
// По умолчанию: удаляет все будущие scheduled-занятия и перегенерирует
// (чтобы убрать прежние сдвинутые из-за TZ-бага даты).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env"), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Локальная YYYY-MM-DD: считаем "сегодня" в часовом поясе Бишкека (UTC+6).
const KGT_OFFSET_HOURS = 6;
const todayKGT = () => {
  const now = new Date();
  const shifted = new Date(now.getTime() + KGT_OFFSET_HOURS * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
};
const dowOf = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const addDaysStr = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const mondayOfWeek = (s) => {
  // dowOf: 0=Sun..6=Sat → Mon=1, нам нужен сдвиг к Mon
  const dow = dowOf(s); // 0..6
  const back = (dow + 6) % 7; // Mon=0..Sun=6
  return addDaysStr(s, -back);
};

const today = todayKGT();
const fromStr = mondayOfWeek(today);
const toStr = addDaysStr(fromStr, 56);

console.log(`Today (KGT): ${today}`);
console.log(`Generating lessons in range: ${fromStr} → ${toStr}\n`);

const { data: groups, error: gErr } = await sb
  .from("groups")
  .select("id, name, organization_id, coach_id")
  .is("deleted_at", null);
if (gErr) { console.error(gErr); process.exit(1); }

let totalInserted = 0;
let totalDeleted = 0;
const wipeFutureScheduled = process.argv.includes("--regenerate");

for (const g of groups ?? []) {
  const { data: schedules } = await sb
    .from("group_schedule")
    .select("day_of_week, start_time, duration_min")
    .eq("group_id", g.id);
  if (!schedules || schedules.length === 0) {
    console.log(`  ${g.name}: no schedule, skipped`);
    continue;
  }

  if (wipeFutureScheduled) {
    const { data: del, error: delErr } = await sb
      .from("lessons")
      .delete()
      .eq("group_id", g.id)
      .eq("status", "scheduled")
      .gte("date", fromStr)
      .select("id");
    if (delErr) { console.error(`  ${g.name}: delete FAILED — ${delErr.message}`); continue; }
    totalDeleted += del?.length ?? 0;
    if (del?.length) console.log(`  ${g.name}: deleted ${del.length} stale scheduled lessons`);
  }

  const { data: existing } = await sb
    .from("lessons")
    .select("date, start_time")
    .eq("group_id", g.id)
    .gte("date", fromStr)
    .lte("date", toStr);
  const exKeys = new Set((existing ?? []).map((l) => `${l.date}_${l.start_time}`));

  const toInsert = [];
  let cursor = fromStr;
  while (cursor <= toStr) {
    const dow = dowOf(cursor);
    for (const s of schedules.filter((s) => s.day_of_week === dow)) {
      const key = `${cursor}_${s.start_time}`;
      if (exKeys.has(key)) continue;
      toInsert.push({
        organization_id: g.organization_id,
        group_id: g.id,
        coach_id: g.coach_id,
        date: cursor,
        start_time: s.start_time,
        duration_min: s.duration_min,
        type: "regular",
        status: "scheduled",
      });
    }
    cursor = addDaysStr(cursor, 1);
  }

  if (toInsert.length === 0) { console.log(`  ${g.name}: nothing to insert`); continue; }
  const { error: insErr } = await sb.from("lessons").insert(toInsert);
  if (insErr) { console.error(`  ${g.name}: insert FAILED — ${insErr.message}`); continue; }
  console.log(`  ${g.name}: inserted ${toInsert.length} lessons`);
  totalInserted += toInsert.length;
}
console.log(`\nDeleted: ${totalDeleted}  Inserted: ${totalInserted}`);
console.log(`\nЗапусти с --regenerate чтобы стереть будущие scheduled и пересоздать.`);
