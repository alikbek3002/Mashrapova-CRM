// Синхронизация Kommo → ERP — ТЗ §13 (интеграция AmoCRM/Kommo) и §8.
//
// Односторонняя: Kommo владеет перепиской и этапом сделки, ERP — записью
// на пробную, оплатами и отчётами. Каждый прогон:
//   1. этапы воронок → kommo_statuses (новым — этап ERP по умолчанию);
//   2. события с прошлого прогона → kommo_events (без текста сообщений);
//   3. сделки, изменённые с прошлого прогона (включая «Неразобранное»),
//      и сделки контактов, изменённых с прошлого прогона → leads;
//   4. по событиям — первый контакт, запись на пробную, канал;
//   5. refresh_lead_sla(): SLA §8.3 срабатывает в пределах интервала
//      синхронизации, а не раз в час.
// Первый прогон (курсоров нет) забирает всю историю.
//
// Вебхуки Kommo не подписаны, теряются при таймауте 2 с и на тарифе ниже
// Advanced недоступны — поэтому основа синхронизации опрос по updated_at,
// а вебхук только запускает очередной прогон раньше срока.
import { env } from "./env.js";
import { supabaseAdmin } from "./supabase.js";
import { kommoGet, kommoGetAll } from "./kommo.js";
import {
  KOMMO_EVENT_TYPES, defaultStage, mainContactId, toEventRow, toLeadRow,
  type EventRow, type KommoContact, type KommoEvent, type KommoLead, type KommoPipeline, type LeadRow,
} from "./kommo-map.js";

type Log = { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };

export type KommoSyncResult = {
  full: boolean;
  statuses: number;
  events: number;
  leads: number;
  facts: number;
  deleted: number;
  duration_ms: number;
};

// Перекрытие курсоров: событие или правка, пришедшие в Kommo с задержкой,
// не должны проскочить между прогонами. Дубли отсекает первичный ключ.
const OVERLAP_SEC = 10 * 60;
// Сделка старше часа на момент первой загрузки — история: SLA по ней не
// поднимаем (см. kommo_upsert_leads).
const QUIET_AFTER_SEC = 60 * 60;
const HISTORY_DAYS = 365;
const WEEK_SEC = 7 * 86400;

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const unix = (iso: string | null | undefined) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null);

const resolveOrganization = async (): Promise<string> => {
  if (env.KOMMO_ORGANIZATION_ID) return env.KOMMO_ORGANIZATION_ID;
  const { data, error } = await supabaseAdmin.from("organizations").select("id").limit(2);
  if (error) throw error;
  const only = data?.length === 1 ? data[0] : undefined;
  if (!only) throw new Error("kommo_organization_ambiguous: задайте KOMMO_ORGANIZATION_ID");
  return only.id as string;
};

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

const syncStatuses = async (org: string, pipelines: KommoPipeline[]) => {
  const { data: existing, error } = await supabaseAdmin
    .from("kommo_statuses")
    .select("pipeline_id, status_id, stage")
    .eq("organization_id", org);
  fail("kommo_statuses_read", error);
  const known = new Map((existing ?? []).map((s) => [`${s.pipeline_id}:${s.status_id}`, s.stage as string]));
  const rows = pipelines.flatMap((p) =>
    p._embedded.statuses.map((s) => ({
      organization_id: org,
      pipeline_id: p.id,
      status_id: s.id,
      pipeline_name: p.name,
      status_name: s.name,
      sort: s.sort,
      is_unsorted: s.type === 1,
      // Поправленный вручную этап не перетираем.
      stage: known.get(`${p.id}:${s.id}`) ?? defaultStage(s.id, s.name, s.type),
      updated_at: new Date().toISOString(),
    })),
  );
  const { error: upErr } = await supabaseAdmin
    .from("kommo_statuses")
    .upsert(rows, { onConflict: "organization_id,pipeline_id,status_id" });
  fail("kommo_statuses_upsert", upErr);
  return rows.length;
};

const fetchEvents = async (fromTs: number, toTs: number): Promise<KommoEvent[]> => {
  const types = KOMMO_EVENT_TYPES.map((t) => `filter[type][]=${t}`).join("&");
  const out: KommoEvent[] = [];
  // Неделями: глубокая постраничная выдача событий у Kommo обрывается.
  for (let from = fromTs; from <= toTs; from += WEEK_SEC) {
    const to = Math.min(from + WEEK_SEC - 1, toTs);
    out.push(...(await kommoGetAll<KommoEvent>(
      `/api/v4/events?${types}&filter[created_at][from]=${from}&filter[created_at][to]=${to}`, "events", 100,
    )));
  }
  return out;
};

const fetchByIds = async <T,>(path: string, key: string, ids: number[], extra = ""): Promise<T[]> => {
  const out: T[] = [];
  for (const part of chunk(ids, 50)) {
    const q = part.map((id) => `filter[id][]=${id}`).join("&");
    out.push(...(await kommoGetAll<T>(`${path}?${q}${extra}`, key)));
  }
  return out;
};

/**
 * Чтение изменений из Kommo без записи в базу. leadsFrom/contactsFrom = null —
 * все сделки целиком (первая синхронизация).
 */
export const fetchKommoChanges = async (c: {
  nowTs: number;
  eventsFrom: number;
  leadsFrom: number | null;
  contactsFrom: number | null;
}): Promise<{ pipelines: KommoPipeline[]; events: EventRow[]; rows: LeadRow[] }> => {
  const pipelinesRes = await kommoGet<{ _embedded: { pipelines: KommoPipeline[] } }>("/api/v4/leads/pipelines");
  const pipelines = pipelinesRes?._embedded.pipelines ?? [];

  const events = (await fetchEvents(c.eventsFrom, c.nowTs + 60)).map(toEventRow);

  // Обычный список сделок «Неразобранное» не отдаёт — перечисляем все
  // этапы всех воронок явно.
  const statusFilter = pipelines
    .flatMap((p) => p._embedded.statuses.map((s) => [p.id, s.id] as const))
    .map(([p, s], i) => `filter[statuses][${i}][pipeline_id]=${p}&filter[statuses][${i}][status_id]=${s}`)
    .join("&");
  const leads = new Map<number, KommoLead>();
  for (const l of await kommoGetAll<KommoLead>(
    `/api/v4/leads?with=contacts,loss_reason&${statusFilter}${c.leadsFrom ? `&filter[updated_at][from]=${c.leadsFrom}` : ""}`,
    "leads",
  )) leads.set(l.id, l);

  // Поля ученика живут в контакте: правка контакта не меняет updated_at
  // сделки, поэтому догоняем сделки изменённых контактов.
  if (c.contactsFrom) {
    const changed = await kommoGetAll<{ id: number; _embedded?: { leads?: { id: number }[] } }>(
      `/api/v4/contacts?with=leads&filter[updated_at][from]=${c.contactsFrom}`, "contacts",
    );
    const missing = [...new Set(changed.flatMap((x) => (x._embedded?.leads ?? []).map((l) => l.id)))]
      .filter((id) => !leads.has(id));
    for (const l of await fetchByIds<KommoLead>("/api/v4/leads", "leads", missing, "&with=contacts,loss_reason")) {
      leads.set(l.id, l);
    }
  }

  const contactIds = [...new Set([...leads.values()].map(mainContactId).filter((x): x is number => x != null))];
  const contacts = new Map(
    (await fetchByIds<KommoContact>("/api/v4/contacts", "contacts", contactIds)).map((x) => [x.id, x]),
  );
  const lossRes = await kommoGet<{ _embedded: { loss_reasons: { id: number; name: string }[] } }>("/api/v4/leads/loss_reasons");
  const lossReasons = new Map((lossRes?._embedded.loss_reasons ?? []).map((r) => [r.id, r.name]));

  const rows = [...leads.values()].map((l) => {
    const cid = mainContactId(l);
    return toLeadRow(l, cid != null ? contacts.get(cid) : undefined, lossReasons);
  });
  return { pipelines, events, rows };
};

const doSync = async (opts: { full?: boolean; log?: Log }): Promise<KommoSyncResult> => {
  const started = Date.now();
  const nowTs = Math.floor(started / 1000);
  const org = await resolveOrganization();

  const { data: state, error: stateErr } = await supabaseAdmin
    .from("kommo_sync_state").select("*").eq("organization_id", org).maybeSingle();
  fail("kommo_sync_state_read", stateErr);
  const full = Boolean(opts.full) || !state?.leads_cursor;

  try {
    // Сначала всё читаем из Kommo, потом пишем: оборванное чтение не
    // оставит в базе половину прогона.
    const { pipelines, events, rows } = await fetchKommoChanges({
      nowTs,
      eventsFrom: full ? nowTs - HISTORY_DAYS * 86400 : (unix(state?.events_cursor) ?? nowTs) - OVERLAP_SEC,
      leadsFrom: full ? null : (unix(state?.leads_cursor) ?? nowTs) - OVERLAP_SEC,
      contactsFrom: full ? null : (unix(state?.contacts_cursor) ?? nowTs) - OVERLAP_SEC,
    });

    // 1. Этапы — до сделок: по ним kommo_upsert_leads выбирает этап ERP.
    const statuses = await syncStatuses(org, pipelines);

    // 2. События — до фактов.
    for (const part of chunk(events, 500)) {
      const { error } = await supabaseAdmin
        .from("kommo_events")
        .upsert(part.map((e) => ({ ...e, organization_id: org })), { onConflict: "organization_id,id", ignoreDuplicates: true });
      fail("kommo_events_upsert", error);
    }

    // 3. Сделки.
    const quietBefore = new Date((nowTs - QUIET_AFTER_SEC) * 1000).toISOString();
    let upserted = 0;
    for (const part of chunk(rows, 200)) {
      const { data, error } = await supabaseAdmin.rpc("kommo_upsert_leads", {
        p_org: org, p_rows: part, p_quiet_before: quietBefore,
      });
      fail("kommo_upsert_leads", error);
      upserted += Number(data ?? 0);
    }

    // 4. Удалённые в Kommo: у нас ничего не удаляется (forbid_delete) —
    // помечаем. Последнее событие по сделке решает: удалена или восстановлена.
    const lastDeletion = new Map<number, { type: string; at: string }>();
    for (const e of events) {
      if (e.entity_type !== "lead" || (e.type !== "lead_deleted" && e.type !== "lead_restored")) continue;
      const prev = lastDeletion.get(e.entity_id);
      if (!prev || prev.at < e.created_at) lastDeletion.set(e.entity_id, { type: e.type, at: e.created_at });
    }
    const deletedIds = [...lastDeletion].filter(([, v]) => v.type === "lead_deleted").map(([id]) => id);
    for (const part of chunk(deletedIds, 200)) {
      const { error } = await supabaseAdmin
        .from("leads").update({ kommo_deleted_at: new Date().toISOString() })
        .eq("organization_id", org).in("kommo_lead_id", part).is("kommo_deleted_at", null);
      fail("kommo_mark_deleted", error);
    }

    // 5. Факты по событиям — для всех сделок, которых коснулся прогон.
    const touched = [...new Set([
      ...rows.map((r) => r.kommo_lead_id),
      ...events.filter((e) => e.entity_type === "lead").map((e) => e.entity_id),
    ])];
    let facts = 0;
    for (const part of chunk(touched, 500)) {
      const { data, error } = await supabaseAdmin.rpc("kommo_refresh_lead_facts", { p_org: org, p_kommo_ids: part });
      fail("kommo_refresh_lead_facts", error);
      facts += Number(data ?? 0);
    }

    // 6. SLA §8.3 — сразу по свежим данным.
    const { error: slaErr } = await supabaseAdmin.rpc("refresh_lead_sla");
    if (slaErr) opts.log?.warn({ err: slaErr }, "kommo_lead_sla_failed");

    const result: KommoSyncResult = {
      full, statuses, events: events.length, leads: upserted, facts,
      deleted: deletedIds.length, duration_ms: Date.now() - started,
    };
    const cursor = new Date(started).toISOString();
    const { error: saveErr } = await supabaseAdmin.from("kommo_sync_state").upsert({
      organization_id: org,
      base_url: env.KOMMO_BASE_URL,
      leads_cursor: cursor,
      contacts_cursor: cursor,
      events_cursor: cursor,
      history_before: state?.history_before ?? quietBefore,
      last_run_at: cursor,
      last_ok_at: new Date().toISOString(),
      last_error: null,
      last_result: result,
      updated_at: new Date().toISOString(),
    });
    fail("kommo_sync_state_save", saveErr);
    if (result.leads > 0 || result.events > 0) opts.log?.info(result, "kommo_sync");
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Курсоры не двигаем: следующий прогон заберёт тот же интервал заново.
    await supabaseAdmin.from("kommo_sync_state").upsert({
      organization_id: org,
      base_url: env.KOMMO_BASE_URL,
      leads_cursor: state?.leads_cursor ?? null,
      contacts_cursor: state?.contacts_cursor ?? null,
      events_cursor: state?.events_cursor ?? null,
      history_before: state?.history_before ?? null,
      last_run_at: new Date(started).toISOString(),
      last_ok_at: state?.last_ok_at ?? null,
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    });
    throw e;
  }
};

// Один прогон за раз: планировщик, вебхук и кнопка «Синхронизировать»
// могут сработать одновременно. Пока идёт прогон, новые вызовы получают
// его результат.
let running: Promise<KommoSyncResult> | null = null;

export const syncKommo = (opts: { full?: boolean; log?: Log } = {}): Promise<KommoSyncResult> => {
  if (!running) {
    running = doSync(opts).finally(() => { running = null; });
  }
  return running;
};

// Вебхук Kommo шлёт пачки событий подряд — склеиваем их в один прогон.
let pending: NodeJS.Timeout | null = null;
export const scheduleKommoSync = (log?: Log, delayMs = 5_000) => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    syncKommo({ log }).catch((e) => log?.warn({ err: e }, "kommo_webhook_sync_failed"));
  }, delayMs);
};
