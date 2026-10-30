// Мост ИИ-агента Nextbot → Kommo и leads (docs/Nextbot_агент.md).
//
// Агент сидит в Instagram Direct и вызывает POST /v1/bot/lead, когда узнал
// что-то о клиенте. Платная интеграция Nextbot с Kommo не нужна: сделку
// находим и правим сами, токеном приватной интеграции.
//
// Kommo — место, где работают менеджеры, поэтому туда пишется всё:
// поля контакта (секция, имя и возраст ученика, телефон), теги горячести,
// заметка с тем, что сказал клиент, и задача на 10 минут, когда клиент
// хочет на пробное или просит человека. В leads — то же, плюс горячесть
// для воронки ERP. Остальное подтянет обычная синхронизация Kommo → ERP.
import { supabaseAdmin } from "./supabase.js";
import { kommoConfigured, kommoGet, kommoSend } from "./kommo.js";
import { BOT_TAGS, normalizePhone, type KommoContact, type KommoCustomField, type KommoLead } from "./kommo-map.js";

export type Temperature = "hot" | "warm" | "cold";

export type BotLeadInput = {
  event: "info" | "temperature" | "trial" | "handoff";
  test: boolean;
  instagram_username?: string;
  instagram_user_id?: string;
  profile_link?: string;
  dialog_link?: string;
  client_name?: string;
  phone?: string;
  student_name?: string;
  student_age?: number;
  section?: string;
  temperature?: Temperature;
  reason?: string;
  preferred_time?: string;
};

type Log = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };

// Закрытые этапы Kommo: «Успешно реализовано» и «Закрыто и не реализовано».
const CLOSED = new Set([142, 143]);
// Повторный вызов той же функции агентом не должен плодить заметки и задачи.
const HANDOFF_REPEAT_MS = 30 * 60_000;
const TASK_MINUTES = 10;

const TEMPERATURE_TAG: Record<Temperature, string> = { hot: BOT_TAGS.hot, warm: BOT_TAGS.warm, cold: BOT_TAGS.cold };
const TEMPERATURE_RU: Record<Temperature, string> = { hot: "горячий", warm: "тёплый", cold: "холодный" };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/^@/, "").replace(/ё/g, "е");

// Ник из ссылки на профиль: instagram.com/<ник>/ — надёжнее имени, которое
// клиент мог поставить в профиле.
const usernameFromLink = (link?: string) => {
  const m = link?.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i);
  return m?.[1] && !["p", "reel", "stories", "direct"].includes(m[1].toLowerCase()) ? m[1] : undefined;
};

// ----------------------------------------------------------------------
// Поля контакта Kommo: id по названию. Названия те же, что читает
// синхронизация (kommo-map.ts), id у аккаунта свои — кэшируем на час.
// ----------------------------------------------------------------------
type FieldDef = { id: number; type: string; name: string };
let fieldsCache: { at: number; byName: Map<string, FieldDef> } | null = null;

const contactFields = async () => {
  if (fieldsCache && Date.now() - fieldsCache.at < 60 * 60_000) return fieldsCache.byName;
  const data = await kommoGet<{ _embedded?: { custom_fields?: FieldDef[] } }>("/api/v4/contacts/custom_fields?limit=250");
  const byName = new Map((data?._embedded?.custom_fields ?? []).map((f) => [norm(f.name), f]));
  fieldsCache = { at: Date.now(), byName };
  return byName;
};

// ----------------------------------------------------------------------
// Поиск сделки клиента
//
// Контакт из Instagram Kommo называет ником или именем профиля, телефона
// у него сначала нет. Ищем по нику, по имени из Nextbot и по телефону и
// берём самую свежую открытую сделку найденного контакта.
// ----------------------------------------------------------------------
type ContactWithLeads = KommoContact & { updated_at?: number; _embedded?: { leads?: { id: number }[] } };

const searchContacts = async (query: string) => {
  const data = await kommoGet<{ _embedded?: { contacts?: ContactWithLeads[] } }>(
    `/api/v4/contacts?with=leads&limit=50&query=${encodeURIComponent(query)}`,
  );
  return data?._embedded?.contacts ?? [];
};

const phoneDigits = (c: KommoContact) =>
  (c.custom_fields_values ?? [])
    .filter((f) => f.field_code === "PHONE")
    .flatMap((f) => f.values.map((v) => normalizePhone(v.value)))
    .filter((p): p is string => p != null);

type Found = { contact: ContactWithLeads | null; lead: KommoLead | null };

const findInKommo = async (input: BotLeadInput, phone: string | null): Promise<Found> => {
  const names = [...new Set([usernameFromLink(input.profile_link), input.instagram_username].map(norm).filter(Boolean))];
  const candidates = new Map<number, ContactWithLeads>();

  for (const name of names) {
    for (const c of await searchContacts(name)) if (norm(c.name) === name) candidates.set(c.id, c);
  }
  if (phone) {
    // Поиск Kommo ищет подстроку — последние 9 цифр совпадают при любой записи номера.
    for (const c of await searchContacts(phone.slice(-9))) if (phoneDigits(c).includes(phone)) candidates.set(c.id, c);
  }
  if (!candidates.size) return { contact: null, lead: null };

  const contacts = [...candidates.values()].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
  const leadIds = contacts.flatMap((c) => (c._embedded?.leads ?? []).map((l) => l.id));
  let open: KommoLead[] = [];
  if (leadIds.length) {
    const qs = leadIds.slice(0, 50).map((id, i) => `filter[id][${i}]=${id}`).join("&");
    const data = await kommoGet<{ _embedded?: { leads?: KommoLead[] } }>(`/api/v4/leads?with=contacts&limit=50&${qs}`);
    open = (data?._embedded?.leads ?? [])
      .filter((l) => !CLOSED.has(l.status_id) && !l.is_deleted)
      .sort((a, b) => b.created_at - a.created_at);
  }
  const lead = open[0] ?? null;
  const contact = (lead && contacts.find((c) => c._embedded?.leads?.some((l) => l.id === lead.id))) ?? contacts[0] ?? null;
  return { contact, lead };
};

// Воронка для новой сделки: фитнес — в «Фитнес», остальное — в основную.
const pipelineFor = async (section?: string) => {
  const data = await kommoGet<{ _embedded?: { pipelines?: { id: number; name: string; is_main: boolean }[] } }>(
    "/api/v4/leads/pipelines",
  );
  const pipes = data?._embedded?.pipelines ?? [];
  const fitness = /фитнес|fitness|тренаж|зал/i.test(section ?? "") ? pipes.find((p) => /фитнес|fitness/i.test(p.name)) : undefined;
  return (fitness ?? pipes.find((p) => p.is_main))?.id;
};

// ----------------------------------------------------------------------
// Запись в Kommo
// ----------------------------------------------------------------------
const contactPatch = async (contact: KommoContact | null, input: BotLeadInput, phone: string | null) => {
  const fields = await contactFields();
  const out: { field_id: number; values: { value: string | number; enum_code?: string }[] }[] = [];
  const own = (name: string) => contact?.custom_fields_values?.find((f) => norm(f.field_name) === name);
  const set = (name: string, value: string | number | undefined) => {
    const def = fields.get(name);
    if (!def || value == null || value === "") return;
    if (def.type === "numeric" && typeof value !== "number") return;
    const current = own(name)?.values?.[0]?.value;
    if (current != null && String(current) === String(value)) return;
    out.push({ field_id: def.id, values: [{ value }] });
  };
  set("имя ученика", input.student_name);
  set("возраст ученика", input.student_age);
  set("секция", input.section);

  // Телефоны в Kommo — один список: PATCH заменяет его целиком, поэтому
  // добавляем номер к уже записанным.
  const phoneField = fields.get("phone");
  if (phone && phoneField) {
    const existing: KommoCustomField | undefined = contact?.custom_fields_values?.find((f) => f.field_code === "PHONE");
    const values = (existing?.values ?? []).map((v) => ({ value: String(v.value), enum_code: v.enum_code ?? "WORK" }));
    if (!values.some((v) => normalizePhone(v.value) === phone)) {
      out.push({ field_id: phoneField.id, values: [...values, { value: phone, enum_code: "MOB" }] });
    }
  }
  return out;
};

const note = (leadId: number, text: string) =>
  kommoSend("POST", `/api/v4/leads/${leadId}/notes`, [{ note_type: "common", params: { text } }]);

const task = (lead: KommoLead, text: string) =>
  kommoSend("POST", "/api/v4/tasks", [{
    text,
    entity_id: lead.id,
    entity_type: "leads",
    complete_till: Math.floor(Date.now() / 1000) + TASK_MINUTES * 60,
    ...(lead.responsible_user_id ? { responsible_user_id: lead.responsible_user_id } : {}),
  }]);

const summary = (input: BotLeadInput, phone: string | null) =>
  [
    input.section && `секция: ${input.section}`,
    (input.student_name || input.student_age) &&
      `ученик: ${[input.student_name, input.student_age && `${input.student_age} лет`].filter(Boolean).join(", ")}`,
    input.client_name && `клиент: ${input.client_name}`,
    phone && `тел.: ${phone}`,
    input.instagram_username && `Instagram: ${input.instagram_username}`,
    input.dialog_link && `диалог: ${input.dialog_link}`,
  ].filter(Boolean).join("\n");

// ----------------------------------------------------------------------
// leads в ERP
// ----------------------------------------------------------------------
type ErpLead = {
  id: string;
  kommo_lead_id: number | null;
  parent_name: string | null;
  phone: string | null;
  child_name: string | null;
  child_age: number | null;
  section_interest_id: string | null;
  channel: string | null;
  first_contact_at: string | null;
  instagram: string | null;
  temperature: Temperature | null;
  bot_trial_wish: string | null;
  bot_handoff_at: string | null;
};
const ERP_COLUMNS =
  "id, kommo_lead_id, parent_name, phone, child_name, child_age, section_interest_id, channel, first_contact_at, instagram, temperature, bot_trial_wish, bot_handoff_at";

const findErpLead = async (org: string, kommoLeadId: number | null, igUserId?: string): Promise<ErpLead | null> => {
  if (kommoLeadId) {
    const { data } = await supabaseAdmin.from("leads").select(ERP_COLUMNS)
      .eq("organization_id", org).eq("kommo_lead_id", kommoLeadId).maybeSingle();
    if (data) return data as ErpLead;
  }
  if (igUserId) {
    // Только незакрытый лид: вернувшийся через полгода клиент — новый лид.
    const { data } = await supabaseAdmin.from("leads").select(ERP_COLUMNS)
      .eq("organization_id", org).eq("instagram_user_id", igUserId)
      .not("stage", "in", "(converted,lost)")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data && (!kommoLeadId || (data as ErpLead).kommo_lead_id == null || (data as ErpLead).kommo_lead_id === kommoLeadId)) {
      return data as ErpLead;
    }
  }
  return null;
};

const resolveSection = async (org: string, section?: string) => {
  if (!section) return null;
  const { data } = await supabaseAdmin.rpc("kommo_resolve_section", {
    p_org: org, p_text: section, p_fitness: /фитнес|fitness|тренаж|зал/i.test(section),
  });
  return (data as string | null) ?? null;
};

// ----------------------------------------------------------------------
// Обработка вызова агента
// ----------------------------------------------------------------------
export type BotLeadResult = {
  ok: true;
  test: boolean;
  kommo: { lead_id: number | null; created: boolean; skipped?: string; error?: string };
  erp: { lead_id: string | null; created: boolean; error?: string };
};

export const handleBotLead = async (org: string, input: BotLeadInput, log: Log): Promise<BotLeadResult> => {
  const phone = normalizePhone(input.phone);
  // Пробное и вызов менеджера — уже горячий клиент, даже если агент не оценил.
  const temperature: Temperature | undefined =
    input.temperature ?? (input.event === "trial" || input.event === "handoff" ? "hot" : undefined);
  const result: BotLeadResult = {
    ok: true, test: input.test,
    kommo: { lead_id: null, created: false },
    erp: { lead_id: null, created: false },
  };

  // 1. Сделка в Kommo — найти; при записи — создать, если её нет.
  let found: Found = { contact: null, lead: null };
  if (kommoConfigured) {
    try {
      found = await findInKommo(input, phone);
    } catch (e) {
      result.kommo.error = e instanceof Error ? e.message : String(e);
      log.warn({ err: e }, "bot_lead_kommo_find_failed");
    }
  } else {
    result.kommo.skipped = "kommo_not_configured";
  }
  result.kommo.lead_id = found.lead?.id ?? null;

  const erp = await findErpLead(org, found.lead?.id ?? null, input.instagram_user_id);
  result.erp.lead_id = erp?.id ?? null;

  const repeatTrial = input.event === "trial" && erp?.bot_trial_wish != null && norm(erp.bot_trial_wish) === norm(input.preferred_time);
  const repeatHandoff = input.event === "handoff" && erp?.bot_handoff_at != null
    && Date.now() - new Date(erp.bot_handoff_at).getTime() < HANDOFF_REPEAT_MS;

  if (input.test) {
    // Тестовый чат Nextbot: только показываем, что сделали бы.
    result.kommo.created = kommoConfigured && !found.lead && !result.kommo.error;
    result.erp.created = !erp;
    return result;
  }

  if (kommoConfigured && !result.kommo.error) {
    try {
      let lead = found.lead;
      const contactName = input.instagram_username || input.client_name || phone || "Instagram";
      if (!lead) {
        const pipeline_id = await pipelineFor(input.section);
        const contact = found.contact ? { id: found.contact.id } : { name: contactName };
        const created = await kommoSend<{ id: number }[]>("POST", "/api/v4/leads/complex", [{
          name: `Instagram: ${contactName}`,
          ...(pipeline_id ? { pipeline_id } : {}),
          _embedded: { tags: [{ name: BOT_TAGS.bot }], contacts: [contact] },
        }]);
        const id = created?.[0]?.id;
        if (!id) throw new Error("kommo_lead_not_created");
        lead = await kommoGet<KommoLead>(`/api/v4/leads/${id}?with=contacts`);
        result.kommo.created = true;
        found = { contact: found.contact, lead };
      }
      if (!lead) throw new Error("kommo_lead_missing");
      result.kommo.lead_id = lead.id;

      const contactId = found.contact?.id ?? lead._embedded?.contacts?.find((c) => c.is_main)?.id ?? lead._embedded?.contacts?.[0]?.id;
      if (contactId) {
        const contact = found.contact ?? (await kommoGet<KommoContact>(`/api/v4/contacts/${contactId}`));
        const patch = await contactPatch(contact, input, phone);
        if (patch.length) await kommoSend("PATCH", `/api/v4/contacts/${contactId}`, { custom_fields_values: patch });
      }

      // Теги: PATCH заменяет список целиком — собираем новый из текущего.
      const current = (lead._embedded?.tags ?? []).map((t) => t.name);
      const drop = new Set<string>(temperature ? Object.values(TEMPERATURE_TAG).map(norm) : []);
      const add = [
        BOT_TAGS.bot,
        temperature && TEMPERATURE_TAG[temperature],
        input.event === "trial" && BOT_TAGS.trial,
        input.event === "handoff" && BOT_TAGS.handoff,
      ].filter((t): t is string => Boolean(t));
      const tags = [...new Set([...current.filter((t) => !drop.has(norm(t))), ...add])];
      if (tags.map(norm).sort().join("|") !== current.map(norm).sort().join("|")) {
        await kommoSend("PATCH", `/api/v4/leads/${lead.id}`, { _embedded: { tags: tags.map((name) => ({ name })) } });
      }

      const about = summary(input, phone);
      if (input.event === "temperature" && temperature && temperature !== erp?.temperature) {
        await note(lead.id, `Бот: лид ${TEMPERATURE_RU[temperature]}${input.reason ? ` — ${input.reason}` : ""}${about ? `\n${about}` : ""}`);
      }
      if (input.event === "trial" && !repeatTrial) {
        await note(lead.id, `Бот: хочет на пробное — ${input.preferred_time ?? "время не назвал"}${about ? `\n${about}` : ""}`);
        await task(lead, `Подтвердить пробное (бот, Instagram): ${input.preferred_time ?? "уточнить время"}`);
      }
      if (input.event === "handoff" && !repeatHandoff) {
        await note(lead.id, `Бот: нужен менеджер — ${input.reason ?? "без причины"}${about ? `\n${about}` : ""}`);
        await task(lead, `Ответить клиенту в Instagram (бот передал): ${input.reason ?? ""}`.trim());
      }
    } catch (e) {
      result.kommo.error = e instanceof Error ? e.message : String(e);
      log.warn({ err: e }, "bot_lead_kommo_write_failed");
    }
  }

  // 2. leads в ERP. Заполняем пустое и не перетираем то, что внёс менеджер.
  try {
    const now = new Date().toISOString();
    const kommoLeadId = result.kommo.lead_id;
    const section_interest_id = erp?.section_interest_id ?? (await resolveSection(org, input.section));
    const row = {
      instagram: erp?.instagram ?? input.instagram_username ?? null,
      instagram_user_id: input.instagram_user_id ?? null,
      parent_name: erp?.parent_name ?? input.client_name ?? input.instagram_username ?? null,
      phone: erp?.phone ?? phone,
      child_name: erp?.child_name ?? input.student_name ?? null,
      child_age: erp?.child_age ?? input.student_age ?? null,
      section_interest_id,
      channel: erp?.channel ?? "instagram",
      // Агент ответил клиенту сразу — первый контакт состоялся, SLA §8.3
      // не должен звать менеджера к уже отвеченному лиду.
      first_contact_at: erp?.first_contact_at ?? now,
      bot_updated_at: now,
      ...(temperature ? { temperature } : {}),
      ...(input.event === "temperature" && input.reason ? { temperature_reason: input.reason } : {}),
      ...(input.event === "trial" ? { bot_trial_wish: input.preferred_time ?? erp?.bot_trial_wish ?? null } : {}),
      ...(input.event === "handoff" && !repeatHandoff ? { bot_handoff_at: now, bot_handoff_reason: input.reason ?? null } : {}),
    };
    if (erp) {
      const { error } = await supabaseAdmin.from("leads")
        .update({ ...row, ...(erp.kommo_lead_id == null && kommoLeadId ? { kommo_lead_id: kommoLeadId } : {}) })
        .eq("id", erp.id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabaseAdmin.from("leads").insert({
        organization_id: org,
        kommo_lead_id: kommoLeadId,
        kommo_contact_id: found.contact?.id ?? null,
        stage: "new",
        source: "instagram",
        ...row,
      }).select("id").single();
      if (error) throw new Error(error.message);
      result.erp.lead_id = data.id as string;
      result.erp.created = true;
    }
  } catch (e) {
    result.erp.error = e instanceof Error ? e.message : String(e);
    log.warn({ err: e }, "bot_lead_erp_write_failed");
  }

  log.info({ event: input.event, kommo: result.kommo, erp: result.erp }, "bot_lead");
  return result;
};
