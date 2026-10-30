-- =====================================================================
-- Лиды от ИИ-агента Nextbot в Instagram (2026-10-30)
-- =====================================================================
-- Агент консультирует клиента в Direct и через POST /v1/bot/lead
-- (backend/src/routes/v1/bot.ts, lib/kommo-bot.ts) сообщает, что узнал:
-- секцию, возраст, телефон, горячесть, желание прийти на пробное или
-- позвать менеджера. Бэкенд пишет это в сделку Kommo (поля, теги, заметка,
-- задача) и сюда, в leads.
--
-- Горячесть — оценка агента, а не этап: лид может быть горячим на любом
-- этапе. Менеджер видит её на карточке в воронке и тегом в Kommo.
-- =====================================================================

alter table leads
  add column if not exists temperature         text,
  add column if not exists temperature_reason  text,
  add column if not exists instagram_user_id   text,
  add column if not exists bot_trial_wish      text,
  add column if not exists bot_handoff_at      timestamptz,
  add column if not exists bot_handoff_reason  text,
  add column if not exists bot_updated_at      timestamptz;

alter table leads drop constraint if exists leads_temperature_valid;
alter table leads add constraint leads_temperature_valid
  check (temperature is null or temperature in ('hot', 'warm', 'cold'));

create index if not exists leads_instagram_user_idx
  on leads (organization_id, instagram_user_id) where instagram_user_id is not null;

comment on column leads.temperature is 'Горячесть по оценке ИИ-агента: hot — хочет прийти, warm — интересуется, cold — просто спросил.';
comment on column leads.temperature_reason is 'Почему агент так оценил лида, его словами.';
comment on column leads.instagram_user_id is 'Id клиента в Instagram (из Nextbot). По нему склеиваются обращения одного человека.';
comment on column leads.bot_trial_wish is 'Пожелание клиента по пробному (день, время, группа), которое собрал агент. Записывает менеджер.';
comment on column leads.bot_handoff_at is 'Когда агент передал диалог менеджеру.';
comment on column leads.bot_handoff_reason is 'Зачем агент позвал менеджера.';
comment on column leads.bot_updated_at is 'Последнее обновление лида агентом.';

-- ---------------------------------------------------------------------
-- Факты Kommo: «вручную» не перетирает известный канал
-- ---------------------------------------------------------------------
create or replace function kommo_refresh_lead_facts(p_org uuid, p_kommo_ids bigint[])
returns int
language plpgsql
security definer
set search_path = public
as $kommo_refresh_lead_facts$
declare
  v_n int;
begin
  with ev as (
    select e.entity_id,
           min(e.created_at) filter (where e.type = 'incoming_chat_message') as first_in,
           (array_agg(e.origin order by e.created_at)
              filter (where e.type = 'incoming_chat_message'))[1]           as origin,
           bool_or(e.type = 'lead_added' and coalesce(e.created_by, 0) <> 0) as manual
      from kommo_events e
     where e.organization_id = p_org
       and e.entity_type = 'lead'
       and e.entity_id = any (p_kommo_ids)
     group by e.entity_id
  ), reply as (
    select ev.entity_id, min(o.created_at) as first_reply
      from ev
      join kommo_events o
        on o.organization_id = p_org
       and o.entity_type = 'lead'
       and o.entity_id = ev.entity_id
       and o.type in ('outgoing_chat_message', 'outgoing_call')
       and (ev.first_in is null or o.created_at > ev.first_in + interval '5 seconds')
     group by ev.entity_id
  ), moves as (
    select e.entity_id,
           min(e.created_at) filter (where s.stage <> 'new')          as first_move,
           min(e.created_at) filter (where s.stage = 'trial_booked')  as first_booked
      from kommo_events e
      join kommo_statuses s
        on s.organization_id = p_org
       and s.pipeline_id = e.pipeline_after
       and s.status_id = e.status_after
     where e.organization_id = p_org
       and e.type = 'lead_status_changed'
       and e.entity_id = any (p_kommo_ids)
     group by e.entity_id
  ), facts as (
    select ev.entity_id,
           least(r.first_reply, m.first_move) as first_contact,
           m.first_booked,
           case
             when ev.origin = 'waba' or ev.origin like 'whatsapp%' then 'whatsapp'
             when ev.origin like 'instagram%'                       then 'instagram'
             when ev.origin is not null                             then 'other'
             when ev.manual                                         then 'manual'
           end as channel
      from ev
      left join reply r on r.entity_id = ev.entity_id
      left join moves m on m.entity_id = ev.entity_id
  ), updated as (
    update leads l set
      first_contact_at = case when f.first_contact is null then l.first_contact_at
                              else greatest(f.first_contact, l.created_at) end,
      trial_booked_at  = coalesce(f.first_booked, l.trial_booked_at),
      -- «Вручную» значит лишь, что сделку создали через API или руками.
      -- Сделки ИИ-агента Nextbot создаёт бэкенд, и канал у них уже стоит
      -- (instagram) — его не перетираем.
      channel          = case when f.channel = 'manual' and l.channel is not null then l.channel
                              else coalesce(f.channel, l.channel) end
      from facts f
     where l.organization_id = p_org
       and l.kommo_lead_id = f.entity_id
    returning 1
  )
  select count(*) into v_n from updated;
  return v_n;
end;
$kommo_refresh_lead_facts$;

notify pgrst, 'reload schema';
