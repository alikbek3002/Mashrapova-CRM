// Импорт прод-табеля августа 2026 («Для загрузки 08.08.xlsx» → JSON от
// parse-august-tabel.py) — 16 тренеров, 52 группы, ~646 детей.
//
//   node scripts/import-august-tabel.mjs scripts/data/august-tabel-2026-08.json [--dry-run]
//
// Правило клиента (аудио 08.08): «остаток тренировок» в файле актуален на
// 01.08; каждое прошедшее занятие группы 01.08–08.08 сгорает независимо от
// посещения, КРОМЕ отметок «зам» (заморозка). Система же считает
// remaining = total_lessons − present(в окне карты), поэтому в карту пишем:
//   total_lessons = max(0, остаток_01.08 − burned) + present
// где burned = занятия группы в окне [max(start,01.08) .. min(end,08.08)]
// без «зам»; present — отметки «1» в том же окне. Тогда remaining в системе
// равен клиентскому остатку, посещаемость честная.
//
// Идемпотентен: фиксированные UUID + upsert. Порядок: карты active →
// enrollments (trg_guard_enrollment) → refresh_lifecycle().

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
// Ретрай сетевых сбоев (ETIMEDOUT и т.п.): один флейк не должен убивать
// многоминутный прогон. HTTP-ошибки (4xx/5xx) не ретраим — их видит вызов.
const baseFetch = globalThis.fetch;
const retryFetch = async (url, opts) => {
  for (let a = 1; ; a++) {
    try { return await baseFetch(url, opts); }
    catch (e) {
      if (a >= 5) throw e;
      console.error(`  … сетевой сбой (${e.cause?.code ?? e.message}), ретрай ${a}/4`);
      await new Promise((r) => setTimeout(r, a * 1500));
    }
  }
};
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: retryFetch },
});

const jsonPath = process.argv[2];
const DRY = process.argv.includes("--dry-run");
if (!jsonPath) { console.error("usage: node import-august-tabel.mjs <tabel.json> [--dry-run]"); process.exit(1); }
const tabel = JSON.parse(readFileSync(resolve(jsonPath), "utf8"));

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const CUTOFF = "2026-08-08"; // последняя отмеченная дата файла; сгорание считаем по неё включительно
const AUG1 = "2026-08-01";
const hex12 = (n) => n.toString(16).padStart(12, "0");
const GROUP_ID = (n) => `b2000000-0000-4000-8000-${hex12(n)}`;
const CHILD_ID = (n) => `c2000000-0000-4000-8000-${hex12(n)}`;
const FAMILY_ID = (n) => `f2000000-0000-4000-8000-${hex12(n)}`;
const CARD_ID = (n) => `ca200000-0000-4000-8000-${hex12(n)}`;
const PAY_ID = (n) => `da200000-0000-4000-8000-${hex12(n)}`;
const ACRO_SECTION_ID = "ac000000-0000-4000-8000-000000000001";

const norm = (s) => String(s ?? "").toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
const die = (msg, err) => { console.error(`FAIL ${msg}:`, err); process.exit(1); };
const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const strHash = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
const fakeBirthDate = (name) => {
  const h = strHash(name);
  return `${2016 + (h % 6)}-${String(1 + ((h >>> 4) % 12)).padStart(2, "0")}-${String(1 + ((h >>> 8) % 28)).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// Справочники: штат, секции
// ---------------------------------------------------------------------------
const COACH_EMAILS = {
  "Игнатенко Юлия": "yuliya", "Таюрская Палина": "palina", "Чотонова Евгения": "evgeniya",
  "Эсеналиев Марат": "marat", "Ткачук Эмиль": "emil", "Грицак Жанна": "zhanna",
  "Виталина": "vitalina", "Воробьева Светлана": "svetlana", "Питаев Тимур": "timur",
  "Ференц Ирина": "irina", "Ботанбаева Рамина": "ramina", "Дюшеналиев Адилет": "adilet",
  "Абдыкаров Акжол": "akzhol", "Абдигалиев Мадияр": "madiyar",
  "Тахиржан уулу Файзулла": "fayzulla", "Сторожевых Артур": "artur",
};
const MANAGER_EMAILS = { "Эльгина": "elgina", "Алия": "aliya", "Акмарал": "akmaral", "Малика": "malika", "Арзу": "arzu" };

const MALE_NAMES = new Set([
  "алмазбек", "алымбек", "бекболот", "максат", "мирзат", "руслан", "талгат",
  "хасан", "эрмек", "алибек", "дастан", "азамат", "бакыт", "эмиль", "тимур",
  "нурлан", "улан", "марат", "данияр", "айбек", "эрлан", "самат", "женишбек",
  "канат", "медер", "чынгыз", "виктор", "александр", "сергей", "андрей",
  "дмитрий", "евгений", "владимир", "алексей", "николай", "иван", "павел",
]);

// нормализованное имя секции из файла → нормализованное имя в БД
const SECTION_FIX = (raw) => {
  let s = norm(raw).replace("гинастика", "гимнастика").replace("спортинвая", "спортивная")
    .replace("тхэквондо", "таеквандо");
  let level = null;
  if (s.includes("про-группа") || s.includes("про группа")) {
    level = "про-группа";
    s = s.replace(/про[- ]группа/, "").trim();
  }
  if (s.startsWith("здоровая спина")) s = "здоровая спина и стопа (лфк)";
  return { key: s, level };
};
const SECTION_SHORT = {
  "развивающая гимнастика": "РГ", "спортивная гимнастика": "СГ",
  "эстетическая гимнастика": "ЭГ", "аэробная гимнастика": "АГ",
  "акробатика": "Акробатика", "дзюдо": "Дзюдо", "дзюдо kids": "Дзюдо КИДС",
  "таеквандо": "ТХК", "таеквандо kids": "ТХК КИДС", "бокс": "Бокс",
  "здоровая спина и стопа (лфк)": "ЛФК", "базовая гимнастика": "БГ",
};
const DOW_SHORT = { 1: "ПН", 2: "ВТ", 3: "СР", 4: "ЧТ", 5: "ПТ", 6: "СБ", 0: "ВС" };
const dowOrder = (d) => (d === 0 ? 7 : d);

// ---------------------------------------------------------------------------
// Сборка сущностей: блоки → группы; дети → дедуп по ФИО; карты → per секция
// ---------------------------------------------------------------------------
const blocks = []; // {seq, sheet, coach, sectionKey, level, label, sched, dates, capacity, kids}
let seq = 0;
for (const sheet of tabel.sheets) {
  for (const b of sheet.blocks) {
    seq += 1;
    const { key, level } = SECTION_FIX(b.section_raw);
    blocks.push({
      seq, sheet: sheet.sheet, coach: sheet.coach.trim(), sectionKey: key, level,
      label: b.schedule_raw, sched: b.sched, dates: b.dates,
      capacity: b.capacity ?? 20, kids: b.kids,
    });
  }
}

const kidsMap = new Map(); // normFio → {name, instances: [{block, kid}]}
for (const block of blocks) {
  for (const kid of block.kids) {
    const k = norm(kid.fio);
    if (!kidsMap.has(k)) kidsMap.set(k, { name: kid.fio.trim(), instances: [] });
    kidsMap.get(k).instances.push({ block, kid });
  }
}
const score = (k) => (k.start_date ? 2 : 0) + (k.end_date ? 2 : 0) + (k.pay_sum ? 2 : 0)
  + (k.parent?.phone ? 2 : 0) + (k.amo ? 1 : 0) + (k.packet ? 1 : 0) + (k.remainder != null ? 1 : 0);

const entities = [];
for (const { name, instances } of kidsMap.values()) {
  instances.sort((a, b) => score(b.kid) - score(a.kid));
  const primary = instances[0].kid;
  entities.push({
    name, primary, instances,
    manager: instances.map((i) => i.kid.manager).find(Boolean) ?? null,
    parent: instances.map((i) => i.kid.parent).filter(Boolean).find((p) => p.phone)
      ?? instances.map((i) => i.kid.parent).find(Boolean) ?? null,
    amo: instances.map((i) => i.kid.amo).find(Boolean) ?? null,
    has_contract: instances.some((i) => i.kid.has_contract),
    notes: instances.flatMap(({ block, kid }) => [
      kid.coach_note && { kind: "coach", text: kid.coach_note, coach: block.coach },
      kid.manager_note && { kind: "manager", text: kid.manager_note },
      kid.start_note && { kind: "manager", text: `Из табеля («начало абонемента»): ${kid.start_note}` },
    ].filter(Boolean)),
  });
}
entities.sort((a, b) => a.name.localeCompare(b.name, "ru"));
entities.forEach((e, i) => { e.childId = CHILD_ID(i + 1); });

// --- карта per (ребёнок, секция) --------------------------------------------
const buildCards = () => {
  const cards = [];
  for (const ent of entities) {
    const bySection = new Map();
    for (const inst of ent.instances) {
      const k = inst.block.sectionKey;
      if (!bySection.has(k)) bySection.set(k, []);
      bySection.get(k).push(inst);
    }
    for (const [sectionKey, insts] of bySection) {
      insts.sort((a, b) => score(b.kid) - score(a.kid));
      const k = insts[0].kid;
      const isKids = sectionKey.includes("kids");
      const months = k.months ?? null;
      let start = k.start_date, end = k.end_date, placeholder = false;
      const attDates = insts.flatMap((i) => Object.keys(i.kid.attendance)).sort();
      if (!start && !end) { start = attDates[0] ?? AUG1; end = addDays(start, 30); placeholder = true; }
      else if (!start) start = addDays(end, -(months ?? 1) * 30);
      else if (!end) end = addDays(start, (months ?? 1) * 30);
      const packetOrig = k.packet ?? k.lessons_from_text
        ?? ((months ?? 1) >= 3 ? (isKids ? (months ?? 3) * 8 : (months ?? 3) * 12) : (isKids ? 8 : 12));
      const type = (months ?? 0) >= 9 ? "nine_month"
        : ((months ?? 0) >= 3 || packetOrig >= 24) ? "quarterly" : "monthly";
      // --- формула остатка ---
      const winFrom = start > AUG1 ? start : AUG1;
      const winTo = end < CUTOFF ? end : CUTOFF;
      const dateSet = new Set(insts.flatMap((i) => i.block.dates));
      const att = {};
      for (const i of insts) for (const [d, st] of Object.entries(i.kid.attendance)) att[d] = st;
      let burned = 0, present = 0;
      for (const d of dateSet) {
        if (d < winFrom || d > winTo) continue;
        if (att[d] === "excused") continue;
        burned += 1;
        if (att[d] === "present") present += 1;
      }
      const rem0 = k.remainder ?? packetOrig; // остаток на 01.08 (нет в файле → пакет)
      const remainingTarget = Math.max(0, rem0 - burned);
      const totalLessons = remainingTarget + present;
      cards.push({
        ent, sectionKey, insts, start, end, type, placeholder,
        totalLessons, packetOrig, rem0, burned, present, remainingTarget,
        remainderMissing: k.remainder == null,
        freezeQuota: k.freeze_left ?? (type === "monthly" ? 0 : 3),
        paySum: k.pay_sum ?? null, payDate: k.pay_date ?? null,
      });
    }
  }
  cards.forEach((c, i) => { c.cardId = CARD_ID(i + 1); });
  return cards;
};
const cards = buildCards();

// ---------------------------------------------------------------------------
const main = async () => {
  // --- сводка / dry-run ---
  const stats = {
    "групп": blocks.length,
    "детей уникальных": entities.length,
    "строк в табеле": blocks.reduce((s, b) => s + b.kids.length, 0),
    "карт": cards.length,
    "карт-заглушек": cards.filter((c) => c.placeholder).length,
    "карт без остатка в файле": cards.filter((c) => c.remainderMissing).length,
    "платежей": cards.filter((c) => c.paySum).length,
    "детей без телефона": entities.filter((e) => !e.parent?.phone).length,
    "детей в 2+ секциях": entities.filter((e) => new Set(e.instances.map((i) => i.block.sectionKey)).size > 1).length,
  };
  console.log("=== Сводка ===");
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
  if (DRY) {
    console.log("\n=== Примеры формулы остатка (первые 12 карт с остатком) ===");
    for (const c of cards.filter((x) => !x.remainderMissing).slice(0, 12)) {
      console.log(`  ${c.ent.name} [${c.sectionKey}] пакет=${c.packetOrig} ост01.08=${c.rem0} сгорело=${c.burned} был=${c.present} → total=${c.totalLessons}, remaining=${c.remainingTarget}`);
    }
    console.log("\n--dry-run: изменений нет");
    return;
  }

  // --- секции ---
  const { data: dbSections } = await sb.from("sections").select("id, name_ru").is("deleted_at", null);
  const sectionIdByKey = {};
  for (const s of dbSections ?? []) sectionIdByKey[norm(s.name_ru)] = s.id;
  const needAcro = blocks.some((b) => b.sectionKey === "акробатика");
  if (needAcro && !sectionIdByKey["акробатика"]) {
    const { error } = await sb.from("sections").upsert({
      id: ACRO_SECTION_ID, organization_id: ORG_ID, name_ru: "Акробатика", name_ky: "Акробатика",
      category: "gymnastics", is_active: true,
    });
    if (error) die("section Акробатика", error);
    sectionIdByKey["акробатика"] = ACRO_SECTION_ID;
    console.log("Создана секция «Акробатика»");
  }
  for (const b of blocks) {
    if (!sectionIdByKey[b.sectionKey]) die("section", `нет секции в БД для «${b.sectionKey}» (${b.sheet})`);
    b.sectionId = sectionIdByKey[b.sectionKey];
  }

  // --- штат: тренеры + менеджеры ---
  const ensureUser = async (email, password, role, full_name) => {
    const { data: created, error } = await sb.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name },
    });
    let userId = created?.user?.id;
    if (!userId) {
      if (error && !/already|duplicate/i.test(error.message)) die(`createUser ${email}`, error);
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      userId = list?.users.find((x) => x.email === email)?.id;
      if (!userId) die(`lookup ${email}`, "not found after create");
    }
    const { error: pErr } = await sb.from("profiles").upsert({
      id: userId, organization_id: ORG_ID, role, full_name, email, is_active: true,
    });
    if (pErr) die(`profile ${email}`, pErr);
    return userId;
  };

  const coachIds = {}; // full coach name → profile id
  for (const [name, slug] of Object.entries(COACH_EMAILS)) {
    coachIds[name] = await ensureUser(`${slug}@uniqum.test`, `${slug}12345`, "coach", name);
    const { error } = await sb.from("coaches").upsert({ id: coachIds[name] });
    if (error) die(`coaches ${name}`, error);
  }
  const managerIds = {};
  for (const [name, slug] of Object.entries(MANAGER_EMAILS)) {
    managerIds[name] = await ensureUser(`${slug}@uniqum.test`, `${slug}12345`, "manager", name);
  }
  console.log(`Штат: тренеров ${Object.keys(coachIds).length}, менеджеров ${Object.keys(managerIds).length}`);
  const managerId = (name) => managerIds[String(name ?? "").trim()] ?? null;

  // --- группы + расписание + section_coaches ---
  for (const b of blocks) {
    const coachId = coachIds[b.coach] ?? coachIds[Object.keys(COACH_EMAILS).find((n) => norm(n) === norm(b.coach))];
    if (!coachId) die("coach", `нет тренера для листа «${b.sheet}» (${b.coach})`);
    b.coachId = coachId;
    await sb.from("section_coaches").upsert({ section_id: b.sectionId, coach_id: coachId });
    const short = SECTION_SHORT[b.sectionKey] ?? b.sectionKey;
    const firstName = b.coach.split(/\s+/).at(-1);
    const days = [...new Set(b.sched.map((s) => s[0]))].sort((a, z) => dowOrder(a) - dowOrder(z));
    const gname = `${short}${b.level ? " про" : ""} ${firstName} — ${days.map((d) => DOW_SHORT[d]).join(".")} ${b.sched[0][1]}`;
    b.groupId = GROUP_ID(b.seq);
    const { error: gErr } = await sb.from("groups").upsert({
      id: b.groupId, organization_id: ORG_ID, section_id: b.sectionId, coach_id: coachId,
      name: gname, max_capacity: b.capacity, hard_limit_override: true,
      duration_min: b.sched[0][2], level: b.level, is_active: true,
    });
    if (gErr) die(`group ${gname}`, gErr);
    await sb.from("group_schedule").delete().eq("group_id", b.groupId);
    for (const [dow, time, dur] of b.sched) {
      const { error } = await sb.from("group_schedule").insert({
        group_id: b.groupId, day_of_week: dow, start_time: time, duration_min: dur,
      });
      if (error) die(`schedule ${gname}`, error);
    }
  }
  console.log(`Групп: ${blocks.length}`);

  // --- семьи (дедуп по телефону) ---
  const famIndex = new Map();
  for (const ent of entities) {
    const key = ent.parent?.phone ?? `solo:${norm(ent.name)}`;
    if (!famIndex.has(key)) famIndex.set(key, { idx: famIndex.size + 1, members: [] });
    famIndex.get(key).members.push(ent);
  }
  const upsertChunks = async (table, rows, label) => {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from(table).upsert(rows.slice(i, i + 200));
      if (error) die(`${label} (чанк ${i}–${i + 200})`, error);
    }
  };

  const famRows = [];
  for (const { idx, members } of famIndex.values()) {
    const fid = FAMILY_ID(idx);
    const ent = members.find((m) => m.parent?.phone) ?? members[0];
    const p = ent.parent;
    const isFather = p?.name && MALE_NAMES.has(norm(p.name).split(" ")[0]);
    famRows.push({
      id: fid, organization_id: ORG_ID,
      father_name: isFather ? p.name : null, father_phone: isFather ? p.phone : null,
      mother_name: !isFather ? (p?.name ?? null) : null, mother_phone: !isFather ? (p?.phone ?? null) : null,
      responsible_manager_id: managerId(ent.manager),
      comment: members.some((m) => m.has_contract) ? "Договор подписан" : null,
    });
    for (const m of members) m.familyId = fid;
  }
  await upsertChunks("families", famRows, "families");
  console.log(`Семей: ${famIndex.size}`);

  // --- дети ---
  await upsertChunks("children", entities.map((ent) => ({
    id: ent.childId, organization_id: ORG_ID, family_id: ent.familyId,
    full_name: ent.name, birth_date: fakeBirthDate(ent.name),
    status: "active", responsible_manager_id: managerId(ent.manager),
    amo_url: ent.amo,
  })), "children");
  console.log(`Детей: ${entities.length}`);

  // --- карты (все active → guard пропустит enrollments) ---
  await upsertChunks("club_cards", cards.map((c) => ({
    id: c.cardId, organization_id: ORG_ID, child_id: c.ent.childId,
    type: c.type, total_lessons: c.totalLessons, freeze_quota: c.freezeQuota,
    price_paid: c.paySum ?? 0, discount: 0, start_date: c.start, end_date: c.end,
    status: "active", section_id: sectionIdByKey[c.sectionKey],
  })), "club_cards");
  console.log(`Карт: ${cards.length}`);

  // --- платежи ---
  const payRows = cards.map((c, i) => {
    if (!c.paySum) return null;
    const approx = !c.payDate;
    return {
      id: PAY_ID(i + 1), organization_id: ORG_ID, child_id: c.ent.childId,
      club_card_id: c.cardId, amount: c.paySum, currency: "KGS", method: "cash",
      received_by: managerId(c.ent.manager),
      paid_at: `${c.payDate ?? c.start}T10:00:00+06:00`,
      comment: [
        `Импорт табеля 08.2026: пакет ${c.packetOrig} трен., остаток на 01.08 — ${c.rem0}`,
        approx ? "дата платежа приблизительная (в табеле не было)" : null,
      ].filter(Boolean).join("; "),
    };
  }).filter(Boolean);
  await upsertChunks("payments", payRows, "payments");
  console.log(`Платежей: ${payRows.length}`);

  // --- записи в группы ---
  // ВСЕ записи, включая архивные: refresh_lifecycle мог отчислить ребёнка
  // с истёкшей картой — при перезапуске не создаём его enrollment заново.
  const { data: existingEnr } = await sb.from("enrollments")
    .select("child_id, group_id");
  const enrKeys = new Set((existingEnr ?? []).map((e) => `${e.child_id}|${e.group_id}`));
  let enrCount = 0, enrFail = 0;
  for (const c of cards) {
    for (const inst of c.insts) {
      const key = `${c.ent.childId}|${inst.block.groupId}`;
      if (enrKeys.has(key)) continue;
      enrKeys.add(key);
      const { error } = await sb.from("enrollments").insert({
        child_id: c.ent.childId, group_id: inst.block.groupId,
        start_date: c.placeholder ? null : c.start,
        end_date: c.placeholder ? null : c.end,
      });
      if (error) { console.error(`  enrollment ${c.ent.name} → ${inst.block.label}: ${error.message}`); enrFail++; continue; }
      enrCount++;
    }
  }
  console.log(`Записей в группы: ${enrCount}${enrFail ? ` (ошибок: ${enrFail})` : ""}`);

  // --- занятия августа ---
  const lessonIdByKey = {}; // "groupId|date" → lesson id
  for (const b of blocks) {
    const timeByDow = {};
    for (const [dow, time, dur] of b.sched) if (!(dow in timeByDow)) timeByDow[dow] = [time, dur];
    const { data: existing } = await sb.from("lessons")
      .select("id, date").eq("group_id", b.groupId).gte("date", "2026-08-01").lte("date", "2026-08-31");
    const byDate = Object.fromEntries((existing ?? []).map((l) => [l.date, l.id]));
    const toInsert = [];
    for (const date of b.dates) {
      if (byDate[date]) { lessonIdByKey[`${b.groupId}|${date}`] = byDate[date]; continue; }
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const [time, dur] = timeByDow[dow] ?? b.sched[0].slice(1);
      toInsert.push({
        organization_id: ORG_ID, group_id: b.groupId, coach_id: b.coachId,
        date, start_time: time, duration_min: dur, type: "regular",
        status: date <= CUTOFF ? "completed" : "scheduled",
      });
    }
    if (toInsert.length) {
      const { data: inserted, error } = await sb.from("lessons").insert(toInsert).select("id, date");
      if (error) die(`lessons ${b.sheet}`, error);
      for (const l of inserted) lessonIdByKey[`${b.groupId}|${l.date}`] = l.id;
    }
  }
  console.log(`Занятий августа: ${Object.keys(lessonIdByKey).length}`);

  // --- посещаемость ---
  const attRows = [];
  const seen = new Set();
  for (const ent of entities) {
    for (const { block, kid } of ent.instances) {
      for (const [date, status] of Object.entries(kid.attendance)) {
        const lessonId = lessonIdByKey[`${block.groupId}|${date}`];
        if (!lessonId) { console.error(`  нет занятия: ${ent.name} ${block.sheet} ${date}`); continue; }
        const k = `${lessonId}|${ent.childId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        attRows.push({
          lesson_id: lessonId, child_id: ent.childId, status,
          marked_by: block.coachId, marked_at: `${date}T12:00:00+06:00`,
        });
      }
    }
  }
  for (let i = 0; i < attRows.length; i += 400) {
    const { error } = await sb.from("attendance").upsert(attRows.slice(i, i + 400), { onConflict: "lesson_id,child_id" });
    if (error) die("attendance chunk", error);
  }
  console.log(`Отметок посещаемости: ${attRows.length}`);

  // --- внутренние заметки ---
  const { data: oldNotes } = await sb.from("child_internal_notes")
    .select("child_id, text").in("child_id", entities.map((e) => e.childId));
  const noteKeys = new Set((oldNotes ?? []).map((n) => `${n.child_id}|${n.text}`));
  let noteCount = 0;
  for (const ent of entities) {
    for (const note of ent.notes) {
      if (noteKeys.has(`${ent.childId}|${note.text}`)) continue;
      noteKeys.add(`${ent.childId}|${note.text}`);
      const { error } = await sb.from("child_internal_notes").insert({
        organization_id: ORG_ID, child_id: ent.childId,
        author_id: note.kind === "coach" ? (coachIds[note.coach] ?? null) : managerId(ent.manager),
        text: note.text,
      });
      if (error) console.error(`  note ${ent.name}:`, error.message);
      else noteCount++;
    }
  }
  console.log(`Заметок: ${noteCount}`);

  // --- жизненный цикл + статусы детей ---
  const { error: rlErr } = await sb.rpc("refresh_lifecycle");
  if (rlErr) console.error("refresh_lifecycle:", rlErr.message);
  const { data: cardRows } = await sb.from("club_cards")
    .select("child_id, status").in("id", cards.map((c) => c.cardId));
  const rank = { frozen: 3, active: 2, ending: 2, expired: 1, debt: 1, archived: 0 };
  const statusByChild = {};
  for (const c of cardRows ?? []) {
    const cur = statusByChild[c.child_id];
    if (!cur || (rank[c.status] ?? 0) > (rank[cur] ?? 0)) statusByChild[c.child_id] = c.status;
  }
  for (const ent of entities) {
    const cs = statusByChild[ent.childId];
    const status = cs === "frozen" ? "frozen" : (cs === "active" || cs === "ending") ? "active" : "expired";
    await sb.from("children").update({ status }).eq("id", ent.childId);
  }
  console.log("Статусы детей обновлены");

  // --- верификация: остаток в системе == клиентскому ---
  console.log("\n=== Верификация остатков ===");
  let ok = 0, bad = 0;
  for (let i = 0; i < cards.length; i += 100) {
    const chunk = cards.slice(i, i + 100);
    const { data: bal } = await sb.from("v_child_card_balance")
      .select("club_card_id, remaining").in("club_card_id", chunk.map((c) => c.cardId));
    const byId = Object.fromEntries((bal ?? []).map((b) => [b.club_card_id, b.remaining]));
    for (const c of chunk) {
      if (byId[c.cardId] === c.remainingTarget) ok++;
      else { bad++; console.error(`  ✗ ${c.ent.name} [${c.sectionKey}]: система=${byId[c.cardId]}, ожидалось=${c.remainingTarget}`); }
    }
  }
  console.log(`  совпало: ${ok}, расхождений: ${bad}`);

  console.log("\n=== Контроль по группам ===");
  for (const b of blocks.slice(0, 8)) {
    const { count } = await sb.from("enrollments")
      .select("*", { count: "exact", head: true }).eq("group_id", b.groupId).is("archived_at", null);
    console.log(`  ${b.sheet} «${b.label.slice(0, 30)}»: записано ${count} (в табеле ${b.kids.length})`);
  }
};

main().catch((e) => { console.error("❌", e); process.exit(1); });
