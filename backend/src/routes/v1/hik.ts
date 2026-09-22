import type { FastifyInstance, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { env } from "../../lib/env.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { authenticate, requireRole, OFFICE_ROLES, SCHEDULE_ROLES, SALES_ROLES } from "../../middleware/auth.js";
import { getStorage } from "../../lib/storage.js";
import { hikEventSchema, hikHeartbeatSchema, type HikEvent } from "../../schemas/hik.js";
import { matchPtLesson, orgDatesAround, type PtLessonCandidate } from "../../lib/hik-pt.js";
import { markEnrolled, forgetChild } from "../../lib/hik-face-sync.js";
import {
  getStaffAccess, setStaffAccess, nextStaffPersonNo, listStaffAccess,
} from "../../lib/hik-staff.js";
import {
  accessSyncStatus, currentValidFor, invalidateGrants, loadAccessSettings,
  runAccessWindowSync, windowsForChild,
} from "../../lib/hik-access-windows.js";
import { listInside } from "../../lib/hik-presence.js";

// =====================================================================
// Турникеты Hikvision — приём событий проходов (§6 документа).
// Каналы: ISUP-сервис (нормализованный JSON + Bearer) и прямой HTTP-push
// с терминала (родной формат AccessControllerEvent, секрет в ?key=,
// т.к. терминал не умеет ставить заголовки).
// Посещаемость НЕ трогаем — только журнал access_events.
// =====================================================================

const secretOk = (req: FastifyRequest): boolean => {
  const secret = env.HIK_INGEST_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const qkey = (req.query as Record<string, string | undefined>)?.key;
  const candidate = bearer ?? qkey;
  if (!candidate) return false;
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
};

let cachedOrgId: string | null = null;
const getOrgId = async (): Promise<string> => {
  if (cachedOrgId) return cachedOrgId;
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .limit(1)
    .single();
  if (error || !data) throw new Error("no_organization");
  cachedOrgId = data.id;
  return cachedOrgId!;
};

// Родной push терминала → нормализованное событие.
// Коды: majorEventType 5, subEventType 75 = лицо ОК, 76 = лицо не распознано,
// 38 = карта ОК. Направление: attendanceStatus или cardReaderNo (1=вход, 2=выход).
const normalizeNative = (body: any): HikEvent | null => {
  const ev = body?.AccessControllerEvent;
  if (!ev) return null;
  const sub = Number(ev.subEventType ?? -1);
  const event_type =
    sub === 75 ? "face_ok" : sub === 76 ? "face_fail" : sub === 38 ? "card_ok" : "other";
  const att = String(ev.attendanceStatus ?? "");
  const reader = Number(ev.cardReaderNo ?? 0);
  const direction =
    att === "checkIn" ? "in" : att === "checkOut" ? "out"
    : reader === 1 ? "in" : reader === 2 ? "out" : "unknown";
  const occurred = body.dateTime ?? new Date().toISOString();
  return {
    device_serial: String(ev.deviceName || body.macAddress || body.ipAddress || "unknown"),
    person_no: ev.employeeNoString != null ? String(ev.employeeNoString)
      : ev.employeeNo != null ? String(ev.employeeNo) : null,
    event_serial: ev.serialNo != null ? Number(ev.serialNo) : null,
    event_type,
    direction,
    occurred_at: occurred,
    raw: body,
  };
};

// Из multipart-push'а терминала достаём JSON-часть (снимок игнорируем).
const extractMultipartJson = async (req: FastifyRequest): Promise<unknown | null> => {
  let found: unknown | null = null;
  for await (const part of req.parts()) {
    try {
      if (part.type === "field") {
        const val = String(part.value ?? "");
        if (val.trimStart().startsWith("{")) found = found ?? JSON.parse(val);
      } else {
        const buf = await part.toBuffer(); // файл нужно потребить, иначе стрим виснет
        if ((part.mimetype ?? "").includes("json")) {
          found = found ?? JSON.parse(buf.toString("utf8"));
        }
      }
    } catch {
      // битую часть пропускаем — терминалы шлют разное
    }
  }
  return found;
};

// §6.3: успешный проход ребёнка с ПТ-занятием сегодня в окне ±90 мин →
// автозаполняем entry_time/exit_time. Проведение по-прежнему отмечает тренер.
const autofillPtEntryExit = async (
  log: FastifyRequest["log"],
  childId: string,
  direction: "in" | "out" | "unknown",
  occurredAt: string,
) => {
  try {
    const eventMs = Date.parse(occurredAt);
    if (Number.isNaN(eventMs)) return;
    const { data, error } = await supabaseAdmin
      .from("pt_lessons")
      .select("id, entry_time, exit_time, status, pt_sessions!inner(date, start_time, duration_min, status)")
      .eq("child_id", childId)
      .in("pt_sessions.date", orgDatesAround(eventMs));
    if (error) {
      log.warn({ err: error, child: childId }, "hik_pt_select_failed");
      return;
    }
    if (!data?.length) return;

    const candidates: PtLessonCandidate[] = data.map((row: any) => ({
      id: row.id,
      entry_time: row.entry_time,
      exit_time: row.exit_time,
      status: row.status,
      session: row.pt_sessions,
    }));
    const match = matchPtLesson(candidates, eventMs, direction);
    if (!match) return;

    let q = supabaseAdmin.from("pt_lessons").update(match.patch).eq("id", match.id);
    // страховки от гонок на уровне БД: вход не перезаписываем,
    // выход двигаем только вперёд (конкурентные "out" не откатят время)
    if ("entry_time" in match.patch) q = q.is("entry_time", null);
    else q = q.or(`exit_time.is.null,exit_time.lt.${match.patch.exit_time}`);
    const { error: updErr } = await q;
    if (updErr) log.warn({ err: updErr, lesson: match.id }, "hik_pt_autofill_failed");
    else log.info({ lesson: match.id, patch: match.patch }, "hik_pt_autofill");
  } catch (e) {
    log.warn({ err: e }, "hik_pt_autofill_threw"); // автозаполнение не должно ронять ingest
  }
};

const touchDevice = async (orgId: string, serial: string, ip?: string | null) => {
  const { data } = await supabaseAdmin
    .from("access_devices")
    .update({ last_seen_at: new Date().toISOString(), ...(ip ? { ip } : {}) })
    .eq("serial", serial)
    .select("id");
  if (!data || data.length === 0) {
    await supabaseAdmin.from("access_devices").insert({
      organization_id: orgId,
      serial,
      name: serial,
      ip: ip ?? null,
    });
  }
};

export const hikRoutes = async (app: FastifyInstance) => {
  // --- приём события прохода -----------------------------------------
  app.post("/v1/hik/events", async (req, reply) => {
    if (!env.HIK_INGEST_SECRET) return reply.code(503).send({ error: "hik_disabled" });
    if (!secretOk(req)) return reply.code(401).send({ error: "unauthorized" });

    try {
      const body = req.isMultipart() ? await extractMultipartJson(req) : req.body;
      if (!body) {
        req.log.warn({ ct: req.headers["content-type"] }, "hik_event_empty");
        return reply.send({ ok: false, error: "empty" }); // 200 — чтобы терминал не ретраил вечно
      }

      let ev: HikEvent | null = normalizeNative(body);
      if (!ev) {
        const parsed = hikEventSchema.safeParse(body);
        if (!parsed.success) {
          req.log.warn({ body }, "hik_event_unparsed");
          return reply.send({ ok: false, error: "unparsed" });
        }
        ev = parsed.data;
      }

      const orgId = await getOrgId();
      // event_serial обязателен для идемпотентности; если терминал его не дал —
      // fallback из времени + хеша person_no/типа, чтобы два разных ребёнка
      // в одну секунду не схлопнулись в «дубль»
      let eventSerial = ev.event_serial;
      if (eventSerial == null) {
        const tag = `${ev.person_no ?? ""}|${ev.event_type}|${ev.direction}`;
        let h = 0;
        for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) % 1000;
        eventSerial = Date.parse(ev.occurred_at) * 1000 + h;
      }

      // терминалы не всегда сообщают направление — берём его из настройки
      // устройства («Вход»/«Выход» в access_devices)
      let direction = ev.direction;
      if (direction === "unknown") {
        const { data: dev } = await supabaseAdmin
          .from("access_devices").select("direction")
          .eq("serial", ev.device_serial).maybeSingle();
        if (dev?.direction === "in" || dev?.direction === "out") direction = dev.direction;
      }

      let childId: string | null = null;
      if (ev.person_no) {
        const { data: child } = await supabaseAdmin
          .from("children")
          .select("id")
          .eq("access_person_no", ev.person_no)
          .is("deleted_at", null)
          .maybeSingle();
        childId = child?.id ?? null;
        if (!childId) req.log.info({ person_no: ev.person_no }, "hik_event_unmatched_person");
      }

      const { error: insErr } = await supabaseAdmin.from("access_events").insert({
        organization_id: orgId,
        child_id: childId,
        person_no: ev.person_no ?? null,
        device_serial: ev.device_serial,
        event_serial: eventSerial,
        event_type: ev.event_type,
        direction,
        occurred_at: ev.occurred_at,
        raw: ev.raw ?? body,
      });

      if (insErr && insErr.code !== "23505") {
        req.log.error({ err: insErr }, "hik_event_insert_failed");
        return reply.send({ ok: false, error: "insert_failed" });
      }

      await touchDevice(orgId, ev.device_serial);

      const isDup = insErr?.code === "23505";
      if (!isDup && childId && (ev.event_type === "face_ok" || ev.event_type === "card_ok")) {
        await autofillPtEntryExit(req.log, childId, direction, ev.occurred_at);
      }
      return reply.send({ ok: true, dedup: isDup || undefined });
    } catch (e) {
      req.log.error({ err: e }, "hik_event_threw");
      return reply.send({ ok: false, error: "internal" });
    }
  });

  // --- heartbeat от ISUP-сервиса --------------------------------------
  app.post("/v1/hik/heartbeat", async (req, reply) => {
    if (!env.HIK_INGEST_SECRET) return reply.code(503).send({ error: "hik_disabled" });
    if (!secretOk(req)) return reply.code(401).send({ error: "unauthorized" });
    const parsed = hikHeartbeatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const orgId = await getOrgId();
    await touchDevice(orgId, parsed.data.device_serial, parsed.data.ip);
    return reply.send({ ok: true });
  });

  // --- последние проходы (лента на странице «Проходная») ---------------
  app.get("/v1/hik/recent",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES, "coach")] },
    async (_req, reply) => {
      const { data, error } = await supabaseAdmin
        .from("access_events")
        .select("id, person_no, device_serial, event_type, direction, occurred_at, children(full_name)")
        .order("occurred_at", { ascending: false })
        .limit(50);
      if (error) return reply.code(500).send({ error: "query_failed" });
      // сотрудники не привязаны к строке события — подписываем по номеру
      const staff = await listStaffAccess().catch(() => []);
      const byNo = new Map(staff.map((s) => [s.access.access_person_no, s.full_name]));
      const events = (data ?? []).map((e) => ({
        ...e,
        person_name: (e as unknown as { children?: { full_name: string } | null }).children?.full_name
          ?? (e.person_no ? byNo.get(e.person_no) ?? null : null),
      }));
      return reply.send({ events });
    });

  // --- терминалы: список с онлайн-статусом и текущим режимом ------------
  app.get("/v1/hik/devices",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES)] },
    async (_req, reply) => {
      const { data: devices, error } = await supabaseAdmin
        .from("access_devices")
        .select("serial, name, ip, direction, last_seen_at, is_active")
        .order("created_at");
      if (error) return reply.code(500).send({ error: "query_failed" });

      const now = Date.now();
      const result = await Promise.all((devices ?? []).map(async (d) => {
        // Режим = последняя КОМАНДА-РЕЖИМ этого устройства. Разовое "open"
        // не меняет режим терминала и потому в выборку не входит.
        const { data: last } = await supabaseAdmin
          .from("access_door_commands")
          .select("cmd")
          .eq("device_serial", d.serial)
          .in("cmd", ["alwaysOpen", "alwaysClose", "resume"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const mode = last?.cmd === "alwaysOpen" ? "alwaysOpen"
          : last?.cmd === "alwaysClose" ? "alwaysClose" : "normal";
        const online = !!d.last_seen_at && now - Date.parse(d.last_seen_at) < 3 * 60_000;
        return { ...d, online, mode };
      }));
      return reply.send({ devices: result });
    });

  // --- команда турникету: открыть разово / свободный проход / обычный ---
  // 09-22: менеджеры тоже (SALES_ROLES) — зеркало perm manage_turnstiles.
  app.post<{ Params: { serial: string } }>("/v1/hik/devices/:serial/door",
    { preHandler: [authenticate, requireRole(...SALES_ROLES)] },
    async (req, reply) => {
      const cmd = (req.body as { cmd?: string })?.cmd;
      if (!cmd || !["open", "alwaysOpen", "alwaysClose", "resume"].includes(cmd)) {
        return reply.code(400).send({ error: "bad_cmd" });
      }
      const serial = req.params.serial;
      const { data: device } = await supabaseAdmin
        .from("access_devices").select("serial").eq("serial", serial).maybeSingle();
      if (!device) return reply.code(404).send({ error: "device_not_found" });
      const orgId = await getOrgId(); // до команды: после неё падать уже нельзя

      try {
        const res = await fetch(`${env.ISUP_API_URL}/door`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": env.HIK_INGEST_SECRET ?? "" },
          body: JSON.stringify({ device_id: serial, cmd }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = await res.text();
        if (!res.ok) {
          req.log.warn({ serial, cmd, status: res.status, body }, "hik_door_cmd_failed");
          return reply.code(502).send({ error: "terminal_rejected", detail: body.slice(0, 300) });
        }
      } catch (e) {
        req.log.error({ err: e, serial, cmd }, "hik_door_cmd_threw");
        return reply.code(502).send({ error: "isup_unreachable" });
      }

      const { error: auditErr } = await supabaseAdmin.from("access_door_commands").insert({
        organization_id: orgId,
        device_serial: serial,
        cmd,
        actor: req.user!.id,
      });
      if (auditErr) {
        // команда уже выполнена — не скрываем это, но честно помечаем аудит
        req.log.error({ err: auditErr, serial, cmd }, "hik_door_audit_failed");
        return reply.send({ ok: true, audit_saved: false });
      }
      return reply.send({ ok: true });
    });

  // --- история проходов ребёнка (вкладка «Проходная» в карточке) --------
  app.get<{ Params: { childId: string } }>("/v1/hik/children/:childId/events",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES, "coach")] },
    async (req, reply) => {
      const { data, error } = await supabaseAdmin
        .from("access_events")
        .select("id, person_no, device_serial, event_type, direction, occurred_at")
        .eq("child_id", req.params.childId)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) return reply.code(500).send({ error: "query_failed" });
      return reply.send({ events: data });
    });

  // --- живой статус лица с терминала (+ синхронизация face_enrolled_at) --
  app.get<{ Params: { childId: string } }>("/v1/hik/children/:childId/face-status",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES)] },
    async (req, reply) => {
      const { data: child } = await supabaseAdmin
        .from("children").select("id, access_person_no, face_enrolled_at")
        .eq("id", req.params.childId).maybeSingle();
      if (!child) return reply.code(404).send({ error: "child_not_found" });
      if (!child.access_person_no) return reply.send({ enrolled: false });

      try {
        const res = await fetch(`${env.ISUP_API_URL}/face-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": env.HIK_INGEST_SECRET ?? "" },
          body: JSON.stringify({ person_no: child.access_person_no }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return reply.code(502).send({ error: "terminal_unreachable" });
        const { enrolled } = (await res.json()) as { enrolled: boolean };
        // БД догоняет реальность терминала (лицо могли удалить с его экрана)
        if (enrolled && !child.face_enrolled_at) {
          await supabaseAdmin.from("children")
            .update({ face_enrolled_at: new Date().toISOString() }).eq("id", child.id);
        } else if (!enrolled && child.face_enrolled_at) {
          await supabaseAdmin.from("children")
            .update({ face_enrolled_at: null }).eq("id", child.id);
        }
        return reply.send({ enrolled });
      } catch (e) {
        req.log.warn({ err: e }, "hik_face_status_threw");
        return reply.code(502).send({ error: "terminal_unreachable" });
      }
    });

  // --- удалить лицо и карточку ребёнка с терминала ----------------------
  app.post<{ Params: { childId: string } }>("/v1/hik/children/:childId/face-delete",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES)] },
    async (req, reply) => {
      const { data: child } = await supabaseAdmin
        .from("children").select("id, access_person_no")
        .eq("id", req.params.childId).maybeSingle();
      if (!child?.access_person_no) return reply.code(404).send({ error: "child_not_found" });

      try {
        const res = await fetch(`${env.ISUP_API_URL}/face-delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": env.HIK_INGEST_SECRET ?? "" },
          body: JSON.stringify({ person_no: child.access_person_no }),
          signal: AbortSignal.timeout(30_000),
        });
        const body = await res.text();
        if (!res.ok) {
          req.log.warn({ child: child.id, body }, "hik_face_delete_failed");
          return reply.code(502).send({ error: "terminal_rejected", detail: body.slice(0, 300) });
        }
      } catch (e) {
        req.log.error({ err: e }, "hik_face_delete_threw");
        return reply.code(502).send({ error: "isup_unreachable" });
      }

      await supabaseAdmin.from("children")
        .update({ face_enrolled_at: null, face_photo_path: null }).eq("id", child.id);
      forgetChild(child.id); // иначе фоновая синхронизация заведёт лицо обратно
      await invalidateGrants(child.id).catch(() => {});
      return reply.send({ ok: true });
    });

  // --- присвоить ребёнку номер на проходной (следующий свободный) -------
  app.post<{ Params: { childId: string } }>("/v1/hik/children/:childId/person-no",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES)] },
    async (req, reply) => {
      const { data: child } = await supabaseAdmin
        .from("children").select("id, access_person_no")
        .eq("id", req.params.childId).is("deleted_at", null).maybeSingle();
      if (!child) return reply.code(404).send({ error: "child_not_found" });
      if (child.access_person_no) return reply.send({ person_no: child.access_person_no });

      // max считает БД (rpc): PostgREST режет невыстроенные выборки на 1000 строк
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: next, error: rpcErr } = await supabaseAdmin.rpc("next_access_person_no");
        if (rpcErr || !next) {
          req.log.error({ err: rpcErr }, "hik_person_no_rpc_failed");
          return reply.code(500).send({ error: "person_no_failed" });
        }
        const { error } = await supabaseAdmin
          .from("children").update({ access_person_no: String(next) })
          .eq("id", child.id).is("access_person_no", null);
        if (!error) return reply.send({ person_no: String(next) });
        if (error.code !== "23505") {
          req.log.error({ err: error }, "hik_person_no_update_failed");
          return reply.code(500).send({ error: "person_no_failed" });
        }
        // 23505 = гонка за номер с параллельным запросом — пробуем следующий
      }
      return reply.code(409).send({ error: "retry" });
    });

  // --- заливка лица на терминал (фото ≤ 200 КБ JPEG, base64) ------------
  app.post<{ Params: { childId: string } }>("/v1/hik/children/:childId/enroll",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES)] },
    async (req, reply) => {
      const photoB64 = (req.body as { photo_base64?: string })?.photo_base64;
      if (!photoB64) return reply.code(400).send({ error: "photo_required" });
      let photo: Buffer;
      try {
        photo = Buffer.from(photoB64, "base64");
      } catch {
        return reply.code(400).send({ error: "bad_base64" });
      }
      if (photo.length < 5_000) return reply.code(400).send({ error: "photo_too_small" });
      if (photo.length > 200 * 1024) {
        return reply.code(400).send({ error: "photo_too_large", message: "Терминал принимает JPEG до 200 КБ" });
      }

      const { data: child } = await supabaseAdmin
        .from("children").select("id, full_name, access_person_no")
        .eq("id", req.params.childId).is("deleted_at", null).maybeSingle();
      if (!child) return reply.code(404).send({ error: "child_not_found" });
      if (!child.access_person_no) {
        return reply.code(409).send({ error: "no_person_no", message: "Сначала присвойте номер на проходной" });
      }

      // Режим «по расписанию»: персона сразу получает окно занятия, а не
      // бессрочный доступ до следующего тика реконсайлера.
      const valid = await currentValidFor(child.id);
      try {
        const res = await fetch(`${env.ISUP_API_URL}/enroll`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": env.HIK_INGEST_SECRET ?? "" },
          body: JSON.stringify({
            person_no: child.access_person_no,
            name: child.full_name,
            photo_base64: photoB64,
            ...(valid ? { valid_from: valid.begin, valid_until: valid.end } : {}),
          }),
          signal: AbortSignal.timeout(60_000), // терминал качает фото и детектит лицо
        });
        const body = await res.text();
        // ISUP-сервис отвечает по каждому терминалу: {"devices":{"uniqum":"ok",...}}
        try {
          const parsed = JSON.parse(body) as { devices?: Record<string, string> };
          const okDevices = Object.entries(parsed.devices ?? {})
            .filter(([, v]) => v === "ok").map(([k]) => k);
          if (okDevices.length) markEnrolled(child.id, okDevices);
        } catch { /* не JSON — ничего не помечаем, досинхронизирует фоновая задача */ }
        if (!res.ok) {
          req.log.warn({ child: child.id, status: res.status, body }, "hik_enroll_failed");
          return reply.code(502).send({ error: "terminal_rejected", detail: body.slice(0, 300) });
        }
      } catch (e) {
        req.log.error({ err: e, child: child.id }, "hik_enroll_threw");
        return reply.code(502).send({ error: "isup_unreachable" });
      }

      // фото сохраняем в хранилище — понадобится для второго терминала
      let facePath: string | null = null;
      try {
        const storage = getStorage();
        if (storage && env.MINIO_BUCKET) {
          facePath = `faces/${child.id}.jpg`;
          await storage.putObject(env.MINIO_BUCKET, facePath, photo, photo.length,
            { "Content-Type": "image/jpeg" });
        }
      } catch (e) {
        req.log.warn({ err: e }, "hik_face_photo_store_failed"); // не блокируем успех
        facePath = null;
      }

      // Это же фото становится аватаркой ребёнка: одно фото на систему —
      // и на турникете, и в журнале/карточке. Перезаписываем осознанно:
      // заливка лица — явное действие офиса со свежим портретом.
      await supabaseAdmin.from("children").update({
        face_enrolled_at: new Date().toISOString(),
        ...(facePath ? { face_photo_path: facePath, photo_path: facePath } : {}),
      }).eq("id", child.id);
      await invalidateGrants(child.id).catch(() => {}); // реконсайлер перепроверит окно

      return reply.send({ ok: true });
    });

  // =====================================================================
  // Проходная по расписанию (lib/hik-access-windows.ts, lib/hik-presence.ts)
  // =====================================================================

  // --- настройки режима + статус синхронизации -------------------------
  app.get("/v1/hik/settings",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES)] },
    async (_req, reply) => {
      const settings = await loadAccessSettings();
      return reply.send({ settings, sync: accessSyncStatus() });
    });

  app.patch("/v1/hik/settings",
    { preHandler: [authenticate, requireRole(...SCHEDULE_ROLES)] },
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        access_schedule_enabled?: boolean; access_before_min?: number;
        access_after_min?: number; access_auto_exit_hours?: number;
      };
      const patch: Record<string, unknown> = {};
      if (typeof body.access_schedule_enabled === "boolean") patch.access_schedule_enabled = body.access_schedule_enabled;
      for (const [k, max] of [["access_before_min", 180], ["access_after_min", 180], ["access_auto_exit_hours", 24]] as const) {
        const v = body[k];
        if (v === undefined) continue;
        if (!Number.isInteger(v) || v < 0 || v > max) return reply.code(400).send({ error: "bad_value", field: k });
        patch[k] = v;
      }
      if (Object.keys(patch).length === 0) return reply.code(400).send({ error: "empty_patch" });
      const orgId = await getOrgId();
      const { error } = await supabaseAdmin.from("org_settings")
        .update({ ...patch, updated_by: req.user!.id, updated_at: new Date().toISOString() })
        .eq("organization_id", orgId);
      if (error) {
        req.log.error({ err: error }, "hik_settings_update_failed");
        return reply.code(500).send({ error: "update_failed" });
      }
      // применяем сразу, не дожидаясь минутного тика (в фоне — тик может идти минуты)
      void runAccessWindowSync(req.log).catch(() => {});
      const settings = await loadAccessSettings();
      return reply.send({ settings, sync: accessSyncStatus() });
    });

  // --- кто сейчас в здании ----------------------------------------------
  app.get("/v1/hik/inside",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES, "coach")] },
    async (_req, reply) => {
      try {
        return reply.send({ inside: await listInside() });
      } catch (e) {
        _req.log.warn({ err: e }, "hik_inside_failed");
        return reply.code(500).send({ error: "query_failed" });
      }
    });

  // --- окно доступа ребёнка на сегодня + что выставлено на терминалах ---
  app.get<{ Params: { childId: string } }>("/v1/hik/children/:childId/window",
    { preHandler: [authenticate, requireRole(...OFFICE_ROLES, "coach")] },
    async (req, reply) => {
      try {
        const w = await windowsForChild(req.params.childId);
        const { data: grants } = await supabaseAdmin
          .from("access_grants")
          .select("device_serial, state, valid_from, valid_until, pushed_at, error")
          .eq("child_id", req.params.childId);
        const inside = (await listInside()).find((p) => p.child_id === req.params.childId) ?? null;
        return reply.send({ ...w, grants: grants ?? [], inside });
      } catch (e) {
        req.log.warn({ err: e }, "hik_child_window_failed");
        return reply.code(500).send({ error: "query_failed" });
      }
    });

  // =====================================================================
  // Проходная для СОТРУДНИКОВ (все profiles: тренеры, менеджеры, директор).
  // Те же операции, что для детей; данные — в app_metadata учётки
  // (см. lib/hik-staff.ts). Ключ кэша синхронизации: "staff:<profileId>".
  // =====================================================================
  const staffGuard = [authenticate, requireRole(...OFFICE_ROLES)];

  const loadStaff = async (profileId: string) => {
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("id, full_name").eq("id", profileId).maybeSingle();
    if (!profile) return null;
    const access = await getStaffAccess(profileId);
    return access ? { ...profile, access } : null;
  };

  app.get<{ Params: { profileId: string } }>("/v1/hik/staff/:profileId/access",
    { preHandler: staffGuard },
    async (req, reply) => {
      const s = await loadStaff(req.params.profileId);
      if (!s) return reply.code(404).send({ error: "staff_not_found" });
      return reply.send(s.access);
    });

  app.get<{ Params: { profileId: string } }>("/v1/hik/staff/:profileId/events",
    { preHandler: staffGuard },
    async (req, reply) => {
      const s = await loadStaff(req.params.profileId);
      if (!s) return reply.code(404).send({ error: "staff_not_found" });
      if (!s.access.access_person_no) return reply.send({ events: [] });
      const { data, error } = await supabaseAdmin
        .from("access_events")
        .select("id, person_no, device_serial, event_type, direction, occurred_at")
        .eq("person_no", s.access.access_person_no)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) return reply.code(500).send({ error: "query_failed" });
      return reply.send({ events: data });
    });

  app.post<{ Params: { profileId: string } }>("/v1/hik/staff/:profileId/person-no",
    { preHandler: staffGuard },
    async (req, reply) => {
      const s = await loadStaff(req.params.profileId);
      if (!s) return reply.code(404).send({ error: "staff_not_found" });
      if (s.access.access_person_no) return reply.send({ person_no: s.access.access_person_no });
      const personNo = await nextStaffPersonNo();
      await setStaffAccess(s.id, { access_person_no: personNo });
      return reply.send({ person_no: personNo });
    });

  app.get<{ Params: { profileId: string } }>("/v1/hik/staff/:profileId/face-status",
    { preHandler: staffGuard },
    async (req, reply) => {
      const s = await loadStaff(req.params.profileId);
      if (!s) return reply.code(404).send({ error: "staff_not_found" });
      if (!s.access.access_person_no) return reply.send({ enrolled: false });
      try {
        const res = await fetch(`${env.ISUP_API_URL}/face-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": env.HIK_INGEST_SECRET ?? "" },
          body: JSON.stringify({ person_no: s.access.access_person_no }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return reply.code(502).send({ error: "terminal_unreachable" });
        const { enrolled } = (await res.json()) as { enrolled: boolean };
        if (enrolled && !s.access.face_enrolled_at) {
          await setStaffAccess(s.id, { face_enrolled_at: new Date().toISOString() });
        } else if (!enrolled && s.access.face_enrolled_at) {
          await setStaffAccess(s.id, { face_enrolled_at: null });
        }
        return reply.send({ enrolled });
      } catch (e) {
        req.log.warn({ err: e }, "hik_staff_face_status_threw");
        return reply.code(502).send({ error: "terminal_unreachable" });
      }
    });

  app.post<{ Params: { profileId: string } }>("/v1/hik/staff/:profileId/face-delete",
    { preHandler: staffGuard },
    async (req, reply) => {
      const s = await loadStaff(req.params.profileId);
      if (!s?.access.access_person_no) return reply.code(404).send({ error: "staff_not_found" });
      try {
        const res = await fetch(`${env.ISUP_API_URL}/face-delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": env.HIK_INGEST_SECRET ?? "" },
          body: JSON.stringify({ person_no: s.access.access_person_no }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          return reply.code(502).send({ error: "terminal_rejected", detail: (await res.text()).slice(0, 300) });
        }
      } catch (e) {
        req.log.error({ err: e }, "hik_staff_face_delete_threw");
        return reply.code(502).send({ error: "isup_unreachable" });
      }
      await setStaffAccess(s.id, { face_enrolled_at: null, face_photo_path: null });
      forgetChild(`staff:${s.id}`);
      return reply.send({ ok: true });
    });

  app.post<{ Params: { profileId: string } }>("/v1/hik/staff/:profileId/enroll",
    { preHandler: staffGuard },
    async (req, reply) => {
      const photoB64 = (req.body as { photo_base64?: string })?.photo_base64;
      if (!photoB64) return reply.code(400).send({ error: "photo_required" });
      const photo = Buffer.from(photoB64, "base64");
      if (photo.length < 5_000) return reply.code(400).send({ error: "photo_too_small" });
      if (photo.length > 200 * 1024) {
        return reply.code(400).send({ error: "photo_too_large", message: "Терминал принимает JPEG до 200 КБ" });
      }
      const s = await loadStaff(req.params.profileId);
      if (!s) return reply.code(404).send({ error: "staff_not_found" });
      if (!s.access.access_person_no) {
        return reply.code(409).send({ error: "no_person_no", message: "Сначала присвойте номер на проходной" });
      }

      try {
        const res = await fetch(`${env.ISUP_API_URL}/enroll`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": env.HIK_INGEST_SECRET ?? "" },
          body: JSON.stringify({ person_no: s.access.access_person_no, name: s.full_name, photo_base64: photoB64 }),
          signal: AbortSignal.timeout(60_000),
        });
        const body = await res.text();
        try {
          const parsed = JSON.parse(body) as { devices?: Record<string, string> };
          const okDevices = Object.entries(parsed.devices ?? {})
            .filter(([, v]) => v === "ok").map(([k]) => k);
          if (okDevices.length) markEnrolled(`staff:${s.id}`, okDevices);
        } catch { /* досинхронизирует фоновая задача */ }
        if (!res.ok) {
          req.log.warn({ staff: s.id, status: res.status, body }, "hik_staff_enroll_failed");
          return reply.code(502).send({ error: "terminal_rejected", detail: body.slice(0, 300) });
        }
      } catch (e) {
        req.log.error({ err: e, staff: s.id }, "hik_staff_enroll_threw");
        return reply.code(502).send({ error: "isup_unreachable" });
      }

      let facePath: string | null = null;
      try {
        const storage = getStorage();
        if (storage && env.MINIO_BUCKET) {
          facePath = `faces/staff/${s.id}.jpg`;
          await storage.putObject(env.MINIO_BUCKET, facePath, photo, photo.length, { "Content-Type": "image/jpeg" });
        }
      } catch (e) {
        req.log.warn({ err: e }, "hik_staff_face_photo_store_failed");
        facePath = null;
      }
      await setStaffAccess(s.id, {
        face_enrolled_at: new Date().toISOString(),
        ...(facePath ? { face_photo_path: facePath } : {}),
      });
      // Как и у детей: фото с турникета становится аватаркой сотрудника
      // (список пользователей, тренеры, профиль в PWA). profiles.avatar_url
      // хранит абсолютный URL — отдаём через тот же прокси /v1/uploads/file.
      if (facePath) {
        const { error: aErr } = await supabaseAdmin
          .from("profiles")
          .update({ avatar_url: `${req.protocol}://${req.hostname}/v1/uploads/file/${facePath}` })
          .eq("id", s.id);
        if (aErr) req.log.warn({ err: aErr, staff: s.id }, "hik_staff_avatar_save_failed");
      }
      return reply.send({ ok: true });
    });
};
