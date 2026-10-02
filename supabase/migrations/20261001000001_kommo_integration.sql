-- =====================================================================
-- Интеграция с Kommo CRM (ТЗ §13 «AmoCRM v2.0»; Kommo — международная
-- версия amoCRM, API v4 тот же).
--
-- Кто чем владеет:
--   Kommo — переписка (WhatsApp, Instagram), карточка лида, этап воронки,
--           ответственный, отказ. Менеджеры работают там.
--   ERP   — запись на пробную (группа, тренер, время), посещения, оплаты,
--           клиенты. И отчёты: KPI §7.4 и воронка §8 считаются по leads.
--
-- Поэтому синхронизация односторонняя Kommo → ERP: бэкенд раз в несколько
-- минут забирает изменённые сделки и события и раскладывает их сюда.
-- Поля, которыми владеет ERP (trial_at, trial_group_id, trial_coach_id,
-- converted_child_id, отметки SLA), синхронизация не трогает.
--
-- Что пишется:
--   kommo_statuses   — этапы воронок Kommo и их соответствие этапам ERP;
--   kommo_events     — история: смены этапов, входящие/исходящие сообщения
--                      (только время, канал и беседа — без текста), теги;
--   kommo_sync_state — курсоры синхронизации и последняя ошибка;
--   leads.kommo_*    — ссылка на сделку и сырые значения из Kommo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Этапы Kommo → этапы ERP
--
-- Id этапов у каждого аккаунта свои, поэтому соответствие хранится в
-- базе, а не в коде. Синхронизация заводит новые этапы со значением по
-- умолчанию и дальше меняет только названия — поправленный вручную
-- stage не перетирается.
-- ---------------------------------------------------------------------
create table if not exists kommo_statuses (
  organization_id uuid not null references organizations(id),
  pipeline_id     bigint not null,
  status_id       bigint not null,
  pipeline_name   text not null,
  status_name     text not null,
  sort            int not null default 0,
  -- «Неразобранное»: заявка пришла, но менеджер её ещё не принял.
  is_unsorted     boolean not null default false,
  stage           text not null,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, pipeline_id, status_id),
  constraint kommo_statuses_stage_valid check (stage in (
    'new', 'contacted', 'trial_booked', 'trial_attended',
    'no_show', 'converted', 'lost', 'waiting'
  ))
);

comment on table kommo_statuses is
  'Этапы воронок Kommo и их соответствие leads.stage. stage можно поправить вручную — синхронизация обновляет только названия и порядок.';

-- ---------------------------------------------------------------------
-- 2. Сделка Kommo на карточке лида
-- ---------------------------------------------------------------------
alter table leads
  add column if not exists kommo_lead_id     bigint,
  add column if not exists kommo_contact_id  bigint,
  add column if not exists kommo_pipeline_id bigint,
  add column if not exists kommo_status_id   bigint,
  add column if not exists kommo_updated_at  timestamptz,
  -- Бюджет сделки в Kommo (сом). Не платёж: деньги ERP — только payments.
  add column if not exists kommo_price       numeric(12,2),
  -- В Kommo один вход на всех менеджеров, ответственного отмечают тегом
  -- с именем («Марлен», «Уулкан»). Сырое значение — для отчёта, даже
  -- пока тег не сопоставлен с сотрудником.
  add column if not exists kommo_manager_tag text,
  -- Секция и тренер в Kommo — свободный текст в карточке контакта.
  add column if not exists kommo_section     text,
  add column if not exists kommo_coach_name  text,
  add column if not exists kommo_deleted_at  timestamptz,
  -- Канал первого обращения.
  add column if not exists channel           text,
  -- Когда лид впервые попал на этап записи на пробную. trial_at — это дата
  -- самой пробной, её ставит ERP; у сделок из Kommo её может не быть.
  add column if not exists trial_booked_at   timestamptz;

alter table leads drop constraint if exists leads_kommo_lead_unique;
-- Обычный unique, а не частичный индекс: по нему работает ON CONFLICT.
-- NULL друг другу не равны, ручные лиды без сделки в Kommo не мешают.
alter table leads add constraint leads_kommo_lead_unique unique (organization_id, kommo_lead_id);

alter table leads drop constraint if exists leads_channel_valid;
alter table leads add constraint leads_channel_valid
  check (channel is null or channel in ('whatsapp', 'instagram', 'manual', 'other'));

comment on column leads.kommo_lead_id is 'Id сделки в Kommo. Есть — лид ведётся в Kommo и обновляется синхронизацией.';
comment on column leads.channel is 'Канал первого обращения: whatsapp, instagram, manual (сделку завели вручную), other.';
comment on column leads.trial_booked_at is 'ТЗ §7.4: когда лид записан на пробную. Для сделок Kommo — время перехода на этап записи.';

-- Сотрудник ↔ Kommo: отдельный пользователь Kommo или тег с именем.
alter table profiles
  add column if not exists kommo_user_id bigint,
  add column if not exists kommo_tag     text;

comment on column profiles.kommo_tag is
  'Тег сделки в Kommo, которым отмечают этого менеджера. Пусто — ищем по имени.';

-- ---------------------------------------------------------------------
-- 3. История событий Kommo
--
-- Текст сообщений не храним: для скорости ответа и воронки достаточно
-- времени, направления, канала и беседы.
-- ---------------------------------------------------------------------
create table if not exists kommo_events (
  organization_id uuid not null references organizations(id),
  id              text not null,
  type            text not null,
  entity_type     text not null,
  entity_id       bigint not null,
  created_at      timestamptz not null,
  created_by      bigint,
  talk_id         bigint,
  origin          text,
  status_before   bigint,
  status_after    bigint,
  pipeline_after  bigint,
  tag             text,
  imported_at     timestamptz not null default now(),
  primary key (organization_id, id)
);

create index if not exists kommo_events_entity_idx
  on kommo_events (organization_id, entity_type, entity_id, created_at);
create index if not exists kommo_events_type_idx
  on kommo_events (organization_id, type, created_at);
create index if not exists kommo_events_talk_idx
  on kommo_events (organization_id, talk_id, created_at) where talk_id is not null;

comment on table kommo_events is
  'События Kommo: смены этапов, сообщения (без текста), звонки, теги. Источник скорости ответа и истории воронки.';

-- ---------------------------------------------------------------------
-- 4. Состояние синхронизации
-- ---------------------------------------------------------------------
create table if not exists kommo_sync_state (
  organization_id uuid primary key references organizations(id),
  base_url        text,
  leads_cursor    timestamptz,
  contacts_cursor timestamptz,
  events_cursor   timestamptz,
  -- Граница истории: сделки, созданные раньше, загружены первой
  -- синхронизацией задним числом. Уведомлений SLA по ним не было, и
  -- страница воронки не показывает по ним просрочку первого контакта
  -- и задачу «предложить абонемент».
  history_before  timestamptz,
  last_run_at     timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  last_result     jsonb,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. RLS: читают сотрудники своей организации, пишет только бэкенд
-- ---------------------------------------------------------------------
alter table kommo_statuses   enable row level security;
alter table kommo_events     enable row level security;
alter table kommo_sync_state enable row level security;

drop policy if exists kommo_statuses_staff_read on kommo_statuses;
create policy kommo_statuses_staff_read on kommo_statuses
  for select using (is_staff() and organization_id = auth_org());

drop policy if exists kommo_events_staff_read on kommo_events;
create policy kommo_events_staff_read on kommo_events
  for select using (is_staff() and organization_id = auth_org());

drop policy if exists kommo_sync_state_staff_read on kommo_sync_state;
create policy kommo_sync_state_staff_read on kommo_sync_state
  for select using (is_staff() and organization_id = auth_org());

revoke all on kommo_statuses, kommo_events, kommo_sync_state from anon;
grant select on kommo_statuses, kommo_events, kommo_sync_state to authenticated;
grant all on kommo_statuses, kommo_events, kommo_sync_state to service_role;

-- ---------------------------------------------------------------------
-- 6. Сопоставления: менеджер и секция
-- ---------------------------------------------------------------------
create or replace function kommo_resolve_manager(p_org uuid, p_user_id bigint, p_tag text)
returns uuid
language sql
stable
security definer
set search_path = public
as $kommo_resolve_manager$
  select coalesce(
    -- 1) у менеджера свой вход в Kommo
    (select p.id from profiles p
      where p.organization_id = p_org and p.deleted_at is null
        and p_user_id is not null and p.kommo_user_id = p_user_id
      limit 1),
    -- 2) тег прописан в карточке сотрудника
    (select p.id from profiles p
      where p.organization_id = p_org and p.deleted_at is null
        and p_tag is not null and lower(p.kommo_tag) = lower(p_tag)
      limit 1),
    -- 3) тег совпадает с одним из слов ФИО — только если такой сотрудник один
    (select (array_agg(p.id))[1] from profiles p
      where p.organization_id = p_org and p.deleted_at is null
        and p_tag is not null
        and p.role in ('manager', 'senior_manager', 'director', 'fitness_director', 'cashier')
        and lower(p_tag) = any (regexp_split_to_array(lower(p.full_name), '\s+'))
      having count(*) = 1)
  );
$kommo_resolve_manager$;

-- Секция из свободного текста Kommo («мма», «вольная борьбай», «кикбокс»).
create or replace function kommo_resolve_section(p_org uuid, p_text text, p_fitness boolean default false)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $kommo_resolve_section$
declare
  v text := lower(coalesce(p_text, ''));
  v_target text;
begin
  v_target := case
    when v ~ '(мма|mma)'                                 then 'мма'
    when v ~ '(кик|kick)'                                then 'кикбоксинг'
    when v ~ 'бокс|box'                                  then 'бокс'
    when v ~ '(дзю|дэю|джу|judo)'                        then 'дзюдо'
    when v ~ '(тхэк|таэк|таек|тхек|taekw)'               then 'таэквондо'
    when v ~ '(борь|вольн|греко|wrestl)'                 then 'вольная борьба'
    when v ~ '(фитнес|fitness|зал|gym)' or (v = '' and p_fitness) then 'фитнес'
    else null
  end;
  if v_target is null then
    return null;
  end if;
  return (
    select s.id from sections s
     where s.organization_id = p_org
       and (lower(s.name_ru) = v_target
            or (v_target = 'фитнес' and s.category::text = 'fitness'))
     order by (lower(s.name_ru) = v_target) desc
     limit 1
  );
end;
$kommo_resolve_section$;

-- ---------------------------------------------------------------------
-- 7. Загрузка сделок
--
-- p_rows — массив сделок, уже разобранных бэкендом (контакт, телефон,
-- поля ученика, тег менеджера). p_quiet_before: сделки, созданные
-- раньше этого момента, — история. Им сразу ставим отметки SLA, иначе
-- refresh_lead_sla() разошлёт уведомления о просрочке по сотням давно
-- закрытых обращений.
-- ---------------------------------------------------------------------
create or replace function kommo_upsert_leads(p_org uuid, p_rows jsonb, p_quiet_before timestamptz default null)
returns int
language plpgsql
security definer
set search_path = public
as $kommo_upsert_leads$
declare
  v_now timestamptz := now();
  v_n int;
begin
  with src as (
    select r.*,
           coalesce(ks.stage, 'new') as erp_stage,
           (ks.pipeline_name ilike '%фитнес%' or ks.pipeline_name ilike '%fitness%') as is_fitness
      from jsonb_to_recordset(p_rows) as r(
        kommo_lead_id     bigint,
        kommo_contact_id  bigint,
        pipeline_id       bigint,
        status_id         bigint,
        parent_name       text,
        phone             text,
        child_name        text,
        child_age         int,
        section_text      text,
        coach_name        text,
        manager_tag       text,
        responsible_user_id bigint,
        price             numeric,
        created_at        timestamptz,
        updated_at        timestamptz,
        closed_at         timestamptz,
        loss_reason       text,
        is_deleted        boolean
      )
      left join kommo_statuses ks
        on ks.organization_id = p_org
       and ks.pipeline_id = r.pipeline_id
       and ks.status_id = r.status_id
  ), upserted as (
    insert into leads as l (
      organization_id, kommo_lead_id, kommo_contact_id, kommo_pipeline_id, kommo_status_id,
      kommo_updated_at, kommo_price, kommo_manager_tag, kommo_section, kommo_coach_name,
      kommo_deleted_at, parent_name, phone, child_name, child_age, section_interest_id,
      responsible_manager_id, stage, lost_reason, converted_at, created_at,
      sla_notified_at, escalated_at, conversion_task_at
    )
    select
      p_org, s.kommo_lead_id, s.kommo_contact_id, s.pipeline_id, s.status_id,
      s.updated_at, round(s.price, 2), s.manager_tag, s.section_text, s.coach_name,
      case when s.is_deleted then v_now end,
      s.parent_name, s.phone, s.child_name, s.child_age,
      kommo_resolve_section(p_org, s.section_text, coalesce(s.is_fitness, false)),
      kommo_resolve_manager(p_org, s.responsible_user_id, s.manager_tag),
      s.erp_stage,
      case when s.erp_stage = 'lost' then s.loss_reason end,
      case when s.erp_stage = 'converted' then coalesce(s.closed_at, s.updated_at) end,
      s.created_at,
      -- История: просрочку первого контакта и задачу после пробной считаем
      -- уже отработанными. Только то, что сработало бы прямо сейчас: лид,
      -- который дойдёт до пробной позже, задачу получить должен.
      -- Напоминания о пробной не трогаем — они идут от trial_at, а его
      -- ставит ERP.
      case when s.created_at < p_quiet_before then v_now end,
      case when s.created_at < p_quiet_before then v_now end,
      case when s.created_at < p_quiet_before and s.erp_stage = 'trial_attended' then v_now end
    from src s
    on conflict (organization_id, kommo_lead_id) do update set
      kommo_contact_id  = excluded.kommo_contact_id,
      kommo_pipeline_id = excluded.kommo_pipeline_id,
      kommo_status_id   = excluded.kommo_status_id,
      kommo_updated_at  = excluded.kommo_updated_at,
      kommo_price       = excluded.kommo_price,
      kommo_manager_tag = excluded.kommo_manager_tag,
      kommo_section     = excluded.kommo_section,
      kommo_coach_name  = excluded.kommo_coach_name,
      kommo_deleted_at  = case when excluded.kommo_deleted_at is not null
                               then coalesce(l.kommo_deleted_at, excluded.kommo_deleted_at) end,
      parent_name       = coalesce(excluded.parent_name, l.parent_name),
      phone             = coalesce(excluded.phone, l.phone),
      child_name        = coalesce(excluded.child_name, l.child_name),
      child_age         = coalesce(excluded.child_age, l.child_age),
      section_interest_id    = coalesce(excluded.section_interest_id, l.section_interest_id),
      responsible_manager_id = coalesce(excluded.responsible_manager_id, l.responsible_manager_id),
      stage             = excluded.stage,
      lost_reason       = case when excluded.stage = 'lost'
                               then coalesce(excluded.lost_reason, l.lost_reason) end,
      converted_at      = case when excluded.stage = 'converted'
                               then coalesce(l.converted_at, excluded.converted_at) end
    returning 1
  )
  select count(*) into v_n from upserted;
  return v_n;
end;
$kommo_upsert_leads$;

comment on function kommo_upsert_leads(uuid, jsonb, timestamptz) is
  'Kommo → leads. Обновляет только поля, которыми владеет Kommo; запись на пробную, связь с учеником и отметки SLA остаются за ERP.';

-- ---------------------------------------------------------------------
-- 8. Факты по событиям: первый контакт, запись на пробную, канал
--
-- Первый контакт — самое раннее из двух:
--   * первый исходящий ответ (сообщение или звонок). Ответ быстрее
--     5 секунд после первого входящего — автоответ, не человек
--     (в выгрузке 369 бесед с ответом за 0–5 с, следующий исходящий у
--     них в среднем через 10 минут);
--   * первый перевод сделки с этапа «новый».
-- Сделку часто заводят руками уже после переписки — тогда первый
-- контакт раньше создания, и его прижимаем к created_at.
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
      channel          = coalesce(f.channel, l.channel)
      from facts f
     where l.organization_id = p_org
       and l.kommo_lead_id = f.entity_id
    returning 1
  )
  select count(*) into v_n from updated;
  return v_n;
end;
$kommo_refresh_lead_facts$;

comment on function kommo_refresh_lead_facts(uuid, bigint[]) is
  'По kommo_events проставляет leads.first_contact_at (первый ответ человека или первый перевод с этапа «новый»), trial_booked_at и channel.';

revoke all on function kommo_upsert_leads(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function kommo_refresh_lead_facts(uuid, bigint[]) from public, anon, authenticated;
revoke all on function kommo_resolve_manager(uuid, bigint, text) from public, anon;
revoke all on function kommo_resolve_section(uuid, text, boolean) from public, anon;
grant execute on function kommo_upsert_leads(uuid, jsonb, timestamptz) to service_role;
grant execute on function kommo_refresh_lead_facts(uuid, bigint[]) to service_role;

-- ---------------------------------------------------------------------
-- 9. Отчёт по Kommo: каналы, скорость ответа, бэклог, воронка
--
-- Invoker: читает leads и kommo_events правами вызывающего, RLS отдаёт
-- только свою организацию.
-- ---------------------------------------------------------------------
create or replace function kommo_report(p_from date, p_to date, p_org uuid default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $kommo_report$
declare
  v_org uuid := coalesce(p_org, auth_org());
  v jsonb;
begin
  with
  talks as (
    select e.talk_id,
           min(e.created_at) filter (where e.type = 'incoming_chat_message') as first_in,
           (array_agg(e.origin order by e.created_at))[1]                    as origin
      from kommo_events e
     where e.organization_id = v_org
       and e.talk_id is not null
       and e.type in ('incoming_chat_message', 'outgoing_chat_message')
     group by e.talk_id
  ), resp as (
    select t.talk_id,
           t.origin,
           extract(hour from t.first_in at time zone 'Asia/Bishkek')::int as hour_local,
           (select min(o.created_at)
              from kommo_events o
             where o.organization_id = v_org
               and o.talk_id = t.talk_id
               and o.type = 'outgoing_chat_message'
               and o.created_at > t.first_in + interval '5 seconds') - t.first_in as wait
      from talks t
     where t.first_in is not null
       and (t.first_in at time zone 'Asia/Bishkek')::date between p_from and p_to
  ), resp_split as (
    select 'all' as k, r.* from resp r
    union all select 'work_hours', r.* from resp r where r.hour_local between 9 and 20
    union all select 'off_hours',  r.* from resp r where r.hour_local not between 9 and 20
    union all select 'whatsapp',   r.* from resp r where r.origin = 'waba'
    union all select 'instagram',  r.* from resp r where r.origin like 'instagram%'
  ), resp_agg as (
    select k,
           jsonb_build_object(
             'talks',       count(*),
             'answered',    count(wait),
             'no_reply',    count(*) - count(wait),
             'median_min',  round((percentile_cont(0.5)  within group (order by extract(epoch from wait)) / 60)::numeric, 1),
             'p75_min',     round((percentile_cont(0.75) within group (order by extract(epoch from wait)) / 60)::numeric, 1),
             'within_10_min', count(*) filter (where wait <= interval '10 minutes'),
             'within_30_min', count(*) filter (where wait <= interval '30 minutes'),
             'over_3_hours',  count(*) filter (where wait > interval '3 hours')
           ) as j
      from resp_split
     group by k
  ), by_hour as (
    select coalesce(jsonb_agg(c order by h), '[]'::jsonb) as j
      from (select h, (select count(*) from resp where hour_local = h) as c
              from generate_series(0, 23) h) x
  ), kl as (
    select l.*
      from leads l
     where l.organization_id = v_org
       and l.kommo_lead_id is not null
       and l.kommo_deleted_at is null
       and (l.created_at at time zone 'Asia/Bishkek')::date between p_from and p_to
  ), funnel as (
    select jsonb_build_object(
      'leads',          count(*),
      'unsorted',       count(*) filter (where ks.is_unsorted),
      'contacted',      count(*) filter (where kl.first_contact_at is not null),
      'trial_booked',   count(*) filter (where kl.trial_booked_at is not null or kl.trial_at is not null),
      'trial_attended', count(*) filter (where kl.stage in ('trial_attended', 'converted')),
      'converted',      count(*) filter (where kl.stage = 'converted'),
      'lost',           count(*) filter (where kl.stage = 'lost'),
      'lost_with_reason', count(*) filter (where kl.stage = 'lost' and kl.lost_reason is not null),
      'revenue',        coalesce(sum(kl.kommo_price) filter (where kl.stage = 'converted'), 0),
      'avg_check',      round(avg(kl.kommo_price) filter (where kl.stage = 'converted' and kl.kommo_price > 0)),
      'with_manager',   count(*) filter (where kl.kommo_manager_tag is not null or kl.responsible_manager_id is not null)
    ) as j
      from kl
      left join kommo_statuses ks
        on ks.organization_id = kl.organization_id
       and ks.pipeline_id = kl.kommo_pipeline_id
       and ks.status_id = kl.kommo_status_id
  ), by_channel as (
    select coalesce(jsonb_object_agg(ch, n), '{}'::jsonb) as j
      from (select coalesce(channel, 'unknown') as ch, count(*) as n from kl group by 1) x
  ), by_status as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'pipeline', ks.pipeline_name, 'status', ks.status_name, 'stage', ks.stage, 'leads', x.n)
             order by ks.pipeline_name, ks.sort), '[]'::jsonb) as j
      from (select kommo_pipeline_id, kommo_status_id, count(*) as n from kl group by 1, 2) x
      join kommo_statuses ks
        on ks.organization_id = v_org
       and ks.pipeline_id = x.kommo_pipeline_id
       and ks.status_id = x.kommo_status_id
  ), by_manager as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'manager', m, 'leads', n, 'converted', c, 'revenue', r) order by c desc, n desc), '[]'::jsonb) as j
      from (select coalesce(p.full_name, kl.kommo_manager_tag, '—') as m,
                   count(*) as n,
                   count(*) filter (where kl.stage = 'converted') as c,
                   coalesce(sum(kl.kommo_price) filter (where kl.stage = 'converted'), 0) as r
              from kl
              left join profiles p on p.id = kl.responsible_manager_id
             group by 1) x
  ), by_section as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'section', sname, 'leads', n, 'converted', c) order by n desc), '[]'::jsonb) as j
      from (select coalesce(s.name_ru, '—') as sname,
                   count(*) as n,
                   count(*) filter (where kl.stage = 'converted') as c
              from kl
              left join sections s on s.id = kl.section_interest_id
             group by 1) x
  ), backlog as (
    -- Бэклог — на сегодня, не за период.
    select jsonb_build_object(
      'unsorted_total',  count(*),
      'replied',         count(*) filter (where l.first_contact_at is not null),
      'never_replied',   count(*) filter (where l.first_contact_at is null),
      'older_than_7_days', count(*) filter (where l.created_at < now() - interval '7 days')
    ) as j
      from leads l
      join kommo_statuses ks
        on ks.organization_id = l.organization_id
       and ks.pipeline_id = l.kommo_pipeline_id
       and ks.status_id = l.kommo_status_id
     where l.organization_id = v_org
       and ks.is_unsorted
       and l.kommo_deleted_at is null
  ), sync as (
    select coalesce((select jsonb_build_object(
             'last_ok_at', s.last_ok_at, 'last_run_at', s.last_run_at,
             'last_error', s.last_error, 'base_url', s.base_url)
             from kommo_sync_state s where s.organization_id = v_org), '{}'::jsonb) as j
  )
  select jsonb_build_object(
    'period',     jsonb_build_object('from', p_from, 'to', p_to),
    'response',   coalesce((select jsonb_object_agg(k, j) from resp_agg), '{}'::jsonb),
    'by_hour',    (select j from by_hour),
    'funnel',     (select j from funnel),
    'by_channel', (select j from by_channel),
    'by_status',  (select j from by_status),
    'by_manager', (select j from by_manager),
    'by_section', (select j from by_section),
    'backlog',    (select j from backlog),
    'sync',       (select j from sync)
  ) into v;
  return v;
end;
$kommo_report$;

comment on function kommo_report(date, date, uuid) is
  'Статистика Kommo за период: скорость первого ответа (без автоответов), каналы, воронка по этапам Kommo, менеджеры, секции, бэклог «Неразобранного».';

revoke all on function kommo_report(date, date, uuid) from public, anon;
grant execute on function kommo_report(date, date, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. KPI §7.4 и воронка: «записан на пробную» — по trial_booked_at тоже
--
-- У сделок из Kommo нет даты пробной (trial_at ставит ERP), есть только
-- переход на этап записи. Без этого метрика «Лид → запись на пробную»
-- для всех лидов из Kommo была бы нулём. Ниже — те же view и функция
-- из 20260926000002 и 20260926000003, изменено одно условие.
-- ---------------------------------------------------------------------
drop view if exists v_lead_funnel;
-- security_invoker: view читает leads правами вызывающего, поэтому
-- работает политика leads_staff_all (свой офис, только сотрудники).
-- Без этого view отдавал бы воронку всех организаций любому, кто вошёл.
create view v_lead_funnel with (security_invoker = true) as
  select
    l.organization_id,
    l.responsible_manager_id,
    date_trunc('month', l.created_at)::date          as month,
    count(*)                                          as leads_total,
    count(*) filter (where l.first_contact_at is not null) as contacted_total,
    -- Средняя скорость первого контакта, минут (цель §7.4 — меньше 10).
    avg(extract(epoch from (l.first_contact_at - l.created_at)) / 60)
      filter (where l.first_contact_at is not null)   as avg_first_contact_min,
    count(*) filter (where l.first_contact_at is not null
                       and l.first_contact_at <= l.created_at + interval '10 minutes')
                                                      as within_sla_total,
    -- Записан на пробную: этап пройден, даже если лид уехал дальше.
    count(*) filter (where l.trial_at is not null or l.trial_booked_at is not null)
                                                      as trial_booked_total,
    count(*) filter (where l.stage in ('trial_attended', 'converted')) as trial_attended_total,
    count(*) filter (where l.stage = 'no_show')       as no_show_total,
    count(*) filter (where l.stage = 'converted')     as converted_total,
    count(*) filter (where l.stage = 'lost')          as lost_total
  from leads l
  group by l.organization_id, l.responsible_manager_id, date_trunc('month', l.created_at);

comment on view v_lead_funnel is
  'ТЗ §7.4 и §11.1: воронка по месяцам и менеджерам — лиды, первый контакт и его скорость, записи на пробную, приходы, конверсии.';

revoke all on v_lead_funnel from anon;
grant select on v_lead_funnel to authenticated, service_role;

create or replace function manager_kpi(p_from date, p_to date)
returns table (
  manager_id              uuid,
  manager_name            text,
  leads_total             bigint,
  first_contact_total     bigint,
  avg_first_contact_min   numeric,
  within_sla_total        bigint,
  trial_booked_total      bigint,
  trial_attended_total    bigint,
  converted_total         bigint,
  renewals_due            bigint,
  renewals_done           bigint,
  sales_total             bigint,
  sales_per_day           numeric
)
language sql
stable
as $manager_kpi$
  with
  -- Строка на каждого сотрудника плюс «нулевая» — под лиды и клиентов
  -- без ответственного менеджера. Без неё они выпали бы из итогов.
  mgrs as (
    select p.id, p.full_name
      from profiles p
     where p.deleted_at is null
       and p.role in ('manager', 'senior_manager', 'director', 'fitness_director', 'cashier')
    union all
    select null::uuid, null::text
  ),
  sla as (
    select coalesce(min(s.lead_first_contact_min), 10) as first_contact_min
      from org_settings s
  ),
  lead_agg as (
    select
      l.responsible_manager_id as mid,
      count(*)                                                      as leads_total,
      count(*) filter (where l.first_contact_at is not null)         as contacted,
      -- Метрика §7.4 «Скорость первого контакта» — именно среднее время,
      -- а не доля уложившихся; долю считаем отдельно (within_sla).
      avg(extract(epoch from (l.first_contact_at - l.created_at)) / 60)
        filter (where l.first_contact_at is not null)                as avg_min,
      count(*) filter (
        where l.first_contact_at is not null
          and l.first_contact_at <= l.created_at
              + make_interval(mins => sla.first_contact_min)
      )                                                              as within_sla,
      -- Записан на пробную: считаем по факту записи, а не по текущему
      -- этапу — лид, который уже купил, этот шаг тоже прошёл. Для сделок
      -- Kommo даты пробной нет, есть время перехода на этап записи.
      count(*) filter (where l.trial_at is not null
                          or l.trial_booked_at is not null)  as booked,
      count(*) filter (where l.stage in ('trial_attended', 'converted')) as attended,
      count(*) filter (where l.stage = 'converted')                  as converted
    from leads l
    -- Норматив подмешиваем джойном, а не подзапросом внутри FILTER:
    -- в filter_clause подзапросам не место.
    cross join sla
    where l.created_at::date between p_from and p_to
    group by l.responsible_manager_id
  ),
  -- Продления (§7.4, цель > 80%). Знаменатель — абонементы, срок которых
  -- истекал в периоде. Числитель — те, по кому продление куплено НЕ ПОЗЖЕ
  -- дня окончания: по ТЗ §4.5 менеджер ведёт продление с −7 дней до дня
  -- окончания, всё, что после, — это уже win-back, а не «в срок».
  renew_agg as (
    select
      ch.responsible_manager_id as mid,
      count(*)                  as due,
      count(*) filter (where exists (
        select 1
          from club_cards n
         where n.child_id = cc.child_id
           and n.id <> cc.id
           and n.start_date > cc.start_date
           and n.created_at::date <= cc.end_date
           -- Ребёнок может заниматься в нескольких секциях параллельно,
           -- поэтому продлением считается карта той же секции.
           and (cc.section_id is null or n.section_id is null
                or n.section_id = cc.section_id)
      ))                        as done
    from club_cards cc
    join children ch on ch.id = cc.child_id
    where cc.end_date between p_from and p_to
    group by ch.responsible_manager_id
  ),
  -- Продажи: абонемент считается проданным тем, кто принял по нему оплату.
  -- distinct по карте — частичные оплаты одной карты не должны считаться
  -- двумя продажами.
  sales_agg as (
    select
      pm.received_by                 as mid,
      count(distinct pm.club_card_id) as sales
    from payments pm
    where pm.club_card_id is not null
      and pm.amount > 0
      and pm.paid_at::date between p_from and p_to
    group by pm.received_by
  )
  select
    m.id,
    m.full_name,
    coalesce(l.leads_total, 0),
    coalesce(l.contacted, 0),
    round(l.avg_min, 1),
    coalesce(l.within_sla, 0),
    coalesce(l.booked, 0),
    coalesce(l.attended, 0),
    coalesce(l.converted, 0),
    coalesce(r.due, 0),
    coalesce(r.done, 0),
    coalesce(s.sales, 0),
    round(coalesce(s.sales, 0)::numeric / greatest(p_to - p_from + 1, 1), 2)
  from mgrs m
  -- is not distinct from: нулевая строка должна поймать записи без
  -- ответственного, а обычное = на NULL их бы потеряло.
  left join lead_agg  l on l.mid is not distinct from m.id
  left join renew_agg r on r.mid is not distinct from m.id
  left join sales_agg s on s.mid is not distinct from m.id
  where coalesce(l.leads_total, 0) + coalesce(r.due, 0) + coalesce(s.sales, 0) > 0
  order by coalesce(s.sales, 0) desc, coalesce(l.converted, 0) desc, m.full_name;
$manager_kpi$;

notify pgrst, 'reload schema';
