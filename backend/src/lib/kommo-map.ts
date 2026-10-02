// Разбор данных Kommo в строки ERP. Чистые функции без сети и базы —
// их же использует проверка на выгрузке реального аккаунта.

// ----------------------------------------------------------------------
// Ответы API (только то, что читаем)
// ----------------------------------------------------------------------
export type KommoCustomField = {
  field_id: number;
  field_name: string;
  field_code?: string | null;
  values: { value: string | number | boolean; enum_code?: string | null }[];
};

export type KommoLead = {
  id: number;
  price: number | null;
  responsible_user_id: number | null;
  status_id: number;
  pipeline_id: number;
  loss_reason_id: number | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  is_deleted?: boolean;
  _embedded?: {
    tags?: { id: number; name: string }[];
    contacts?: { id: number; is_main: boolean }[];
    loss_reason?: { id: number; name: string }[];
  };
};

export type KommoContact = {
  id: number;
  name: string | null;
  custom_fields_values: KommoCustomField[] | null;
};

export type KommoEvent = {
  id: string;
  type: string;
  entity_id: number;
  entity_type: string;
  created_by: number | null;
  created_at: number;
  value_after?: Record<string, unknown>[];
  value_before?: Record<string, unknown>[];
};

export type KommoPipeline = {
  id: number;
  name: string;
  _embedded: { statuses: { id: number; name: string; sort: number; type: number }[] };
};

export type LeadStage =
  | "new" | "contacted" | "trial_booked" | "trial_attended"
  | "no_show" | "converted" | "lost" | "waiting";

// ----------------------------------------------------------------------
// События, которые храним. Текст сообщений не берём — только факт,
// время, канал и беседу.
// ----------------------------------------------------------------------
export const KOMMO_EVENT_TYPES = [
  "lead_added", "lead_deleted", "lead_restored", "lead_status_changed",
  "incoming_chat_message", "outgoing_chat_message", "incoming_call", "outgoing_call",
  "entity_responsible_changed", "entity_tag_added", "entity_tag_deleted",
  "talk_created", "talk_closed", "entity_merged",
] as const;

// ----------------------------------------------------------------------
// Этапы по умолчанию
//
// Id этапов у каждого аккаунта свои. Для аккаунта Академии (managermmaosh,
// состояние на 2026-10-01) соответствие задано явно; «дожим» по словам
// офиса — «попробовать продать ещё раз», поэтому «дожим прийти на
// пробный» — это неявка, а «дожим на оплату» — после пробной. Новые этапы
// разбираются по названию. Поправить можно в kommo_statuses.stage —
// синхронизация его не перетирает.
// ----------------------------------------------------------------------
const KNOWN_STAGES: Record<number, LeadStage> = {
  // Pipeline (единоборства)
  109356271: "new",            // Неразобранное
  109356275: "new",            // входящие
  109356539: "contacted",      // взято в работу
  109356279: "contacted",      // дозвонились
  109356543: "contacted",      // переписка
  110081555: "contacted",      // дожим на пробный запись
  109356547: "trial_booked",   // Записались на пробный
  109357643: "trial_booked",   // напоминание отправили
  110081559: "no_show",        // дожим прийти на пробный
  109356551: "trial_attended", // Пришли на пробный
  109357647: "trial_attended", // Есть Возражения
  109356283: "trial_attended", // подтвердили
  110081563: "trial_attended", // дожим на оплату
  109356555: "trial_attended", // внесли предоплату
  // Фитнес
  112420539: "new",            // Неразобранное
  112420543: "new",            // Первичный контакт
  112420555: "contacted",      // дозвонились
  112420559: "contacted",      // переписка
  112420563: "trial_booked",   // записались на разовый
  112420567: "trial_booked",   // подтвердили
  112420571: "trial_attended", // предоплата
  112420547: "trial_attended", // Переговоры
  112420551: "trial_attended", // Принимают решение
};

export const defaultStage = (statusId: number, statusName: string, type: number): LeadStage => {
  if (statusId === 142) return "converted";
  if (statusId === 143) return "lost";
  if (type === 1) return "new";
  const known = KNOWN_STAGES[statusId];
  if (known) return known;
  const n = statusName.toLowerCase();
  if (/(входящ|первичн|новы)/.test(n)) return "new";
  if (/(не пришл|неявк|дожим прийти)/.test(n)) return "no_show";
  if (/дожим на пробн/.test(n)) return "contacted";
  if (/(пришл|возраж|предоплат|оплат|переговор|решени)/.test(n)) return "trial_attended";
  if (/(запис|напомин|подтверд|разов)/.test(n)) return "trial_booked";
  if (/(ожидан|лист ожид|думают|позже)/.test(n)) return "waiting";
  return "contacted";
};

// ----------------------------------------------------------------------
// Телефон: KG приводим к +996XXXXXXXXX, остальное — к +цифрам.
// ----------------------------------------------------------------------
export const normalizePhone = (raw: unknown): string | null => {
  if (raw == null) return null;
  const d = String(raw).replace(/\D/g, "");
  if (/^996\d{9}$/.test(d)) return `+${d}`;
  if (/^0\d{9}$/.test(d)) return `+996${d.slice(1)}`;
  if (/^\d{9}$/.test(d)) return `+996${d}`;
  if (d.length >= 10 && d.length <= 15) return `+${d}`;
  return null;
};

// Секции в Kommo — и тегами («ММА детский», «бокс»), и свободным текстом.
// Те же корни, что в kommo_resolve_section() — тег, который на них не
// похож, считаем тегом менеджера («Марлен», «Уулкан»).
const SECTION_RE = /(мма|mma|кик|kick|бокс|box|дзю|дэю|джу|judo|тхэк|таэк|таек|тхек|taekw|борь|вольн|греко|wrestl|фитнес|fitness|зал|gym|детск|взросл)/i;
export const isSectionTag = (name: string) => SECTION_RE.test(name);

const cfValue = (c: KommoContact | undefined, name: string): string | null => {
  const f = c?.custom_fields_values?.find((x) => x.field_name.trim().toLowerCase() === name);
  const v = f?.values?.[0]?.value;
  return v == null || String(v).trim() === "" ? null : String(v).trim();
};

const cfPhone = (c: KommoContact | undefined): string | null => {
  const f = c?.custom_fields_values?.find((x) => x.field_code === "PHONE");
  for (const v of f?.values ?? []) {
    const p = normalizePhone(v.value);
    if (p) return p;
  }
  return null;
};

const iso = (ts: number | null | undefined) => (ts ? new Date(ts * 1000).toISOString() : null);

export type LeadRow = {
  kommo_lead_id: number;
  kommo_contact_id: number | null;
  pipeline_id: number;
  status_id: number;
  parent_name: string | null;
  phone: string | null;
  child_name: string | null;
  child_age: number | null;
  section_text: string | null;
  coach_name: string | null;
  manager_tag: string | null;
  responsible_user_id: number | null;
  price: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  loss_reason: string | null;
  is_deleted: boolean;
};

export const mainContactId = (lead: KommoLead): number | null => {
  const cs = lead._embedded?.contacts ?? [];
  return (cs.find((c) => c.is_main) ?? cs[0])?.id ?? null;
};

export const toLeadRow = (
  lead: KommoLead,
  contact: KommoContact | undefined,
  lossReasons: Map<number, string>,
): LeadRow => {
  const tags = (lead._embedded?.tags ?? []).map((t) => t.name.trim()).filter(Boolean);
  const age = Number.parseInt(cfValue(contact, "возраст ученика") ?? "", 10);
  return {
    kommo_lead_id: lead.id,
    kommo_contact_id: contact?.id ?? mainContactId(lead),
    pipeline_id: lead.pipeline_id,
    status_id: lead.status_id,
    parent_name: contact?.name?.trim() || null,
    phone: cfPhone(contact),
    child_name: cfValue(contact, "имя ученика"),
    child_age: Number.isFinite(age) && age > 0 && age < 100 ? age : null,
    section_text: cfValue(contact, "секция") ?? tags.find(isSectionTag) ?? null,
    coach_name: cfValue(contact, "имя тренера"),
    manager_tag: tags.find((t) => !isSectionTag(t)) ?? null,
    responsible_user_id: lead.responsible_user_id ?? null,
    price: lead.price ?? null,
    created_at: iso(lead.created_at)!,
    updated_at: iso(lead.updated_at)!,
    closed_at: iso(lead.closed_at),
    loss_reason:
      lead._embedded?.loss_reason?.[0]?.name ??
      (lead.loss_reason_id ? lossReasons.get(lead.loss_reason_id) ?? null : null),
    is_deleted: Boolean(lead.is_deleted),
  };
};

export type EventRow = {
  id: string;
  type: string;
  entity_type: string;
  entity_id: number;
  created_at: string;
  created_by: number | null;
  talk_id: number | null;
  origin: string | null;
  status_before: number | null;
  status_after: number | null;
  pipeline_after: number | null;
  tag: string | null;
};

type Msg = { message?: { talk_id?: number; origin?: string } };
type Status = { lead_status?: { id?: number; pipeline_id?: number } };
type Tag = { tag?: { name?: string } };

export const toEventRow = (e: KommoEvent): EventRow => {
  const after = e.value_after?.[0] as (Msg & Status & Tag) | undefined;
  const before = e.value_before?.[0] as Status | undefined;
  return {
    id: e.id,
    type: e.type,
    entity_type: e.entity_type,
    entity_id: e.entity_id,
    created_at: iso(e.created_at)!,
    created_by: e.created_by ?? null,
    talk_id: after?.message?.talk_id ?? null,
    origin: after?.message?.origin ?? null,
    status_before: before?.lead_status?.id ?? null,
    status_after: after?.lead_status?.id ?? null,
    pipeline_after: after?.lead_status?.pipeline_id ?? null,
    tag: after?.tag?.name ?? null,
  };
};
