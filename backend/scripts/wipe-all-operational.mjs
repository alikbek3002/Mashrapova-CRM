// Полная очистка всех операционных данных:
// группы (вкл. soft-deleted), расписание, занятия, посещения, дети, семьи,
// абонементы, платежи, заморозки, возвраты, лиды, заметки.
//
// НЕ трогаем: sections, profiles (тренеры/админ), organizations, auth.users.
//
// Запуск:  node backend/scripts/wipe-all-operational.mjs --yes

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env"), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const confirmed = process.argv.includes("--yes");

// FK-безопасный порядок: глубокие зависимости → вверх.
const tables = [
  "attendance",        // FK lessons + children
  "progress_notes",    // FK children
  "lesson_notes",      // FK children (CASCADE)
  "outreach_log",      // FK children (CASCADE)
  "refunds",           // FK children + club_cards
  "payments",          // FK children
  "freezes",           // FK children + club_cards
  "club_cards",        // FK children
  "enrollments",       // FK children + groups
  "lessons",           // FK groups + profiles
  "group_schedule",    // FK groups
  "groups",            // FK sections (soft-deleted остаются — здесь добиваем)
  "leads",             // FK sections (необязательно)
  "children",          // FK families
  "families",
];

const countRows = async (tbl) => {
  const { count, error } = await sb.from(tbl).select("*", { count: "exact", head: true });
  if (error) { if (error.code === "42P01") return null; throw new Error(`count ${tbl}: ${error.message}`); }
  return count ?? 0;
};
const wipe = async (tbl) => {
  const { error } = await sb.from(tbl).delete().not("id", "is", null);
  if (error) throw new Error(`delete ${tbl}: ${error.message}`);
};
const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);

console.log("=== Wipe ALL operational data ===");
console.log(`Target: ${env.SUPABASE_URL}\n`);

console.log("--- BEFORE ---");
const before = {};
for (const t of tables) {
  before[t] = await countRows(t);
  console.log(`  ${pad(t, 18)} ${before[t] ?? "(no table)"}`);
}

if (!confirmed) {
  console.log("\nDRY RUN. Перезапусти с --yes для выполнения.");
  process.exit(0);
}

console.log("\n--- DELETE ---");
for (const t of tables) {
  if (before[t] == null) { console.log(`  ${pad(t, 18)} skipped (table absent)`); continue; }
  if (before[t] === 0) { console.log(`  ${pad(t, 18)} already empty`); continue; }
  try {
    await wipe(t);
    console.log(`  ${pad(t, 18)} OK (${before[t]} rows deleted)`);
  } catch (e) {
    console.error(`  ${pad(t, 18)} FAILED — ${e.message}`);
    process.exit(2);
  }
}

console.log("\n--- AFTER ---");
for (const t of tables) console.log(`  ${pad(t, 18)} ${await countRows(t)}`);

console.log("\nГотово. Sections, profiles (тренеры/админ), organizations и auth.users не тронуты.");
