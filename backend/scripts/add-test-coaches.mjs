// Тестовые тренеры для пилота турникетов: 7 учёток role=coach по конвенции
// <имя>@uniqum.test / <имя>12345. Номер на проходной (employeeNo для
// терминала) — 20001..20007, пишем в bio, т.к. отдельной колонки у профилей нет.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync("/Users/alikbekmukanbetov/Developer/Uniqum-Sport/backend/.env", "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORG = "00000000-0000-0000-0000-000000000001";

for (let n = 1; n <= 7; n++) {
  const slug = `coach${n}`, email = `${slug}@uniqum.test`, pass = `${slug}12345`;
  const name = `Тестовый тренер ${n}`, personNo = String(20000 + n);
  let { data: created, error } = await sb.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { full_name: name } });
  let id = created?.user?.id;
  if (!id) {
    if (error && !/already|duplicate/i.test(error.message)) { console.error(slug, "createUser:", error.message); continue; }
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 500 });
    id = list?.users.find((u) => u.email === email)?.id;
  }
  if (!id) { console.error(slug, "нет id"); continue; }
  const { error: pErr } = await sb.from("profiles").upsert({ id, organization_id: ORG, role: "coach", full_name: name, email, is_active: true });
  if (pErr) { console.error(slug, "profile:", pErr.message); continue; }
  const { error: cErr } = await sb.from("coaches").upsert({ id, bio: `Тестовый тренер (пилот турникетов). Номер на проходной: ${personNo}` });
  if (cErr) console.error(slug, "coaches:", cErr.message);
  console.log(`OK ${name} — ${email} / ${pass} — проходная № ${personNo}`);
}
