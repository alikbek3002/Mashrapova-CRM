// Присутствие в здании и авто-выход.
//
// «Внутри» = последнее событие ребёнка среди проходов (face_ok/card_ok/auto_out
// с направлением in/out) — вход. Дети часто уходят через другую дверь, и
// выхода в журнале нет; чтобы «в здании» не копилось, через N часов после
// конца занятия (org_settings.access_auto_exit_hours) вставляем синтетический
// выход auto_out от устройства "system". Это только журнал: посещаемость и
// ПТ entry/exit не трогаем.
import type { FastifyBaseLogger } from "fastify";
import { supabaseAdmin } from "./supabase.js";
import { orgDateOf } from "./hik-pt.js";
import { loadAccessSettings, loadAccessWindows, type AccessWindowRow } from "./hik-access-windows.js";

export type InsideRow = { child_id: string; full_name: string; entered_at: string; device_serial: string };

const LOOKBACK_MS = 48 * 3_600_000;

/** Кто сейчас в здании: последний проход ребёнка — вход. */
export const listInside = async (nowMs = Date.now()): Promise<InsideRow[]> => {
  const { data, error } = await supabaseAdmin
    .from("access_events")
    .select("child_id, direction, occurred_at, device_serial, children(full_name)")
    .not("child_id", "is", null)
    .in("event_type", ["face_ok", "card_ok", "auto_out"])
    .in("direction", ["in", "out"])
    .gte("occurred_at", new Date(nowMs - LOOKBACK_MS).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`access_events: ${error.message}`);
  const seen = new Set<string>();
  const inside: InsideRow[] = [];
  for (const e of data ?? []) {
    const cid = e.child_id as string;
    if (seen.has(cid)) continue;
    seen.add(cid);
    if (e.direction === "in") {
      inside.push({
        child_id: cid,
        full_name: (e as unknown as { children?: { full_name: string } | null }).children?.full_name ?? "",
        entered_at: e.occurred_at,
        device_serial: e.device_serial,
      });
    }
  }
  return inside.sort((a, b) => a.entered_at.localeCompare(b.entered_at));
};

/**
 * Момент авто-выхода: конец самого позднего занятия того дня, которое ещё
 * не закончилось на момент входа, + N часов. Занятий нет — вход + N + 1 ч.
 */
export const autoExitAt = (enteredMs: number, windows: AccessWindowRow[], hours: number): number => {
  let latestEnd = -Infinity;
  for (const w of windows) {
    const end = Date.parse(w.ends_at);
    if (!Number.isNaN(end) && end >= enteredMs) latestEnd = Math.max(latestEnd, end);
  }
  const base = Number.isFinite(latestEnd) ? latestEnd : enteredMs + 3_600_000;
  return base + hours * 3_600_000;
};

let cachedOrgId: string | null = null;
const getOrgId = async (): Promise<string> => {
  if (cachedOrgId) return cachedOrgId;
  const { data } = await supabaseAdmin.from("organizations").select("id").limit(1).single();
  if (!data) throw new Error("no_organization");
  cachedOrgId = data.id;
  return cachedOrgId!;
};

/** Один тик: детям «внутри» с просроченным авто-выходом ставим auto_out. */
export const runAutoExit = async (log: FastifyBaseLogger, nowMs = Date.now()) => {
  const settings = await loadAccessSettings();
  const inside = await listInside(nowMs);
  if (inside.length === 0) return;
  const orgId = await getOrgId();
  const windowsByDate = new Map<string, AccessWindowRow[]>();
  let closed = 0;
  for (const p of inside) {
    const enteredMs = Date.parse(p.entered_at);
    if (Number.isNaN(enteredMs)) continue;
    const date = orgDateOf(enteredMs);
    let rows = windowsByDate.get(date);
    if (!rows) {
      rows = await loadAccessWindows(date).catch(() => [] as AccessWindowRow[]);
      windowsByDate.set(date, rows);
    }
    const mine = rows.filter((r) => r.child_id === p.child_id);
    const dueMs = autoExitAt(enteredMs, mine, settings.autoExitHours);
    if (dueMs > nowMs) continue;
    const { error } = await supabaseAdmin.from("access_events").insert({
      organization_id: orgId,
      child_id: p.child_id,
      person_no: null,
      device_serial: "system",
      event_serial: dueMs,
      event_type: "auto_out",
      direction: "out",
      occurred_at: new Date(dueMs).toISOString(),
      raw: { reason: "auto_exit", entered_at: p.entered_at, lessons: mine.map((m) => m.ref_id) },
    });
    if (error && error.code !== "23505") {
      log.warn({ err: error, child: p.child_id }, "hik_auto_exit_insert_failed");
    } else if (!error) {
      closed++;
      log.info({ child: p.child_id, entered_at: p.entered_at, at: new Date(dueMs).toISOString() }, "hik_auto_exit");
    }
  }
  if (closed) log.info({ closed, inside: inside.length }, "hik_auto_exit_tick");
};
