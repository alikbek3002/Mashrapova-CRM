// One-shot seed: creates 3 test users (admin, coach, parent) + minimal demo data.
// Run: node scripts/seed-test-users.mjs
// Idempotent: safe to re-run.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env manually (no dotenv dep)
const envText = readFileSync(resolve(__dirname, "../.env"), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG_ID = "00000000-0000-0000-0000-000000000001";

// Вход по телефону: логин = телефон, в Supabase Auth он хранится как
// «996XXXXXXXXX@staff.mashrapov.local» (как делает бэкенд, lib/phone.ts).
// Пароль у всех тестовых учёток один — сменить перед боевыми данными.
const TEST_PASSWORD = "mashrapova2026";
const users = [
  { phone: "+996700000000", role: "director",         full_name: "Айбек Директор" },
  { phone: "+996700000005", role: "fitness_director", full_name: "Эльдар Управляющий" },
  { phone: "+996700000003", role: "senior_manager",   full_name: "Айгерим Ст. менеджер" },
  { phone: "+996700000004", role: "manager",          full_name: "Нурлан Менеджер" },
  { phone: "+996700000006", role: "cashier",          full_name: "Бегимай Ресепшен" },
  { phone: "+996700000001", role: "coach",            full_name: "Азамат Тренер" },
  { phone: "+996700000002", role: "parent",           full_name: "Айгуль Родитель" },
].map((u) => ({ ...u, email: `${u.phone.slice(1)}@staff.mashrapov.local`, password: TEST_PASSWORD }));

const upsertUser = async (u) => {
  // Try create; if exists, find by email
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { full_name: u.full_name },
  });
  if (created?.user) return created.user;
  if (createErr && !/already been registered|already exists|duplicate/i.test(createErr.message)) {
    throw createErr;
  }
  // Look up
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw listErr;
  const found = list.users.find((x) => x.email === u.email);
  if (!found) throw new Error(`Could not find user ${u.email} after create error`);
  // Update password for idempotency
  await supabase.auth.admin.updateUserById(found.id, { password: u.password });
  return found;
};

const main = async () => {
  // Pre-step: legacy admin@mashrapov.test got migrated to role=director by
  // 20260510000001. Rename its email to director@mashrapov.test so the new
  // seed below doesn't create a duplicate director account. Idempotent.
  console.log("=== Reconciling legacy admin → director ===");
  const { data: list0 } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const legacyAdmin = list0?.users.find((x) => x.email === "admin@mashrapov.test");
  const newDirector = list0?.users.find((x) => x.email === "director@mashrapov.test");
  if (legacyAdmin && !newDirector) {
    await supabase.auth.admin.updateUserById(legacyAdmin.id, {
      email: "director@mashrapov.test",
      email_confirm: true,
    });
    await supabase.from("profiles").update({ email: "director@mashrapov.test" }).eq("id", legacyAdmin.id);
    console.log("  renamed admin@mashrapov.test → director@mashrapov.test");
  } else if (legacyAdmin && newDirector) {
    console.log("  WARN: both admin@ and director@ exist — leaving alone, please clean up manually");
  }

  console.log("=== Seeding auth users ===");
  const usersById = {};
  for (const u of users) {
    const user = await upsertUser(u);
    usersById[u.role] = user.id;
    console.log(`  ${u.role.padEnd(7)} → ${u.email}  id=${user.id}`);

    // Upsert profile
    const { error: profErr } = await supabase.from("profiles").upsert({
      id: user.id,
      organization_id: ORG_ID,
      role: u.role,
      full_name: u.full_name,
      email: u.email,
      phone: u.phone,
      is_active: true,
    });
    if (profErr) throw profErr;
  }

  // Coach extension
  console.log("=== Coach record ===");
  const { error: coachErr } = await supabase.from("coaches").upsert({
    id: usersById.coach,
    bio: "Мастер спорта по боксу",
    achievements: "КМС",
    experience_years: 8,
  });
  if (coachErr) throw coachErr;

  // Family — parent linked
  console.log("=== Family + children ===");
  const FAMILY_ID = "00000000-0000-0000-0000-0000000000a1";
  const { error: famErr } = await supabase.from("families").upsert({
    id: FAMILY_ID,
    organization_id: ORG_ID,
    parent_user_id: usersById.parent,
    father_name: "Болот Жанышев",
    father_phone: "+996 700 111 222",
    mother_name: "Айгуль Жанышева",
    mother_phone: "+996 700 333 444",
  });
  if (famErr) throw famErr;

  const children = [
    { id: "00000000-0000-0000-0000-0000000000c1", full_name: "Айдана Жанышева", birth_date: "2015-04-12", card_number: "M-0001" },
    { id: "00000000-0000-0000-0000-0000000000c2", full_name: "Эрлан Жанышев", birth_date: "2017-08-30", card_number: "M-0002" },
  ];
  for (const c of children) {
    const { error } = await supabase.from("children").upsert({
      ...c,
      organization_id: ORG_ID,
      family_id: FAMILY_ID,
    });
    if (error) throw error;
    console.log(`  child → ${c.full_name}`);
  }

  // Get a section to attach group
  const { data: sections, error: secErr } = await supabase
    .from("sections")
    .select("id,name_ru")
    .eq("organization_id", ORG_ID)
    .limit(1);
  if (secErr) throw secErr;
  if (!sections?.length) throw new Error("No sections seeded");
  const SECTION_ID = sections[0].id;

  // Link coach to section
  await supabase.from("section_coaches").upsert({ section_id: SECTION_ID, coach_id: usersById.coach });

  // Group
  console.log("=== Group + schedule + enrollments ===");
  const GROUP_ID = "00000000-0000-0000-0000-0000000000b1";
  const { error: grpErr } = await supabase.from("groups").upsert({
    id: GROUP_ID,
    organization_id: ORG_ID,
    section_id: SECTION_ID,
    coach_id: usersById.coach,
    name: "Бокс · Дети 8–12",
    max_capacity: 12,
    duration_min: 60,
  });
  if (grpErr) throw grpErr;

  // Schedule (Mon/Wed/Fri 16:00)
  const { error: schedDelErr } = await supabase
    .from("group_schedule")
    .delete()
    .eq("group_id", GROUP_ID);
  if (schedDelErr) throw schedDelErr;
  for (const dow of [1, 3, 5]) {
    await supabase.from("group_schedule").insert({
      group_id: GROUP_ID,
      day_of_week: dow,
      start_time: "16:00",
      duration_min: 60,
    });
  }

  // Enrollments
  for (const c of children) {
    await supabase.from("enrollments").upsert({
      child_id: c.id,
      group_id: GROUP_ID,
    });
  }

  // Active club card for the first child
  console.log("=== Club card + payment ===");
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const { data: existingCard } = await supabase
    .from("club_cards")
    .select("id")
    .eq("child_id", children[0].id)
    .eq("status", "active")
    .maybeSingle();
  if (!existingCard) {
    const { data: card, error: cardErr } = await supabase
      .from("club_cards")
      .insert({
        organization_id: ORG_ID,
        child_id: children[0].id,
        type: "monthly",
        total_lessons: 12,
        freeze_quota: 0,
        price_paid: 2500,
        discount: 0,
        start_date: start,
        end_date: end,
        status: "active",
      })
      .select()
      .single();
    if (cardErr) throw cardErr;
    await supabase.from("payments").insert({
      organization_id: ORG_ID,
      child_id: children[0].id,
      club_card_id: card.id,
      amount: 2500,
      method: "cash",
      received_by: usersById.director,
    });
  }

  console.log("\n=== ✅ Seed complete ===");
  console.log("Login credentials:");
  console.log("  ROLE              PHONE            PASSWORD");
  for (const u of users) {
    console.log(`  ${u.role.padEnd(17)} ${u.phone.padEnd(16)} ${u.password}`);
  }
};

main().catch((e) => {
  console.error("\n❌ Seed failed:", e);
  process.exit(1);
});
