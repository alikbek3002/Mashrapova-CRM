// Разовый бэкфилл: фото, залитое на турникет, становится аватаркой в системе.
//
//   node backend/scripts/backfill-face-avatars.mjs           # dry-run
//   node backend/scripts/backfill-face-avatars.mjs --apply   # записать
//
// Новые заливки лица проставляют аватарку сами (POST /v1/hik/.../enroll),
// этот скрипт закрывает тех, кого завели на проходную ДО этой правки.
// Существующие аватарки не трогаем — перезаписывает только новая заливка.
//
//   дети     → children.photo_path = face_photo_path (тот же ключ в хранилище)
//   сотрудники → profiles.avatar_url = <API_BASE>/v1/uploads/file/<face_photo_path>
//                (путь лежит в app_metadata.access — колонок под него нет,
//                 см. backend/src/lib/hik-staff.ts)

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

const APPLY = process.argv.includes("--apply");
// Базовый URL API — из аргумента --api=... или PUBLIC_API_URL в .env.
const apiArg = process.argv.find((a) => a.startsWith("--api="));
const API_BASE = (apiArg ? apiArg.slice(6) : env.PUBLIC_API_URL ?? "").replace(/\/+$/, "");

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const log = (...a) => console.log(...a);

// ---------- дети ----------
const { data: kids, error: kErr } = await sb
  .from("children")
  .select("id, full_name, photo_path, face_photo_path")
  .not("face_photo_path", "is", null)
  .is("photo_path", null)
  .is("deleted_at", null);
if (kErr) throw kErr;

log(`Дети без аватарки, но с лицом на турникете: ${kids.length}`);
for (const k of kids) {
  log(`  ${k.full_name} → ${k.face_photo_path}`);
  if (!APPLY) continue;
  const { error } = await sb.from("children").update({ photo_path: k.face_photo_path }).eq("id", k.id);
  if (error) console.error(`  ! ${k.full_name}: ${error.message}`);
}

// ---------- сотрудники ----------
if (!API_BASE) {
  log("\nСотрудники пропущены: не задан базовый URL API (--api=https://… или PUBLIC_API_URL в .env)");
} else {
  const { data: users, error: uErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (uErr) throw uErr;
  const withFace = users.users
    .map((u) => ({ id: u.id, facePath: u.app_metadata?.access?.face_photo_path ?? null }))
    .filter((u) => u.facePath);
  const ids = withFace.map((u) => u.id);
  const { data: profiles } = ids.length
    ? await sb.from("profiles").select("id, full_name, avatar_url").in("id", ids)
    : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const todo = withFace.filter((u) => byId.has(u.id) && !byId.get(u.id).avatar_url);
  log(`\nСотрудники без аватарки, но с лицом на турникете: ${todo.length}`);
  for (const u of todo) {
    const url = `${API_BASE}/v1/uploads/file/${u.facePath}`;
    log(`  ${byId.get(u.id).full_name} → ${url}`);
    if (!APPLY) continue;
    const { error } = await sb.from("profiles").update({ avatar_url: url }).eq("id", u.id);
    if (error) console.error(`  ! ${byId.get(u.id).full_name}: ${error.message}`);
  }
}

log(APPLY ? "\nГотово (записано)." : "\nDry-run. Повторите с --apply, чтобы записать.");
