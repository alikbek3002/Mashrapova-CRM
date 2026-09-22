// Быстрая проверка: что реально в БД (с учётом soft-deleted).
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

const tables = [
  "sections", "groups", "group_schedule", "lessons",
  "attendance", "enrollments", "children", "families",
  "profiles", "club_cards", "payments",
];
for (const t of tables) {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
  console.log(`${t.padEnd(20)} total=${error ? "err: " + error.message : count}`);
}

console.log("\n--- groups (active only) ---");
{
  const { data } = await sb.from("groups").select("id, name, section_id, deleted_at").is("deleted_at", null);
  console.log(JSON.stringify(data, null, 2));
}
console.log("\n--- groups (soft-deleted) ---");
{
  const { data } = await sb.from("groups").select("id, name, section_id, deleted_at").not("deleted_at", "is", null);
  console.log(JSON.stringify(data, null, 2));
}
console.log("\n--- lessons (next 30 days) ---");
{
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from("lessons").select("id, date, start_time, group_id, status").gte("date", today).order("date").limit(20);
  console.log(JSON.stringify(data, null, 2));
}
console.log("\n--- group_schedule ---");
{
  const { data } = await sb.from("group_schedule").select("*");
  console.log(JSON.stringify(data, null, 2));
}
console.log("\n--- sections ---");
{
  const { data } = await sb.from("sections").select("id, name_ru, deleted_at");
  console.log(JSON.stringify(data, null, 2));
}
console.log("\n--- profiles (non-admin) ---");
{
  const { data } = await sb.from("profiles").select("id, full_name, role, deleted_at").neq("role", "admin");
  console.log(JSON.stringify(data, null, 2));
}
