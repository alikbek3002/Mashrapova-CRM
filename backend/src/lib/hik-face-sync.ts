// Единая база лиц на всех терминалах: система — источник истины.
// Фоновая синхронизация дозаливает лицо ребёнка на каждый онлайн-терминал,
// где его ещё нет (новый терминал, терминал был офлайн при заливке).
// Состояние «проверено/заведено на терминале X» держим в памяти: после
// рестарта бэкенда оно перепроверяется живыми запросами к терминалам.
import type { FastifyBaseLogger } from "fastify";
import { env } from "./env.js";
import { supabaseAdmin } from "./supabase.js";
import { getStorage } from "./storage.js";
import { listStaffAccess } from "./hik-staff.js";
import { currentValidFor, invalidateGrants } from "./hik-access-windows.js";

const verified = new Map<string, Set<string>>(); // childId -> device serials

export const markEnrolled = (childId: string, devices: string[]) => {
  const set = verified.get(childId) ?? new Set<string>();
  for (const d of devices) set.add(d);
  verified.set(childId, set);
};

export const forgetChild = (childId: string) => verified.delete(childId);

const isupHeaders = {
  "Content-Type": "application/json",
  "X-Internal-Key": env.HIK_INGEST_SECRET ?? "",
};

const onlineDevices = async (): Promise<string[]> => {
  const res = await fetch(`${env.ISUP_API_URL}/healthz`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { devices_online?: Record<string, string> };
  return Object.keys(body.devices_online ?? {});
};

const readPhoto = async (key: string): Promise<Buffer | null> => {
  const storage = getStorage();
  if (!storage || !env.MINIO_BUCKET) return null;
  const stream = await storage.getObject(env.MINIO_BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
};

// Один проход синхронизации; ограничиваем число обращений к терминалам за цикл,
// чтобы не занимать CMS-канал надолго (каждый запрос ~1 с).
export const runFaceSync = async (log: FastifyBaseLogger, maxOps = 40) => {
  if (!env.HIK_INGEST_SECRET) return;
  let devices: string[];
  try {
    devices = await onlineDevices();
  } catch {
    return; // ISUP-сервис недоступен — попробуем в следующий цикл
  }
  if (devices.length === 0) return;

  const { data: kids, error } = await supabaseAdmin
    .from("children")
    .select("id, full_name, access_person_no, face_photo_path")
    .not("access_person_no", "is", null)
    .not("face_photo_path", "is", null)
    .is("deleted_at", null);
  if (error || !kids) return;

  // Люди для синхронизации: дети (ключ = id) и сотрудники (ключ = "staff:id")
  const people: { key: string; personNo: string; name: string; photoPath: string }[] = kids.map((k) => ({
    key: k.id, personNo: k.access_person_no!, name: k.full_name, photoPath: k.face_photo_path!,
  }));
  try {
    for (const s of await listStaffAccess()) {
      if (s.access.access_person_no && s.access.face_photo_path) {
        people.push({ key: `staff:${s.id}`, personNo: s.access.access_person_no, name: s.full_name, photoPath: s.access.face_photo_path });
      }
    }
  } catch (e) {
    log.warn({ err: e }, "hik_face_sync_staff_list_failed");
  }

  let ops = 0;
  for (const person of people) {
    const done = verified.get(person.key) ?? new Set<string>();
    for (const dev of devices) {
      if (done.has(dev) || ops >= maxOps) continue;
      ops++;
      try {
        const st = await fetch(`${env.ISUP_API_URL}/face-status`, {
          method: "POST", headers: isupHeaders,
          body: JSON.stringify({ device_id: dev, person_no: person.personNo }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!st.ok) continue; // терминал не ответил — не помечаем, повторим позже
        const { enrolled } = (await st.json()) as { enrolled: boolean };
        if (enrolled) { markEnrolled(person.key, [dev]); continue; }

        const photo = await readPhoto(person.photoPath);
        if (!photo) continue;
        ops++;
        // детям сразу выставляем окно по расписанию — иначе до тика
        // реконсайлера персона будет бессрочной (сотрудники — бессрочно)
        const isChild = !person.key.startsWith("staff:");
        const valid = isChild ? await currentValidFor(person.key) : null;
        const en = await fetch(`${env.ISUP_API_URL}/enroll`, {
          method: "POST", headers: isupHeaders,
          body: JSON.stringify({
            device_id: dev, person_no: person.personNo,
            name: person.name, photo_base64: photo.toString("base64"),
            ...(valid ? { valid_from: valid.begin, valid_until: valid.end } : {}),
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (en.ok) {
          markEnrolled(person.key, [dev]);
          if (isChild) await invalidateGrants(person.key).catch(() => {});
          log.info({ person: person.key, device: dev }, "hik_face_sync_enrolled");
        } else {
          log.warn({ person: person.key, device: dev, status: en.status }, "hik_face_sync_failed");
        }
      } catch (e) {
        log.warn({ err: e, person: person.key, device: dev }, "hik_face_sync_threw");
      }
    }
  }
};
