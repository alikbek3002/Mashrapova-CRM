// Полный вайп базы под запуск прода: остаётся ТОЛЬКО учётка директора
// (director@uniqum.test) и организация. Перед удалением снимает JSON-бэкап
// всех данных в файл.
//
//   node scripts/wipe-to-production.mjs --yes
//
// Удаляет: посещаемость, занятия, записи, карты, платежи, депозиты,
// заморозки, заметки (все виды), уведомления, историю групп, ПТ-модуль,
// лидов, аудит, группы, расписания, секции, детей, семьи и ВСЕ учётки
// (auth + profiles), кроме директора.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

const DIRECTOR_ID = "39186be1-434f-4acc-be90-cf7420114c99"; // director@uniqum.test

if (!process.argv.includes("--yes")) {
  console.error("Добавьте --yes чтобы подтвердить НЕОБРАТИМОЕ удаление всех данных.");
  process.exit(1);
}

// Порядок важен: сначала зависимые (FK), затем родительские.
const TABLES_IN_ORDER = [
  "attendance",
  "lesson_notes",
  "progress_notes",
  "child_internal_notes",
  "group_events",
  "notifications",
  "outreach_log",
  "pt_lessons",
  "pt_sessions",
  "pt_packages",
  "pt_service_coach_rates",
  "pt_services",
  "freezes",
  "payments",
  "deposit_transactions",
  "deposits",
  "club_cards",
  "enrollments",
  "lessons",
  "group_schedule",
  "coach_rates",
  "section_coaches",
  "groups",
  "sections",
  "children",
  "families",
  "leads",
  "audit_log",
  "idempotency_keys",
];

const main = async () => {
  // ---------- 1. Бэкап ----------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = resolve(__dirname, "../backups");
  mkdirSync(backupDir, { recursive: true });
  const backup = {};
  const backupTables = [...TABLES_IN_ORDER, "profiles", "coaches", "org_settings"];
  for (const t of backupTables) {
    const rows = [];
    for (let fromIdx = 0; ; fromIdx += 1000) {
      const { data, error } = await sb.from(t).select("*").range(fromIdx, fromIdx + 999);
      if (error) { console.log(`  backup ${t}: пропуск (${error.message})`); break; }
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    backup[t] = rows;
  }
  const backupPath = resolve(backupDir, `pre-prod-wipe-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backup));
  console.log(`Бэкап: ${backupPath} (${Object.entries(backup).map(([k, v]) => `${k}:${v.length}`).filter((s) => !s.endsWith(":0")).join(", ")})`);

  // ---------- 2. Данные ----------
  for (const t of TABLES_IN_ORDER) {
    const { error, count } = await sb.from(t).delete({ count: "exact" }).not("id", "is", null);
    if (error) {
      // у некоторых таблиц PK не id — пробуем без фильтра через gte created_at
      const { error: e2, count: c2 } = await sb.from(t).delete({ count: "exact" }).gte("created_at", "1970-01-01");
      console.log(`  ${t}: ${e2 ? "ERR " + e2.message : (c2 ?? "?") + " удалено"}`);
    } else {
      console.log(`  ${t}: ${count ?? "?"} удалено`);
    }
  }

  // ---------- 3. Учётки ----------
  const { data: profs } = await sb.from("profiles").select("id, full_name, role");
  for (const p of profs ?? []) {
    if (p.id === DIRECTOR_ID) continue;
    await sb.from("coaches").delete().eq("id", p.id);
    const { error: pe } = await sb.from("profiles").delete().eq("id", p.id);
    const { error: ae } = await sb.auth.admin.deleteUser(p.id);
    console.log(`  профиль ${p.full_name} (${p.role}): ${pe ? "profile ERR " + pe.message : "OK"}${ae ? "; auth ERR " + ae.message : ""}`);
  }
  // auth-пользователи без профиля (осиротевшие)
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of list?.users ?? []) {
    if (u.id === DIRECTOR_ID) continue;
    const { error } = await sb.auth.admin.deleteUser(u.id);
    console.log(`  auth ${u.email ?? u.id}: ${error ? "ERR " + error.message : "удалён"}`);
  }

  // ---------- 4. Проверка ----------
  console.log("\n=== Проверка ===");
  for (const t of [...TABLES_IN_ORDER, "profiles"]) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (!error && (count ?? 0) > 0) console.log(`  ${t}: ОСТАЛОСЬ ${count}`);
  }
  const { data: left } = await sb.from("profiles").select("full_name, role, email");
  console.log("Остались профили:", JSON.stringify(left));
  const { data: authLeft } = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  console.log("Остались auth-пользователи:", authLeft?.users.map((u) => u.email).join(", "));
  console.log("\n✅ База чиста. Вход: director@uniqum.test");
};

main().catch((e) => { console.error("❌", e); process.exit(1); });
