// Идемпотентная СИНХРОНИЗАЦИЯ табеля (выгрузка Google-таблицы тренеров) с БД.
//
//   node backend/scripts/sync-tabel.mjs <tabel.json>            # dry-run (по умолчанию)
//   node backend/scripts/sync-tabel.mjs <tabel.json> --apply    # записать в БД
//
// ОТЛИЧИЕ ОТ import-august-tabel.mjs: тот раздаёт UUID по порядковому номеру
// после сортировки, поэтому повторный прогон с изменившимся составом детей
// сдвигает индексы и дублирует базу. Здесь существующие сущности находятся по
// естественным ключам (норм. ФИО ребёнка, имя группы, телефон семьи), новым
// выдаются id, продолжающие нумерацию.
//
// ФОРМУЛА ОСТАТКА (правило клиента, уточнено 18.08):
//   • карта началась ДО 01.08 → «остаток тренировок» в файле актуален на 01.08,
//     из него вычитаем прошедшие занятия группы (кроме «зам» = заморозка);
//   • карта началась В августе (новая продажа) → остаток уже «на сегодня»,
//     берём как есть, ничего не вычитаем.
//   Система считает remaining = total_lessons − present(в окне карты по секции),
//   поэтому пишем total_lessons = remaining_target + present.
//
// «Прошедшие» занятия считаем по последнюю ОТМЕЧЕННУЮ дату группы (но не позже
// сегодня): незаполненные тренером даты не сжигаем. Когда тренер дозаполнит
// табель — повторный прогон досчитает.

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
const APPLY = process.argv.includes("--apply");
if (!jsonPath) { console.error("usage: node sync-tabel.mjs <tabel.json> [--apply]"); process.exit(1); }
const tabel = JSON.parse(readFileSync(resolve(jsonPath), "utf8"));

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const AUG1 = "2026-08-01";
const TODAY = process.env.SYNC_TODAY ?? new Date().toISOString().slice(0, 10);
const HORIZON = "2026-09-28"; // до этой даты в БД уже есть занятия — тем же горизонтом добиваем новые группы

const hex12 = (n) => n.toString(16).padStart(12, "0");
const GROUP_ID = (n) => `b2000000-0000-4000-8000-${hex12(n)}`;
const CHILD_ID = (n) => `c2000000-0000-4000-8000-${hex12(n)}`;
const FAMILY_ID = (n) => `f2000000-0000-4000-8000-${hex12(n)}`;
const CARD_ID = (n) => `ca200000-0000-4000-8000-${hex12(n)}`;
const LESSON_ID = (n) => `1e550000-0000-4000-8000-${hex12(n)}`;

const norm = (s) => String(s ?? "").toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
const tokKey = (s) => norm(s).split(" ").sort().join(" ");
const die = (msg, err) => { console.error(`FAIL ${msg}:`, err); process.exit(1); };
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); };
const dowOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const strHash = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
const fakeBirthDate = (name) => { const h = strHash(name); return `${2016 + (h % 6)}-${String(1 + ((h >>> 4) % 12)).padStart(2, "0")}-${String(1 + ((h >>> 8) % 28)).padStart(2, "0")}`; };
const ratio = (a, b) => { // грубая похожесть строк (для ловли опечаток в ФИО)
  if (a === b) return 1;
  const m = new Set(); let hit = 0;
  for (let i = 0; i < a.length - 1; i++) m.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) if (m.has(b.slice(i, i + 2))) hit++;
  return (2 * hit) / Math.max(1, (a.length - 1) + (b.length - 1));
};

const SECTION_FIX = (raw) => {
  let s = norm(raw).replace("гинастика", "гимнастика").replace("спортинвая", "спортивная").replace("тхэквондо", "таеквандо");
  let level = null;
  if (s.includes("про-группа") || s.includes("про группа")) { level = "про-группа"; s = s.replace(/про[- ]группа/, "").trim(); }
  if (s.startsWith("здоровая спина")) s = "здоровая спина и стопа (лфк)";
  return { key: s, level };
};
const SECTION_SHORT = {
  "развивающая гимнастика": "РГ", "спортивная гимнастика": "СГ", "эстетическая гимнастика": "ЭГ",
  "аэробная гимнастика": "АГ", "акробатика": "Акробатика", "дзюдо": "Дзюдо", "дзюдо kids": "Дзюдо КИДС",
  "таеквандо": "ТХК", "таеквандо kids": "ТХК КИДС", "бокс": "Бокс",
  "здоровая спина и стопа (лфк)": "ЛФК", "базовая гимнастика": "БГ",
};
const DOW_SHORT = { 1: "ПН", 2: "ВТ", 3: "СР", 4: "ЧТ", 5: "ПТ", 6: "СБ", 0: "ВС" };
const dowOrder = (d) => (d === 0 ? 7 : d);
const MALE_NAMES = new Set(["алмазбек","алымбек","бекболот","максат","мирзат","руслан","талгат","хасан","эрмек","алибек","дастан","азамат","бакыт","эмиль","тимур","нурлан","улан","марат","данияр","айбек","эрлан","самат","женишбек","канат","медер","чынгыз","виктор","александр","сергей","андрей","дмитрий","евгений","владимир","алексей","николай","иван","павел"]);

// ---------------------------------------------------------------------------
// 1. Файл → блоки (группы) и сущности (дети)
// ---------------------------------------------------------------------------
const blocks = [];
const skippedBlocks = [];
for (const sheet of tabel.sheets) {
  for (const b of sheet.blocks) {
    // Блок без строки расписания («ПН.СР.ПТ 9:00») — НЕ группа: в таких местах
    // менеджеры ведут заметки по клиентам (напр. «Мини группа» у Игнатенко).
    // Заводить по ним группу и детей нельзя.
    if (!b.sched?.length) { skippedBlocks.push(`${sheet.sheet}: «${b.label_note ?? "без подписи"}» (${b.kids.length} строк)`); continue; }
    const { key, level } = SECTION_FIX(b.section_raw);
    blocks.push({
      sheet: sheet.sheet, coach: sheet.coach.trim(), sectionKey: key, level,
      label: b.schedule_raw, label_note: b.label_note, sched: b.sched, dates: b.dates,
      capacity: b.capacity ?? 20, kids: b.kids,
    });
  }
}
const kidsMap = new Map();
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
for (const [key, { name, instances }] of kidsMap) {
  instances.sort((a, b) => score(b.kid) - score(a.kid));
  entities.push({
    key, name, instances,
    manager: instances.map((i) => i.kid.manager).find(Boolean) ?? null,
    parent: instances.map((i) => i.kid.parent).filter(Boolean).find((p) => p.phone) ?? instances.map((i) => i.kid.parent).find(Boolean) ?? null,
    amo: instances.map((i) => i.kid.amo).find(Boolean) ?? null,
    has_contract: instances.some((i) => i.kid.has_contract),
  });
}

// ---------------------------------------------------------------------------
const main = async () => {
  console.log(`Файл: ${jsonPath}\nСегодня: ${TODAY}   Режим: ${APPLY ? "ПРИМЕНЕНИЕ" : "DRY-RUN"}\n`);

  // --- 2. Текущее состояние БД --------------------------------------------
  const pageAll = async (table, cols, order = "id") => {
    const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await sb.from(table).select(cols).order(order).range(from, from + step - 1);
      if (error) die(`select ${table}`, error);
      out.push(...data); if (data.length < step) break;
    }
    return out;
  };
  const [dbSections, dbProfiles, dbGroups, dbChildren, dbFamilies, dbCards, dbEnroll, dbLessons] = await Promise.all([
    pageAll("sections", "id, name_ru"),
    pageAll("profiles", "id, full_name, role"),
    pageAll("groups", "id, name, section_id, coach_id, max_capacity, duration_min, level, is_active"),
    // birth_date обязателен: без него апсерт перезатёр бы уточнённые менеджерами даты псевдо-датой
    pageAll("children", "id, full_name, family_id, amo_url, responsible_manager_id, birth_date, status"),
    pageAll("families", "id, mother_phone, father_phone, mother_name, father_name"),
    pageAll("club_cards", "id, child_id, section_id, type, total_lessons, start_date, end_date, status, price_paid, freeze_quota"),
    pageAll("enrollments", "id, child_id, group_id, archived_at"),
    pageAll("lessons", "id, group_id, date, status"),
  ]);
  const dbSchedule = await pageAll("group_schedule", "id, group_id, day_of_week, start_time, duration_min");
  const groupStartTime = new Map(); // group_id → самое раннее время начала (ключ матчинга)
  for (const s of dbSchedule) {
    const t = String(s.start_time).slice(0, 5);
    if (!groupStartTime.has(s.group_id) || t < groupStartTime.get(s.group_id)) groupStartTime.set(s.group_id, t);
  }
  const schedByGroup = new Map();
  for (const s of dbSchedule) { if (!schedByGroup.has(s.group_id)) schedByGroup.set(s.group_id, []); schedByGroup.get(s.group_id).push(s); }
  const usedGroupIds = new Set();
  const dbAttendance = await pageAll("attendance", "id, lesson_id, child_id, status");
  console.log(`БД: секций ${dbSections.length}, групп ${dbGroups.length}, детей ${dbChildren.length}, семей ${dbFamilies.length}, карт ${dbCards.length}, занятий ${dbLessons.length}, отметок ${dbAttendance.length}`);

  const sectionIdByKey = {}; for (const s of dbSections) sectionIdByKey[norm(s.name_ru)] = s.id;
  const profByName = new Map(dbProfiles.map((p) => [norm(p.full_name), p]));
  const childByName = new Map(dbChildren.map((c) => [norm(c.full_name), c]));
  const groupByName = new Map(dbGroups.map((g) => [norm(g.name), g]));
  const lessonByKey = new Map(dbLessons.map((l) => [`${l.group_id}|${l.date}`, l]));
  const attByKey = new Map(dbAttendance.map((a) => [`${a.lesson_id}|${a.child_id}`, a]));
  const cardByKey = new Map(dbCards.map((c) => [`${c.child_id}|${c.section_id}`, c]));
  const enrollByKey = new Map(dbEnroll.filter((e) => !e.archived_at).map((e) => [`${e.child_id}|${e.group_id}`, e]));
  const famByPhone = new Map();
  for (const f of dbFamilies) for (const ph of [f.mother_phone, f.father_phone]) if (ph) famByPhone.set(ph, f);

  let nextChild = Math.max(0, ...dbChildren.map((c) => parseInt(c.id.slice(-12), 16) || 0));
  let nextGroup = Math.max(0, ...dbGroups.map((g) => parseInt(g.id.slice(-12), 16) || 0));
  let nextFamily = Math.max(0, ...dbFamilies.map((f) => parseInt(f.id.slice(-12), 16) || 0));
  let nextCard = Math.max(0, ...dbCards.map((c) => parseInt(c.id.slice(-12), 16) || 0));
  let nextLesson = 0;

  // --- 3. Матчинг детей (с ловлей переименований) --------------------------
  const dbUnmatched = new Map(dbChildren.map((c) => [norm(c.full_name), c]));
  for (const e of entities) if (dbUnmatched.has(e.key)) { e.db = dbUnmatched.get(e.key); dbUnmatched.delete(e.key); }
  const renames = [];
  for (const e of entities.filter((x) => !x.db)) {
    let hit = [...dbUnmatched.values()].find((c) => tokKey(c.full_name) === tokKey(e.name));
    if (!hit) {
      let best = null;
      // 0.85: настоящие опечатки дают 0.89–0.92, однофамильцы-братья ≤0.73
      for (const c of dbUnmatched.values()) { const r = ratio(norm(c.full_name), e.key); if (r > 0.85 && (!best || r > best.r)) best = { c, r }; }
      hit = best?.c;
    }
    if (hit) { e.db = hit; renames.push([hit.full_name, e.name]); dbUnmatched.delete(norm(hit.full_name)); }
  }
  for (const e of entities) { e.childId = e.db?.id ?? CHILD_ID(++nextChild); e.isNew = !e.db; }
  const goneChildren = [...dbUnmatched.values()];

  // --- 4. Группы -----------------------------------------------------------
  for (const b of blocks) {
    const sid = sectionIdByKey[b.sectionKey];
    if (!sid) die("section", `нет секции «${b.sectionKey}» (${b.sheet})`);
    b.sectionId = sid;
    const coach = profByName.get(norm(b.coach));
    if (!coach) die("coach", `нет профиля тренера «${b.coach}» (${b.sheet})`);
    b.coachId = coach.id;
    const short = SECTION_SHORT[b.sectionKey] ?? b.sectionKey;
    const firstName = b.coach.split(/\s+/).at(-1);
    const days = [...new Set(b.sched.map((s) => s[0]))].sort((a, z) => dowOrder(a) - dowOrder(z));
    const note = b.label_note ? ` (${b.label_note})` : "";
    b.name = `${short}${b.level ? " про" : ""} ${firstName}${note} — ${days.map((d) => DOW_SHORT[d]).join(".")} ${b.sched[0][1]}`;
    // Матчинг группы: сперва по имени, затем по (тренер + секция + время начала).
    // Второй ключ важен: если в табеле у группы добавился день (ВТ.ЧТ → ВТ.ЧТ.СБ),
    // имя меняется, и матчинг только по имени создал бы ДУБЛЬ группы — а её отметки
    // начали бы считаться дважды (view суммирует посещения по всей секции).
    let g = groupByName.get(norm(b.name));
    if (g && usedGroupIds.has(g.id)) g = null;
    if (!g) {
      const cands = dbGroups.filter((x) => x.coach_id === b.coachId && x.section_id === b.sectionId
        && (groupStartTime.get(x.id) ?? null) === b.sched[0][1]
        && !usedGroupIds.has(x.id));
      if (cands.length === 1) { g = cands[0]; if (norm(g.name) !== norm(b.name)) b.renamedFrom = g.name; }
    }
    if (g) usedGroupIds.add(g.id);
    b.groupId = g?.id ?? GROUP_ID(++nextGroup);
    b.isNew = !g;
  }
  const newGroups = blocks.filter((b) => b.isNew);

  // --- 5. Карты и остаток --------------------------------------------------
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
      const packetOrig = k.packet ?? k.lessons_from_text ?? ((months ?? 1) >= 3 ? (isKids ? (months ?? 3) * 8 : (months ?? 3) * 12) : (isKids ? 8 : 12));
      const type = (months ?? 0) >= 9 ? "nine_month" : ((months ?? 0) >= 3 || packetOrig >= 24) ? "quarterly" : "monthly";

      const att = {};
      for (const i of insts) for (const [d, st] of Object.entries(i.kid.attendance)) att[d] = st;
      // окно карты; «сегодня» ограничивает и сгорание, и конец окна
      const winFrom = start > AUG1 ? start : AUG1;
      const winTo = end < TODAY ? end : TODAY;
      // последняя отмеченная дата по группам ребёнка в этой секции (не позже сегодня)
      let lastMarked = null;
      const blockLastMarked = (blk) => {
        let m = null;
        for (const kk of blk.kids) for (const d of Object.keys(kk.attendance)) if (!m || d > m) m = d;
        return m;
      };
      for (const i of insts) { const m = blockLastMarked(i.block); if (m && (!lastMarked || m > lastMarked)) lastMarked = m; }
      const burnTo = [lastMarked ?? AUG1, TODAY].sort()[0]; // min

      // present — все отметки «был» внутри окна карты (их считает view)
      let present = 0;
      for (const [d, st] of Object.entries(att)) if (st === "present" && d >= start && d <= end) present += 1;

      const isNewSale = start > AUG1;
      let burned = 0;
      if (!isNewSale) {
        const sessions = new Set(insts.flatMap((i) => i.block.dates));
        for (const d of sessions) {
          if (d < winFrom || d > winTo) continue;
          if (att[d] === "excused") continue;      // заморозка — не сгорает
          if (d <= burnTo || att[d] === "present") burned += 1; // прошедшие/посещённые
        }
      }
      const rem0 = k.remainder ?? packetOrig;
      const remainingTarget = isNewSale ? rem0 : Math.max(0, rem0 - burned);
      const totalLessons = remainingTarget + present;

      const sectionId = sectionIdByKey[sectionKey];
      const existing = cardByKey.get(`${ent.childId}|${sectionId}`);
      cards.push({
        ent, sectionKey, sectionId, insts, start, end, type, placeholder, isNewSale,
        totalLessons, packetOrig, rem0, burned, present, remainingTarget,
        remainderMissing: k.remainder == null,
        freezeQuota: k.freeze_left ?? (type === "monthly" ? 0 : 3),
        paySum: k.pay_sum ?? null,
        cardId: existing?.id ?? CARD_ID(++nextCard),
        existing,
      });
    }
  }

  // --- 6. Занятия (новые группы + недостающие даты у существующих) ----------
  // Существующей группе мог добавиться день недели (ВТ.ЧТ → ВТ.ЧТ.СБ) — под
  // новые даты занятий в БД нет, а без занятия отметку поставить некуда.
  const newLessons = [];
  nextLesson = Math.max(0, ...dbLessons.map((l) => (l.id.startsWith("1e550000") ? parseInt(l.id.slice(-12), 16) : 0)));
  const addLesson = (b, d) => {
    if (lessonByKey.has(`${b.groupId}|${d}`)) return;
    const slot = b.sched.find((s) => s[0] === dowOf(d)) ?? b.sched[0];
    const row = {
      id: LESSON_ID(++nextLesson), organization_id: ORG_ID, group_id: b.groupId, coach_id: b.coachId,
      date: d, start_time: slot[1], duration_min: slot[2], type: "regular",
      status: d <= TODAY ? "completed" : "scheduled",
    };
    newLessons.push(row);
    lessonByKey.set(`${b.groupId}|${d}`, row);
  };
  for (const b of blocks) {
    if (b.isNew) { for (let d = AUG1; d <= HORIZON; d = addDays(d, 1)) if (b.sched.some((s) => s[0] === dowOf(d))) addLesson(b, d); }
    else for (const d of b.dates) if (b.sched.some((s) => s[0] === dowOf(d))) addLesson(b, d);
  }
  // расписание группы изменилось → перезаписываем слоты
  const schedChanged = blocks.filter((b) => !b.isNew && (() => {
    const cur = (schedByGroup.get(b.groupId) ?? []).map((s) => `${s.day_of_week}|${String(s.start_time).slice(0, 5)}`).sort().join(",");
    const want = b.sched.map((s) => `${s[0]}|${s[1]}`).sort().join(",");
    return cur !== want;
  })());

  const attUpserts = []; const attMissingLesson = [];
  for (const b of blocks) {
    for (const kid of b.kids) {
      const ent = entities.find((e) => e.key === norm(kid.fio));
      for (const [d, st] of Object.entries(kid.attendance)) {
        const l = lessonByKey.get(`${b.groupId}|${d}`);
        if (!l) { attMissingLesson.push(`${b.name} ${d}`); continue; }
        const prev = attByKey.get(`${l.id}|${ent.childId}`);
        if (prev && prev.status === st) continue;
        attUpserts.push({ lesson_id: l.id, child_id: ent.childId, status: st, ...(prev ? { id: prev.id } : {}) });
      }
    }
  }

  // --- 7. Семьи / enrollments ----------------------------------------------
  const famUpserts = [];
  for (const ent of entities) {
    const phone = ent.parent?.phone ?? null;
    const known = phone ? famByPhone.get(phone) : null;
    if (known) { ent.familyId = known.id; continue; }
    if (ent.db?.family_id) { ent.familyId = ent.db.family_id; continue; }
    const fid = FAMILY_ID(++nextFamily);
    ent.familyId = fid;
    const p = ent.parent;
    const isFather = p?.name && MALE_NAMES.has(norm(p.name).split(" ")[0]);
    famUpserts.push({
      id: fid, organization_id: ORG_ID,
      father_name: isFather ? p.name : null, father_phone: isFather ? p.phone : null,
      mother_name: !isFather ? (p?.name ?? null) : null, mother_phone: !isFather ? (p?.phone ?? null) : null,
      responsible_manager_id: profByName.get(norm(ent.manager ?? ""))?.id ?? null,
    });
    if (phone) famByPhone.set(phone, { id: fid });
  }

  const enrollInserts = [];
  for (const b of blocks) {
    for (const kid of b.kids) {
      const ent = entities.find((e) => e.key === norm(kid.fio));
      if (enrollByKey.has(`${ent.childId}|${b.groupId}`)) continue;
      enrollInserts.push({ child_id: ent.childId, group_id: b.groupId, start_date: AUG1 });
      enrollByKey.set(`${ent.childId}|${b.groupId}`, true);
    }
  }

  // --- 8. Отчёт ------------------------------------------------------------
  const newChildren = entities.filter((e) => e.isNew);
  const cardNew = cards.filter((c) => !c.existing);
  const cardChanged = cards.filter((c) => c.existing && (c.existing.total_lessons !== c.totalLessons || c.existing.start_date !== c.start || c.existing.end_date !== c.end));
  const renamedGroups = blocks.filter((b) => b.renamedFrom);
  console.log("\n=== ЧТО ИЗМЕНИТСЯ ===");
  console.log(`  групп новых:            ${newGroups.length}${newGroups.length ? "  → " + newGroups.map((g) => g.name).join("; ") : ""}`);
  console.log(`  групп переименовано:    ${renamedGroups.length}`);
  for (const b of renamedGroups) console.log(`      «${b.renamedFrom}» → «${b.name}»`);
  console.log(`  расписаний обновить:    ${schedChanged.length}${schedChanged.length ? "  → " + schedChanged.map((g) => g.name).join("; ") : ""}`);
  console.log(`  занятий создать:        ${newLessons.length}`);
  if (skippedBlocks.length) console.log(`  пропущено блоков:       ${skippedBlocks.length} (нет расписания → это не группы)\n      ${skippedBlocks.join("\n      ")}`);
  console.log(`  детей новых:            ${newChildren.length}`);
  console.log(`  переименований:         ${renames.length}`);
  for (const [a, b2] of renames) console.log(`      «${a}» → «${b2}»`);
  console.log(`  семей новых:            ${famUpserts.length}`);
  console.log(`  карт новых:             ${cardNew.length}`);
  console.log(`  карт с изменениями:     ${cardChanged.length}`);
  console.log(`  записей в группы:       ${enrollInserts.length}`);
  console.log(`  отметок добавить/изм.:  ${attUpserts.length}`);
  console.log(`  в БД, но нет в табеле:  ${goneChildren.length} детей (НЕ трогаем)`);
  if (goneChildren.length) console.log("      " + goneChildren.map((c) => c.full_name).join(", "));
  if (attMissingLesson.length) console.log(`  ! отметки без занятия:  ${attMissingLesson.length} (${[...new Set(attMissingLesson)].slice(0, 5).join("; ")}…)`);

  console.log("\n=== Примеры пересчёта остатка ===");
  for (const c of cards.filter((x) => !x.remainderMissing).slice(0, 8)) {
    console.log(`  ${c.ent.name} [${c.sectionKey}] ${c.isNewSale ? "НОВАЯ ПРОДАЖА" : "старая"} ост=${c.rem0} сгор=${c.burned} был=${c.present} → total=${c.totalLessons} (в системе покажет ${c.remainingTarget})`);
  }

  // --- сверка: остаток в системе == остаток по формуле клиента ---------------
  if (process.argv.includes("--verify")) {
    const bal = await pageAll("v_child_card_balance", "club_card_id, remaining, total_lessons, attended_present", "club_card_id");
    const byId = new Map(bal.map((b) => [b.club_card_id, b]));
    let ok = 0; const bad = [];
    for (const c of cards) {
      const b = byId.get(c.cardId);
      if (!b) { bad.push(`${c.ent.name}: нет строки баланса`); continue; }
      if (Number(b.remaining) === c.remainingTarget) ok += 1;
      else bad.push(`${c.ent.name} [${c.sectionKey}]: в системе ${b.remaining}, по формуле ${c.remainingTarget} (total=${b.total_lessons}, был=${b.attended_present})`);
    }
    console.log(`\n=== СВЕРКА ОСТАТКОВ: ${ok}/${cards.length} сходятся ===`);
    for (const m of bad.slice(0, 25)) console.log("  ✗ " + m);
    if (bad.length > 25) console.log(`  … ещё ${bad.length - 25}`);
    return;
  }

  if (!APPLY) { console.log("\n--dry-run: в БД ничего не записано. Повтори с --apply."); return; }

  // --- 9. Применение -------------------------------------------------------
  const chunked = async (table, rows, label, opts) => {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from(table).upsert(rows.slice(i, i + 200), opts);
      if (error) die(`${label} (чанк ${i})`, error);
    }
    if (rows.length) console.log(`  ✓ ${label}: ${rows.length}`);
  };

  console.log("\n=== ЗАПИСЬ ===");
  for (const b of newGroups) {
    const { error } = await sb.from("groups").upsert({
      id: b.groupId, organization_id: ORG_ID, section_id: b.sectionId, coach_id: b.coachId,
      name: b.name, max_capacity: b.capacity, hard_limit_override: true,
      duration_min: b.sched[0][2], level: b.level, is_active: true,
    });
    if (error) die(`group ${b.name}`, error);
    await sb.from("group_schedule").delete().eq("group_id", b.groupId);
    for (const [dow, time, dur] of b.sched) {
      const { error: e2 } = await sb.from("group_schedule").insert({ group_id: b.groupId, day_of_week: dow, start_time: time, duration_min: dur });
      if (e2) die(`schedule ${b.name}`, e2);
    }
    console.log(`  ✓ группа: ${b.name}`);
  }
  // существующие группы: имя (если поменялись дни) и слоты расписания
  for (const b of blocks.filter((x) => !x.isNew && (x.renamedFrom || schedChanged.includes(x)))) {
    if (b.renamedFrom) {
      const { error } = await sb.from("groups").update({ name: b.name, duration_min: b.sched[0][2] }).eq("id", b.groupId);
      if (error) die(`rename group ${b.name}`, error);
    }
    if (schedChanged.includes(b)) {
      await sb.from("group_schedule").delete().eq("group_id", b.groupId);
      for (const [dow, time, dur] of b.sched) {
        const { error } = await sb.from("group_schedule").insert({ group_id: b.groupId, day_of_week: dow, start_time: time, duration_min: dur });
        if (error) die(`schedule ${b.name}`, error);
      }
    }
    console.log(`  ✓ обновлена группа: ${b.name}`);
  }
  await chunked("lessons", newLessons, "занятия");
  await chunked("families", famUpserts, "семьи");
  await chunked("children", entities.map((e) => ({
    id: e.childId, organization_id: ORG_ID, family_id: e.familyId, full_name: e.name,
    birth_date: e.db?.birth_date ?? fakeBirthDate(e.name), status: "active",
    responsible_manager_id: profByName.get(norm(e.manager ?? ""))?.id ?? e.db?.responsible_manager_id ?? null,
    amo_url: e.amo ?? e.db?.amo_url ?? null,
  })), "дети");
  await chunked("club_cards", cards.map((c) => ({
    id: c.cardId, organization_id: ORG_ID, child_id: c.ent.childId, section_id: c.sectionId,
    type: c.type, total_lessons: c.totalLessons, freeze_quota: c.freezeQuota,
    price_paid: c.paySum ?? c.existing?.price_paid ?? 0, discount: 0,
    start_date: c.start, end_date: c.end, status: "active",
  })), "карты");
  if (enrollInserts.length) {
    for (let i = 0; i < enrollInserts.length; i += 200) {
      const { error } = await sb.from("enrollments").insert(enrollInserts.slice(i, i + 200));
      if (error) die(`enrollments (чанк ${i})`, error);
    }
    console.log(`  ✓ записи в группы: ${enrollInserts.length}`);
  }
  await chunked("attendance", attUpserts, "отметки", { onConflict: "lesson_id,child_id" });

  const { error: rlErr } = await sb.rpc("refresh_lifecycle");
  if (rlErr) console.error("  ! refresh_lifecycle:", rlErr.message); else console.log("  ✓ refresh_lifecycle()");
  console.log("\nГотово.");
};

main().catch((e) => die("fatal", e));
