// Импорт табеля тренера Акжола (дзюдо, июль 2026) из JSON, распарсенного
// из «База.xlsx» (лист «для загрузки»).
//
//   node scripts/import-akzhol-tabel.mjs <path-to-json> [--dry-run]
//
// Создаёт: тренера Акжола, менеджеров Эльгину и Алию, 6 групп дзюдо
// с расписанием, семьи (телефон родителя, AMO-ссылка в comment,
// ответственный менеджер), детей, клубные карты, платежи, записи в группы,
// июльские занятия + посещаемость, заморозку по травме, внутренние заметки.
// Идемпотентен: фиксированные UUID + upsert; повторный запуск безопасен.
//
// Порядок важен: карты вставляются со status='active' (иначе триггер
// trg_guard_enrollment не пустит ребёнка в группу), затем enrollments,
// и только потом refresh_lifecycle() выставляет реальные статусы.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env"), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const jsonPath = process.argv[2];
const DRY = process.argv.includes("--dry-run");
if (!jsonPath) { console.error("usage: node import-akzhol-tabel.mjs <tabel.json> [--dry-run]"); process.exit(1); }
const tabel = JSON.parse(readFileSync(jsonPath, "utf8"));

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const hex2 = (n) => n.toString(16).padStart(2, "0");
const GROUP_ID = (n) => `b1000000-0000-4000-8000-0000000000${hex2(n)}`;
const CHILD_ID = (n) => `c1000000-0000-4000-8000-0000000000${hex2(n)}`;
const FAMILY_ID = (n) => `fb000000-0000-4000-8000-0000000000${hex2(n)}`;
const CARD_ID = (n) => `ca100000-0000-4000-8000-0000000000${hex2(n)}`;
const PAY_ID = (n) => `da100000-0000-4000-8000-0000000000${hex2(n)}`;

// ---------------------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------------------

// Мужские имена контактов → father_*, остальные → mother_*.
const MALE_NAMES = new Set([
  "алмазбек", "алымбек", "бекболот", "максат", "мирзат", "руслан",
  "талгат", "хасан", "эрмек", "алибек", "дастан",
]);

// label → [суффикс id, имя группы, расписание [dow, time], вместимость]
const GROUP_DEFS = {
  "ПН.СР.ПТ 9:30":       [1, "Дзюдо пн ср пт в 09:30",           [[1, "09:30"], [3, "09:30"], [5, "09:30"]], 30],
  "ПН.СР.ПТ 19:00":      [2, "Дзюдо пн ср пт в 19:00",           [[1, "19:00"], [3, "19:00"], [5, "19:00"]], 30],
  "ВТ.ЧТ 15:30 СБ 9:30": [3, "Дзюдо вт чт в 15:30, сб в 09:30",  [[2, "15:30"], [4, "15:30"], [6, "09:30"]], 30],
  "ВТ.ЧТ 17:00 КИДС":    [4, "Дзюдо КИДС вт чт в 17:00",         [[2, "17:00"], [4, "17:00"]],               15],
  "ВТ.ЧТ 18:00 КИДС":    [5, "Дзюдо КИДС вт чт в 18:00",         [[2, "18:00"], [4, "18:00"]],               20],
  "ВТ.ЧТ 19:00 СБ 9:30": [6, "Дзюдо вт чт в 19:00, сб в 09:30",  [[2, "19:00"], [4, "19:00"], [6, "09:30"]], 35],
};

const STAFF = [
  { email: "akzhol@uniqum.test", password: "akzhol12345", role: "coach",   full_name: "Акжол" },
  { email: "elgina@uniqum.test", password: "elgina12345", role: "manager", full_name: "Эльгина" },
  { email: "aliya@uniqum.test",  password: "aliya12345",  role: "manager", full_name: "Алия" },
];

const TODAY = new Date().toISOString().slice(0, 10);

const strHash = (s) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
};
// Дат рождения в табеле нет, а children.birth_date NOT NULL —
// детерминированная псевдодата 2016–2021, помечаем заметкой не надо:
// дата уточняется менеджером при первом визите.
const fakeBirthDate = (name) => {
  const h = strHash(name);
  const y = 2016 + (h % 6);
  const m = 1 + ((h >>> 4) % 12);
  const d = 1 + ((h >>> 8) % 28);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const dowOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const norm = (s) => s.toLowerCase().replaceAll("ё", "е").trim();
const die = (msg, err) => { console.error(`FAIL ${msg}:`, err); process.exit(1); };

// ---------------------------------------------------------------------------
// 1. Сотрудники
// ---------------------------------------------------------------------------
const ensureStaff = async () => {
  const ids = {};
  for (const u of STAFF) {
    const { data: created, error } = await sb.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true,
      user_metadata: { full_name: u.full_name },
    });
    let userId = created?.user?.id;
    if (!userId) {
      if (error && !/already|duplicate/i.test(error.message)) die(`createUser ${u.email}`, error);
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      userId = list?.users.find((x) => x.email === u.email)?.id;
      if (!userId) die(`lookup ${u.email}`, "not found after create");
    }
    const { error: pErr } = await sb.from("profiles").upsert({
      id: userId, organization_id: ORG_ID, role: u.role,
      full_name: u.full_name, email: u.email, is_active: true,
    });
    if (pErr) die(`profile ${u.email}`, pErr);
    ids[u.full_name] = userId;
  }
  // расширение тренера + привязка к секции
  const { error: cErr } = await sb.from("coaches").upsert({ id: ids["Акжол"], bio: "Тренер по дзюдо" });
  if (cErr) die("coaches", cErr);
  return ids;
};

// ---------------------------------------------------------------------------
// Слияние дублей (ребёнок в двух группах) + сборка сущностей
// ---------------------------------------------------------------------------
const buildEntities = () => {
  const kids = new Map(); // normName → {name, instances: [{block, kid}]}
  for (const block of tabel.blocks) {
    for (const kid of block.kids) {
      const key = norm(kid.name);
      if (!kids.has(key)) kids.set(key, { name: kid.name, instances: [] });
      kids.get(key).instances.push({ label: block.label, kid });
    }
  }
  const score = (k) => (k.start_date ? 2 : 0) + (k.end_date ? 2 : 0) + (k.pay_sum ? 2 : 0)
    + (k.parent ? 1 : 0) + (k.amo_link ? 1 : 0) + (k.package ? 1 : 0);
  const entities = [];
  for (const { name, instances } of kids.values()) {
    instances.sort((a, b) => score(b.kid) - score(a.kid));
    const primary = instances[0].kid;
    const attendance = {}; // "label|date" → status
    for (const { label, kid } of instances) {
      for (const [date, st] of Object.entries(kid.attendance)) attendance[`${label}|${date}`] = st;
    }
    const notes = [];
    for (const { kid } of instances) {
      if (kid.coach_note) notes.push({ kind: "coach", text: kid.coach_note });
      if (kid.manager_note) notes.push({ kind: "manager", text: kid.manager_note });
      if (kid.start_text && !kid.start_text.startsWith("с ") && !kid.start_date)
        notes.push({ kind: "manager", text: kid.start_text }); // «бронь на сентябрь», травма и т.п.
    }
    entities.push({
      name, primary,
      labels: [...new Set(instances.map((i) => i.label))],
      attendance, notes,
      manager: primary.manager,
      parent: instances.map((i) => i.kid.parent).find(Boolean) ?? null,
      amo_link: instances.map((i) => i.kid.amo_link).find(Boolean) ?? null,
      amo_note: instances.map((i) => i.kid.amo_note).find(Boolean) ?? null,
      has_contract: instances.some((i) => i.kid.has_contract),
    });
  }
  return entities;
};

// Карта: реальные границы или июльская заглушка (0 сом) — только чтобы
// пройти enrollment guard; такие дети помечаются заметкой.
const cardFor = (ent) => {
  const k = ent.primary;
  const attDates = Object.keys(ent.attendance).map((s) => s.split("|")[1]).sort();
  let start = k.start_date;
  let end = k.end_date;
  let placeholder = false;
  if (!start && !end) {
    start = attDates[0] ?? "2026-07-01";
    end = addDays(start, 30);
    placeholder = true;
  } else if (!start) {
    start = attDates[0] ?? addDays(end, -30);
  } else if (!end) {
    end = addDays(start, (k.months ?? 1) * 30);
  }
  const isKids = ent.labels.some((l) => l.includes("КИДС"));
  const months = k.months ?? 1;
  const totalLessons = k.package ?? k.lessons_pack_from_text ?? (isKids ? months * 8 : months * 12);
  const type = months >= 3 || totalLessons >= 24 ? "quarterly" : "monthly";
  return {
    start, end, type, totalLessons, placeholder,
    freezeQuota: k.freeze_left ?? (type === "quarterly" ? 3 : 0),
    price: k.pay_sum ?? 0,
  };
};

// ---------------------------------------------------------------------------
const main = async () => {
  // --- справочные id ---
  const { data: section } = await sb.from("sections")
    .select("id").eq("name_ru", "Дзюдо").is("deleted_at", null).single();
  if (!section) die("section", "Секция «Дзюдо» не найдена");
  const SECTION_ID = section.id;

  const entities = buildEntities();
  console.log(`Детей (уникальных): ${entities.length}; групп: ${tabel.blocks.length}`);
  if (DRY) {
    for (const e of entities.slice(0, 10)) console.log(" ", e.name, e.labels, cardFor(e));
    console.log("--dry-run: изменений нет");
    return;
  }

  // --- сотрудники ---
  const staffIds = await ensureStaff();
  const { data: profs } = await sb.from("profiles").select("id, full_name, role").neq("role", "parent");
  const byName = (frag) => profs?.find((p) => norm(p.full_name).startsWith(norm(frag)))?.id ?? null;
  const managerIds = {
    "Акмарал": byName("Акмарал"),
    "Эльгина": staffIds["Эльгина"],
    "Алия": staffIds["Алия"],
    "Малика": byName("Малика"),
  };
  const COACH_ID = staffIds["Акжол"];
  await sb.from("section_coaches").upsert({ section_id: SECTION_ID, coach_id: COACH_ID });
  console.log("Сотрудники:", { COACH_ID, ...managerIds });

  // --- группы + расписание ---
  const groupIdByLabel = {};
  for (const block of tabel.blocks) {
    const def = GROUP_DEFS[block.label];
    if (!def) die("group def", `нет определения для «${block.label}»`);
    const [n, gname, sched, cap] = def;
    const gid = GROUP_ID(n);
    groupIdByLabel[block.label] = gid;
    const { error: gErr } = await sb.from("groups").upsert({
      id: gid, organization_id: ORG_ID, section_id: SECTION_ID, coach_id: COACH_ID,
      name: gname, max_capacity: cap, hard_limit_override: true,
      duration_min: 60, is_active: true,
    });
    if (gErr) die(`group ${gname}`, gErr);
    await sb.from("group_schedule").delete().eq("group_id", gid);
    for (const [dow, time] of sched) {
      const { error } = await sb.from("group_schedule").insert({
        group_id: gid, day_of_week: dow, start_time: time, duration_min: 60,
      });
      if (error) die(`schedule ${gname}`, error);
    }
  }
  console.log("Группы созданы:", Object.values(groupIdByLabel).length);

  // --- семьи: группируем по телефону родителя ---
  const famKey = (ent) => ent.parent?.phone ?? `solo:${norm(ent.name)}`;
  const famIndex = new Map();
  for (const ent of entities) {
    const key = famKey(ent);
    if (!famIndex.has(key)) famIndex.set(key, { idx: famIndex.size + 1, members: [] });
    famIndex.get(key).members.push(ent);
  }
  let famCount = 0;
  for (const { idx, members } of famIndex.values()) {
    const fid = FAMILY_ID(idx);
    const ent = members.find((m) => m.parent) ?? members[0];
    const p = ent.parent;
    const isFather = p?.name && MALE_NAMES.has(norm(p.name));
    const commentParts = [];
    if (ent.amo_link) commentParts.push(`AMO: ${ent.amo_link}`);
    if (ent.amo_note) commentParts.push(ent.amo_note);
    if (ent.has_contract) commentParts.push("Договор подписан");
    const { error } = await sb.from("families").upsert({
      id: fid, organization_id: ORG_ID,
      father_name: isFather ? p.name : null,
      father_phone: isFather ? p.phone : null,
      mother_name: !isFather ? (p?.name ?? null) : null,
      mother_phone: !isFather ? (p?.phone ?? null) : null,
      responsible_manager_id: managerIds[ent.manager] ?? null,
      comment: commentParts.join("\n") || null,
    });
    if (error) die(`family ${ent.name}`, error);
    for (const m of members) m.familyId = fid;
    famCount++;
  }
  console.log("Семей:", famCount);

  // --- дети ---
  entities.forEach((ent, i) => { ent.childId = CHILD_ID(i + 1); });
  for (const ent of entities) {
    const { error } = await sb.from("children").upsert({
      id: ent.childId, organization_id: ORG_ID, family_id: ent.familyId,
      full_name: ent.name, birth_date: fakeBirthDate(ent.name),
      status: "active", responsible_manager_id: managerIds[ent.manager] ?? null,
    });
    if (error) die(`child ${ent.name}`, error);
  }
  console.log("Детей:", entities.length);

  // --- карты (пока все active — для enrollment guard) ---
  let placeholders = 0;
  for (const [i, ent] of entities.entries()) {
    const c = cardFor(ent);
    ent.card = c;
    ent.cardId = CARD_ID(i + 1);
    if (c.placeholder) placeholders++;
    const { error } = await sb.from("club_cards").upsert({
      id: ent.cardId, organization_id: ORG_ID, child_id: ent.childId,
      type: c.type, total_lessons: c.totalLessons, freeze_quota: c.freezeQuota,
      price_paid: c.price, discount: 0, start_date: c.start, end_date: c.end,
      status: "active", section_id: SECTION_ID,
    });
    if (error) die(`card ${ent.name}`, error);
  }
  console.log(`Карт: ${entities.length} (заглушек без дат/цены: ${placeholders})`);

  // --- платежи ---
  let payCount = 0;
  for (const [i, ent] of entities.entries()) {
    const k = ent.primary;
    if (!k.pay_date || !k.pay_sum) continue;
    const { error } = await sb.from("payments").upsert({
      id: PAY_ID(i + 1), organization_id: ORG_ID, child_id: ent.childId,
      club_card_id: ent.cardId, amount: k.pay_sum, currency: "KGS", method: "cash",
      received_by: managerIds[ent.manager] ?? null,
      paid_at: `${k.pay_date}T10:00:00+06:00`,
    });
    if (error) die(`payment ${ent.name}`, error);
    payCount++;
  }
  console.log("Платежей:", payCount);

  // --- записи в группы ---
  const { data: existingEnr } = await sb.from("enrollments")
    .select("child_id, group_id").is("archived_at", null);
  const enrKeys = new Set((existingEnr ?? []).map((e) => `${e.child_id}|${e.group_id}`));
  let enrCount = 0;
  for (const ent of entities) {
    for (const label of ent.labels) {
      const gid = groupIdByLabel[label];
      if (enrKeys.has(`${ent.childId}|${gid}`)) continue;
      const { error } = await sb.from("enrollments").insert({
        child_id: ent.childId, group_id: gid,
        start_date: ent.card.placeholder ? null : ent.card.start,
        end_date: ent.card.placeholder ? null : ent.card.end,
      });
      if (error) { console.error(`  enrollment ${ent.name} → ${label}: ${error.message}`); continue; }
      enrCount++;
    }
  }
  console.log("Записей в группы (новых):", enrCount);

  // --- занятия июля ---
  const lessonIdByKey = {}; // "label|date" → lesson id
  for (const block of tabel.blocks) {
    const gid = groupIdByLabel[block.label];
    const sched = Object.fromEntries(GROUP_DEFS[block.label][2].map(([d, t]) => [d, t]));
    const { data: existing } = await sb.from("lessons")
      .select("id, date").eq("group_id", gid)
      .gte("date", "2026-07-01").lte("date", "2026-07-31");
    const byDate = Object.fromEntries((existing ?? []).map((l) => [l.date, l.id]));
    for (const date of block.dates) {
      if (byDate[date]) { lessonIdByKey[`${block.label}|${date}`] = byDate[date]; continue; }
      const time = sched[dowOf(date)];
      if (!time) { console.error(`  ${block.label}: дата ${date} вне расписания, пропуск`); continue; }
      const { data: lesson, error } = await sb.from("lessons").insert({
        organization_id: ORG_ID, group_id: gid, coach_id: COACH_ID,
        date, start_time: time, duration_min: 60, type: "regular", status: "completed",
      }).select("id").single();
      if (error) die(`lesson ${block.label} ${date}`, error);
      lessonIdByKey[`${block.label}|${date}`] = lesson.id;
    }
  }
  console.log("Занятий июля:", Object.keys(lessonIdByKey).length);

  // --- посещаемость ---
  const attRows = [];
  for (const ent of entities) {
    for (const [key, status] of Object.entries(ent.attendance)) {
      const lessonId = lessonIdByKey[key];
      if (!lessonId) { console.error(`  нет занятия для ${ent.name} ${key}`); continue; }
      attRows.push({
        lesson_id: lessonId, child_id: ent.childId, status,
        marked_by: COACH_ID, marked_at: `${key.split("|")[1]}T12:00:00+06:00`,
      });
    }
  }
  for (let i = 0; i < attRows.length; i += 400) {
    const chunk = attRows.slice(i, i + 400);
    const { error } = await sb.from("attendance").upsert(chunk, { onConflict: "lesson_id,child_id" });
    if (error) die("attendance chunk", error);
  }
  console.log("Отметок посещаемости:", attRows.length);

  // --- заморозка по травме (саттыбеков аслан) ---
  const frozen = entities.find((e) => norm(e.name).includes("саттыбеков"));
  if (frozen) {
    const { data: exists } = await sb.from("freezes")
      .select("id").eq("child_id", frozen.childId).eq("status", "approved").maybeSingle();
    if (!exists) {
      const { error } = await sb.from("freezes").insert({
        child_id: frozen.childId, club_card_id: frozen.cardId,
        initiated_by: managerIds[frozen.manager] ?? COACH_ID, initiator_role: "manager",
        reason: "Травма — тренировки заморожены на неопределённый срок",
        status: "approved", approved_by: managerIds[frozen.manager] ?? null,
        approved_at: new Date().toISOString(),
        start_date: frozen.card.end, end_date: null,
      });
      if (error) console.error("  freeze:", error.message);
      else console.log(`Заморозка: ${frozen.name}`);
    }
  }

  // --- внутренние заметки ---
  const { data: oldNotes } = await sb.from("child_internal_notes")
    .select("child_id, text").in("child_id", entities.map((e) => e.childId));
  const noteKeys = new Set((oldNotes ?? []).map((n) => `${n.child_id}|${n.text}`));
  let noteCount = 0;
  for (const ent of entities) {
    const texts = new Set(ent.notes.map((n) => n.text));
    for (const text of texts) {
      if (noteKeys.has(`${ent.childId}|${text}`)) continue;
      const kind = ent.notes.find((n) => n.text === text).kind;
      const { error } = await sb.from("child_internal_notes").insert({
        organization_id: ORG_ID, child_id: ent.childId,
        author_id: kind === "coach" ? COACH_ID : (managerIds[ent.manager] ?? null),
        text,
      });
      if (error) console.error(`  note ${ent.name}:`, error.message);
      else noteCount++;
    }
  }
  console.log("Заметок:", noteCount);

  // --- жизненный цикл: реальные статусы карт/заморозок ---
  const { error: rlErr } = await sb.rpc("refresh_lifecycle");
  if (rlErr) console.error("refresh_lifecycle:", rlErr.message);

  // --- статусы детей по фактическому статусу карт ---
  const { data: cards } = await sb.from("club_cards")
    .select("child_id, status").in("child_id", entities.map((e) => e.childId));
  const statusByChild = {};
  for (const c of cards ?? []) {
    const rank = { frozen: 3, active: 2, ending: 2, expired: 1, debt: 1, archived: 0 };
    const cur = statusByChild[c.child_id];
    if (!cur || (rank[c.status] ?? 0) > (rank[cur] ?? 0)) statusByChild[c.child_id] = c.status;
  }
  for (const ent of entities) {
    const cs = statusByChild[ent.childId];
    const status = cs === "frozen" ? "frozen" : (cs === "active" || cs === "ending") ? "active" : "expired";
    await sb.from("children").update({ status }).eq("id", ent.childId);
  }
  console.log("Статусы детей обновлены");

  // --- сводка ---
  console.log("\n=== Проверка ===");
  for (const block of tabel.blocks) {
    const gid = groupIdByLabel[block.label];
    const { count } = await sb.from("enrollments")
      .select("*", { count: "exact", head: true }).eq("group_id", gid).is("archived_at", null);
    console.log(`  ${GROUP_DEFS[block.label][1]}: записано ${count} (в табеле ${block.kids.length})`);
  }
  const { count: attTotal } = await sb.from("attendance")
    .select("*", { count: "exact", head: true })
    .in("child_id", entities.map((e) => e.childId));
  console.log(`  посещаемость: ${attTotal} отметок`);
};

main().catch((e) => { console.error("❌", e); process.exit(1); });
