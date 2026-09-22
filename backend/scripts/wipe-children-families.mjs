// Полная очистка: дети + семьи + все зависящие от них таблицы.
// Тренеры, секции, группы, лиды — НЕ трогаем.
//
// Запуск:
//   node backend/scripts/wipe-children-families.mjs --yes
//
// Без флага --yes скрипт только выведет, что собирается удалить, и завершится.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(resolve(__dirname, "../.env"), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env");
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const args = new Set(process.argv.slice(2));
const confirmed = args.has("--yes");

// Порядок важен: глубокие зависимости -> вверх.
// Все таблицы, ссылающиеся на children/families.
const tables = [
  "lesson_notes",     // FK -> children (CASCADE, но удалим явно)
  "outreach_log",     // FK -> children (CASCADE, но удалим явно)
  "attendance",       // FK -> children
  "progress_notes",   // FK -> children
  "refunds",          // FK -> children + club_cards
  "payments",         // FK -> children
  "freezes",          // FK -> children + club_cards
  "club_cards",       // FK -> children
  "enrollments",      // FK -> children
  "children",         // FK -> families
  "families",
];

const countRows = async (tbl) => {
  const { count, error } = await sb.from(tbl).select("*", { count: "exact", head: true });
  if (error) {
    if (error.code === "42P01") return null; // table does not exist
    throw new Error(`count ${tbl}: ${error.message}`);
  }
  return count ?? 0;
};

const wipe = async (tbl) => {
  // .delete() требует фильтра — используем условие "id не null" чтобы стереть всё.
  const { error } = await sb.from(tbl).delete().not("id", "is", null);
  if (error) throw new Error(`delete ${tbl}: ${error.message}`);
};

const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);

console.log("=== Wipe: children + families + dependants ===");
console.log(`Target: ${url}`);
console.log("");

console.log("--- BEFORE ---");
const before = {};
for (const t of tables) {
  const c = await countRows(t);
  before[t] = c;
  console.log(`  ${pad(t, 18)} ${c ?? "(no table)"}`);
}

if (!confirmed) {
  console.log("");
  console.log("DRY RUN. Чтобы выполнить удаление, перезапусти с флагом --yes:");
  console.log("  node backend/scripts/wipe-children-families.mjs --yes");
  process.exit(0);
}

console.log("");
console.log("--- DELETE ---");
for (const t of tables) {
  if (before[t] == null) {
    console.log(`  ${pad(t, 18)} skipped (table absent)`);
    continue;
  }
  if (before[t] === 0) {
    console.log(`  ${pad(t, 18)} already empty`);
    continue;
  }
  try {
    await wipe(t);
    console.log(`  ${pad(t, 18)} OK (${before[t]} rows deleted)`);
  } catch (e) {
    console.error(`  ${pad(t, 18)} FAILED — ${e.message}`);
    process.exit(2);
  }
}

console.log("");
console.log("--- AFTER ---");
for (const t of tables) {
  const c = await countRows(t);
  console.log(`  ${pad(t, 18)} ${c ?? "(no table)"}`);
}

console.log("");
console.log("Готово. БД очищена от детей и семей. Логины (auth.users), тренеры,");
console.log("секции, группы, лиды, организация и твой admin-профиль не тронуты.");
