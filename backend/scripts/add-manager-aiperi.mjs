// Заводит менеджера Айпери по конвенции <имя>@uniqum.test / <имя>12345
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync("/Users/alikbekmukanbetov/Developer/Uniqum-Sport/backend/.env", "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORG = "00000000-0000-0000-0000-000000000001";
const email = "aiperi@uniqum.test", pass = "aiperi12345", name = "Айпери";

let { data: created, error } = await sb.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { full_name: name } });
let id = created?.user?.id;
if (!id) {
  if (error && !/already|duplicate/i.test(error.message)) { console.error("createUser:", error); process.exit(1); }
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 300 });
  id = list?.users.find((u) => u.email === email)?.id;
}
if (!id) { console.error("не удалось получить id"); process.exit(1); }
const { error: pErr } = await sb.from("profiles").upsert({ id, organization_id: ORG, role: "manager", full_name: name, email, is_active: true });
if (pErr) { console.error("profile:", pErr); process.exit(1); }
console.log(`OK: ${name} — ${email} / ${pass}  (id=${id})`);
