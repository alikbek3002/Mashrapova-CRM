// Seed demo data: lessons for current 2 weeks, attendance, progress notes, leads, debtors-ish state.
// Idempotent.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(resolve(__dirname, "../.env"), "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const FAMILY_ID = "00000000-0000-0000-0000-0000000000a1";
const GROUP_ID = "00000000-0000-0000-0000-0000000000b1";
const KID1 = "00000000-0000-0000-0000-0000000000c1"; // Айдана
const KID2 = "00000000-0000-0000-0000-0000000000c2"; // Эрлан

const dateAdd = (base, days) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};
const ymd = (d) => d.toISOString().slice(0, 10);
const dow = (d) => d.getDay();

const main = async () => {
  // Get coach + group + schedule
  const { data: group } = await sb.from("groups").select("id, coach_id, duration_min").eq("id", GROUP_ID).single();
  const { data: schedules } = await sb.from("group_schedule").select("*").eq("group_id", GROUP_ID);
  if (!group || !schedules?.length) { console.error("group/schedules missing"); process.exit(1); }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Range: 7 days back → 14 days forward
  const startBase = dateAdd(today, -7);
  const endBase = dateAdd(today, 14);

  console.log(`=== Generating lessons ${ymd(startBase)} → ${ymd(endBase)} ===`);

  // Wipe lessons in range to keep idempotent
  await sb.from("lessons").delete().eq("group_id", GROUP_ID).gte("date", ymd(startBase)).lt("date", ymd(endBase));

  const toInsert = [];
  for (let d = new Date(startBase); d < endBase; d.setDate(d.getDate() + 1)) {
    const sched = schedules.find((s) => s.day_of_week === dow(d));
    if (!sched) continue;
    toInsert.push({
      organization_id: ORG_ID,
      group_id: GROUP_ID,
      coach_id: group.coach_id,
      date: ymd(d),
      start_time: sched.start_time,
      duration_min: sched.duration_min,
      type: "regular",
      status: d < today ? "completed" : "scheduled",
    });
  }
  if (toInsert.length) {
    const { data: inserted, error } = await sb.from("lessons").insert(toInsert).select("id, date, status");
    if (error) throw error;
    console.log(`  inserted ${inserted.length} lessons`);

    // Attendance for past lessons
    const past = inserted.filter((l) => l.status === "completed");
    const attRows = [];
    for (const l of past) {
      // Variation: kid1 mostly present, kid2 has some absences
      attRows.push({ lesson_id: l.id, child_id: KID1, status: Math.random() < 0.85 ? "present" : "absent" });
      attRows.push({ lesson_id: l.id, child_id: KID2, status: Math.random() < 0.75 ? "present" : (Math.random() < 0.5 ? "excused" : "absent") });
    }
    if (attRows.length) {
      // Wipe and reinsert
      await sb.from("attendance").delete().in("lesson_id", past.map((l) => l.id));
      const { error: ae } = await sb.from("attendance").insert(attRows);
      if (ae) throw ae;
      console.log(`  inserted ${attRows.length} attendance rows`);
    }
  }

  // Progress notes
  console.log("=== Progress notes ===");
  await sb.from("progress_notes").delete().in("child_id", [KID1, KID2]);
  const { error: pne } = await sb.from("progress_notes").insert([
    { child_id: KID1, coach_id: group.coach_id, text: "Айдана сделала первый мост с ноги. Очень старается!", is_public: true },
    { child_id: KID1, coach_id: group.coach_id, text: "Хорошо отработала шпагат продольный — растяжка улучшается", is_public: true },
    { child_id: KID2, coach_id: group.coach_id, text: "Эрлан делает успехи в координации. Колесо почти получается.", is_public: true },
  ]);
  if (pne) throw pne;
  console.log("  3 notes added");

  // Additional leads (mock placeholders for funnel visualization)
  console.log("=== Leads ===");
  // Get sections to attach interest
  const { data: secs } = await sb.from("sections").select("id, name_ru").eq("organization_id", ORG_ID);
  await sb.from("leads").delete().eq("organization_id", ORG_ID);
  const leads = [
    { parent_name: "Аида Кенжебаева", phone: "+996 555 11 22 33", child_name: "Лейла Кенжебаева", child_age: 5, stage: "new", source: "Instagram", section_interest_id: secs[0]?.id },
    { parent_name: "Бакыт Жунусов", phone: "+996 700 22 33 44", child_name: "Алина Жунусова", child_age: 7, stage: "trial", source: "WhatsApp", section_interest_id: secs[1]?.id },
    { parent_name: "Мирлан Кенжебаев", phone: "+996 555 33 44 55", child_name: "Тимур Кенжебаев", child_age: 6, stage: "new", source: "Instagram", section_interest_id: secs[5]?.id },
    { parent_name: "Гульнара Турсунова", phone: "+996 700 44 55 66", child_name: "София Турсунова", child_age: 8, stage: "waiting", source: "Сарафан", section_interest_id: secs[3]?.id },
    { parent_name: "Эрлан Касымов", phone: "+996 770 55 66 77", child_name: "Тамерлан Касымов", child_age: 9, stage: "new", source: "Google Ads", section_interest_id: secs[4]?.id },
  ].map((l) => ({ ...l, organization_id: ORG_ID }));
  const { error: le } = await sb.from("leads").insert(leads);
  if (le) throw le;
  console.log(`  ${leads.length} leads added`);

  // Add 1 more family with a debtor child (for "Должники" card on dashboard)
  console.log("=== Extra debtor family ===");
  const FAM2 = "00000000-0000-0000-0000-0000000000a2";
  const KID3 = "00000000-0000-0000-0000-0000000000c3";
  const KID4 = "00000000-0000-0000-0000-0000000000c4";
  await sb.from("families").upsert({
    id: FAM2,
    organization_id: ORG_ID,
    father_name: "Мирлан Кенжебаев",
    father_phone: "+996 555 33 44 55",
    mother_name: "Чолпон Кенжебаева",
    mother_phone: "+996 700 99 88 77",
  });
  await sb.from("children").upsert([
    { id: KID3, organization_id: ORG_ID, family_id: FAM2, full_name: "Алина Кенжебаева", birth_date: "2014-05-22", card_number: "U-0003", status: "debtor" },
    { id: KID4, organization_id: ORG_ID, family_id: FAM2, full_name: "Бекжан Кенжебаев", birth_date: "2016-11-09", card_number: "U-0004", status: "active" },
  ]);
  // Enroll them in same group so coach sees them too
  await sb.from("enrollments").upsert([
    { child_id: KID3, group_id: GROUP_ID },
    { child_id: KID4, group_id: GROUP_ID },
  ], { onConflict: "child_id,group_id,archived_at" });
  // Card for KID3 (expired/debt)
  const { data: cardExisting } = await sb.from("club_cards").select("id").eq("child_id", KID3).maybeSingle();
  if (!cardExisting) {
    const past30 = ymd(dateAdd(today, -45));
    const past15 = ymd(dateAdd(today, -15));
    await sb.from("club_cards").insert({
      organization_id: ORG_ID,
      child_id: KID3,
      type: "monthly",
      total_lessons: 12,
      freeze_quota: 0,
      price_paid: 5000,
      discount: 0,
      start_date: past30,
      end_date: past15,
      status: "expired",
    });
  }
  // Active card for KID4 (expiring soon — dashboard "expiring" KPI)
  const { data: card4Existing } = await sb.from("club_cards").select("id").eq("child_id", KID4).maybeSingle();
  if (!card4Existing) {
    const start = ymd(dateAdd(today, -25));
    const end = ymd(dateAdd(today, 4));
    const { data: c, error: ce } = await sb.from("club_cards").insert({
      organization_id: ORG_ID,
      child_id: KID4,
      type: "monthly",
      total_lessons: 12,
      freeze_quota: 0,
      price_paid: 5000,
      discount: 0,
      start_date: start,
      end_date: end,
      status: "ending",
    }).select().single();
    if (ce) throw ce;
    await sb.from("payments").insert({
      organization_id: ORG_ID,
      child_id: KID4,
      club_card_id: c.id,
      amount: 5000,
      method: "cash",
      paid_at: dateAdd(today, -25).toISOString(),
    });
  }

  // Add a few more historical payments for revenue stats
  console.log("=== Historical payments ===");
  await sb.from("payments").delete().eq("comment", "demo-revenue");
  const histPays = [];
  for (let i = 1; i <= 8; i++) {
    histPays.push({
      organization_id: ORG_ID,
      child_id: i % 2 ? KID1 : KID4,
      amount: 4500 + (i % 3) * 500,
      method: i % 3 === 0 ? "terminal" : "cash",
      paid_at: dateAdd(today, -i * 3).toISOString(),
      comment: "demo-revenue",
    });
  }
  await sb.from("payments").insert(histPays);
  console.log(`  ${histPays.length} historical payments added`);

  // Add a pending freeze for the dashboard "Заморозки" badge
  console.log("=== Freezes ===");
  await sb.from("freezes").delete().eq("reason", "demo-vacation");
  const { data: card1 } = await sb.from("club_cards").select("id").eq("child_id", KID1).limit(1).maybeSingle();
  if (card1) {
    await sb.from("freezes").insert({
      child_id: KID1,
      club_card_id: card1.id,
      initiated_by: group.coach_id,
      initiator_role: "coach",
      reason: "demo-vacation",
      status: "pending",
    });
    console.log("  1 pending freeze");
  }

  console.log("\n=== ✅ Demo data seeded ===");
};

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
