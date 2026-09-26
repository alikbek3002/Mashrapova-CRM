-- =====================================================================
-- Воронка лидов по ТЗ Академии Машрапова §8.
--
-- Было (движок Uniqum): leads.stage — enum из трёх значений
-- ('new','trial','waiting'), никаких сроков и задач.
-- Стало: шесть этапов §8.2 плюс нормативы времени §8.3.
--
--   new            — лид создан, менеджер ещё не связался
--   contacted      — квалификация пройдена, менеджер дозвонился
--   trial_booked   — записан на пробную (дата/время, группа, тренер)
--   trial_attended — пришёл на пробную
--   no_show        — не пришёл
--   converted      — купил абонемент
--   lost           — отказ (с причиной)
--   waiting        — лист ожидания; этап движка, оставлен, чтобы не
--                    терять уже заведённые лиды
--
-- Stage переводим из enum в text с check: ТЗ §8 прямо говорит, что в
-- версии 2.0 модуль заменяется интеграцией с AmoCRM, и набор этапов
-- будет меняться. Менять check дешевле, чем каждый раз плясать вокруг
-- ALTER TYPE ... ADD VALUE (новое значение enum нельзя использовать в
-- той же транзакции, где оно добавлено).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Этапы воронки (§8.2)
-- ---------------------------------------------------------------------
alter table leads alter column stage drop default;
alter table leads alter column stage type text using stage::text;

-- Перенос этапов движка: 'trial' означало «записан на пробную».
update leads set stage = 'trial_booked' where stage = 'trial';

alter table leads alter column stage set default 'new';

alter table leads drop constraint if exists leads_stage_valid;
alter table leads add constraint leads_stage_valid check (stage in (
  'new', 'contacted', 'trial_booked', 'trial_attended',
  'no_show', 'converted', 'lost', 'waiting'
));

comment on column leads.stage is
  'Этап воронки ТЗ §8.2: new → contacted → trial_booked → trial_attended → converted; тупики — no_show, lost; waiting — лист ожидания.';

-- Старый тип больше не используется. Дропаем, только если на него
-- никто не ссылается: в чужой базе он мог остаться на другой колонке.
do $drop_lead_stage$
begin
  if exists (select 1 from pg_type where typname = 'lead_stage') then
    -- Проверку ссылок делаем отдельным IF: PostgreSQL не гарантирует
    -- короткое замыкание AND, и 'lead_stage'::regtype в одном условии
    -- с проверкой существования упал бы там, где типа уже нет.
    if not exists (
      select 1
        from pg_attribute a
        join pg_type t on t.oid = a.atttypid
       where t.typname = 'lead_stage'
         and a.attnum > 0
         and not a.attisdropped
    ) then
      drop type lead_stage;
    end if;
  end if;
end $drop_lead_stage$;

-- ---------------------------------------------------------------------
-- 2. Карточка лида (§8.1, §8.2)
--
-- «Создаётся карточка лида (имя, Instagram, телефон, источник, время)».
-- Instagram — основной канал входа, из директа приходит ник, а не телефон.
-- ---------------------------------------------------------------------
alter table leads
  add column if not exists instagram text,
  -- Первый контакт: когда и кто. От created_at до него считается SLA §8.3.
  add column if not exists first_contact_at timestamptz,
  add column if not exists first_contact_by uuid references profiles(id),
  -- Отметки уже отработанных системой событий — чтобы не дублировать.
  add column if not exists sla_notified_at timestamptz,
  add column if not exists escalated_at timestamptz,
  -- Запись на пробную: дата/время, секция и тренер (через группу).
  add column if not exists trial_at timestamptz,
  add column if not exists trial_group_id uuid references groups(id),
  add column if not exists trial_coach_id uuid references coaches(id),
  add column if not exists reminder_24h_at timestamptz,
  add column if not exists reminder_2h_at timestamptz,
  add column if not exists no_show_task_at timestamptz,
  add column if not exists conversion_task_at timestamptz,
  add column if not exists lost_reason text,
  -- В кого сконвертировался лид — связь с карточкой ученика.
  add column if not exists converted_child_id uuid references children(id),
  add column if not exists updated_at timestamptz not null default now();

comment on column leads.first_contact_at is
  'ТЗ §8.3: момент первого контакта менеджера с лидом. Норматив — не позже 10 минут после создания карточки.';
comment on column leads.escalated_at is
  'ТЗ §8.3: когда просрочка первого контакта была эскалирована старшему менеджеру (норматив — 30 минут).';
comment on column leads.trial_at is
  'ТЗ §8.2: дата и время пробной тренировки, на которую записан лид.';

-- Источник лида (§8.1): таргет Instagram, рекомендация, прямое обращение.
update leads set source = case
  when source is null then null
  when lower(source) like '%instagram%' or lower(source) like '%таргет%'
    or lower(source) like '%target%' or lower(source) like '%реклам%' then 'target'
  when lower(source) like '%сарафан%' or lower(source) like '%рекоменд%'
    or lower(source) like '%referral%' or lower(source) like '%друг%' then 'referral'
  when source in ('target', 'referral', 'direct', 'other') then source
  else 'other'
end;

alter table leads drop constraint if exists leads_source_valid;
alter table leads add constraint leads_source_valid
  check (source is null or source in ('target', 'referral', 'direct', 'other'));

comment on column leads.source is
  'ТЗ §8.1: target — таргет Instagram (основной канал), referral — рекомендация, direct — прямое обращение.';

drop trigger if exists set_updated_at on leads;
create trigger set_updated_at before update on leads
  for each row execute function trigger_set_updated_at();

-- Воронку смотрят по этапу и по просрочке первого контакта.
create index if not exists leads_stage_idx on leads (organization_id, stage, created_at desc);
create index if not exists leads_sla_idx on leads (organization_id, first_contact_at, created_at)
  where first_contact_at is null;
create index if not exists leads_trial_idx on leads (organization_id, trial_at)
  where trial_at is not null;

-- ---------------------------------------------------------------------
-- 3. Нормативы времени (§8.3) — в настройках, а не в коде
-- ---------------------------------------------------------------------
alter table org_settings
  add column if not exists lead_first_contact_min int not null default 10,
  add column if not exists lead_escalation_min int not null default 30,
  add column if not exists lead_no_show_hours int not null default 3;

alter table org_settings drop constraint if exists org_settings_lead_sla_positive;
alter table org_settings add constraint org_settings_lead_sla_positive check (
  lead_first_contact_min > 0 and lead_escalation_min > 0 and lead_no_show_hours > 0
);

comment on column org_settings.lead_first_contact_min is
  'ТЗ §8.3: норматив первого контакта с лидом, минут. По ТЗ — 10.';
comment on column org_settings.lead_escalation_min is
  'ТЗ §8.3: через сколько минут просрочки уведомлять старшего менеджера. По ТЗ — 30.';
comment on column org_settings.lead_no_show_hours is
  'ТЗ §8.3: через сколько часов после пробной ставить задачу «не пришёл». По ТЗ — 3.';

-- ---------------------------------------------------------------------
-- 4. refresh_lead_sla() — движок нормативов §8.3
--
-- Гоняется по расписанию (POST /v1/lifecycle/refresh). Идемпотентна:
-- каждое событие отмечается своей колонкой и второй раз не срабатывает.
--
-- Уведомления пишутся в notifications для ответственного менеджера и,
-- при эскалации, для старших. Инбокса у офиса пока нет (notifications
-- читает только приложение родителя), поэтому видимая часть SLA — это
-- отметки на самом лиде: страница воронки показывает просрочку и
-- задачи прямо в строке. Когда появится инбокс (§9.1, колонка
-- «Системное (менеджер)»), строки уже будут накоплены.
-- ---------------------------------------------------------------------
create or replace function refresh_lead_sla() returns void
language plpgsql
security definer
set search_path = public
as $refresh_lead_sla$
declare
  v_now timestamptz := now();
begin
  -- 4.1 Просрочен первый контакт → задача ответственному менеджеру.
  with due as (
    select l.id, l.organization_id, l.responsible_manager_id, l.child_name, l.parent_name
      from leads l
      -- LEFT JOIN с дефолтами по ТЗ: отсутствие строки настроек не должно
      -- молча выключать нормативы для всей организации.
      left join org_settings s on s.organization_id = l.organization_id
     where l.stage = 'new'
       and l.first_contact_at is null
       and l.sla_notified_at is null
       and l.created_at < v_now - make_interval(mins => coalesce(s.lead_first_contact_min, 10))
  ), notified as (
    insert into notifications (recipient_id, type, payload)
    select p.id, 'lead_first_contact_overdue',
           jsonb_build_object(
             'lead_id', d.id,
             'child_name', d.child_name,
             'parent_name', d.parent_name
           )
      from due d
      join profiles p
        on p.organization_id = d.organization_id
       and p.deleted_at is null
       and (
         p.id = d.responsible_manager_id
         -- Лид без ответственного — зовём всех, кто работает с лидами.
         or (d.responsible_manager_id is null and p.role in ('manager', 'senior_manager'))
       )
    returning 1
  )
  update leads set sla_notified_at = v_now
   where id in (select id from due);

  -- 4.2 Эскалация старшему менеджеру (§8.3: через 30 минут).
  with due as (
    select l.id, l.organization_id, l.child_name, l.parent_name
      from leads l
      left join org_settings s on s.organization_id = l.organization_id
     where l.stage = 'new'
       and l.first_contact_at is null
       and l.escalated_at is null
       and l.created_at < v_now - make_interval(mins => coalesce(s.lead_escalation_min, 30))
  ), notified as (
    insert into notifications (recipient_id, type, payload)
    select p.id, 'lead_sla_escalation',
           jsonb_build_object(
             'lead_id', d.id,
             'child_name', d.child_name,
             'parent_name', d.parent_name
           )
      from due d
      join profiles p
        on p.organization_id = d.organization_id
       and p.deleted_at is null
       and p.role in ('senior_manager', 'director', 'fitness_director')
    returning 1
  )
  update leads set escalated_at = v_now
   where id in (select id from due);

  -- 4.3 Напоминание о пробной за 24 часа (§8.2).
  with due as (
    select l.id, l.organization_id, l.responsible_manager_id, l.child_name, l.trial_at
      from leads l
     where l.stage = 'trial_booked'
       and l.trial_at is not null
       and l.reminder_24h_at is null
       and l.trial_at <= v_now + interval '24 hours'
       and l.trial_at > v_now
  ), notified as (
    insert into notifications (recipient_id, type, payload)
    select p.id, 'lead_trial_reminder_24h',
           jsonb_build_object('lead_id', d.id, 'child_name', d.child_name, 'trial_at', d.trial_at)
      from due d
      join profiles p
        on p.organization_id = d.organization_id
       and p.deleted_at is null
       and (p.id = d.responsible_manager_id
            or (d.responsible_manager_id is null and p.role in ('manager', 'senior_manager')))
    returning 1
  )
  update leads set reminder_24h_at = v_now
   where id in (select id from due);

  -- 4.4 Напоминание за 2 часа (§8.2).
  with due as (
    select l.id, l.organization_id, l.responsible_manager_id, l.child_name, l.trial_at
      from leads l
     where l.stage = 'trial_booked'
       and l.trial_at is not null
       and l.reminder_2h_at is null
       and l.trial_at <= v_now + interval '2 hours'
       and l.trial_at > v_now
  ), notified as (
    insert into notifications (recipient_id, type, payload)
    select p.id, 'lead_trial_reminder_2h',
           jsonb_build_object('lead_id', d.id, 'child_name', d.child_name, 'trial_at', d.trial_at)
      from due d
      join profiles p
        on p.organization_id = d.organization_id
       and p.deleted_at is null
       and (p.id = d.responsible_manager_id
            or (d.responsible_manager_id is null and p.role in ('manager', 'senior_manager')))
    returning 1
  )
  update leads set reminder_2h_at = v_now
   where id in (select id from due);

  -- 4.5 Не пришёл: через lead_no_show_hours после пробной лид всё ещё
  -- в trial_booked → задача позвонить (§8.2, §8.3). Этап автоматически
  -- НЕ меняем: пришёл человек или нет, знает только менеджер.
  with due as (
    select l.id, l.organization_id, l.responsible_manager_id, l.child_name, l.trial_at
      from leads l
      left join org_settings s on s.organization_id = l.organization_id
     where l.stage = 'trial_booked'
       and l.trial_at is not null
       and l.no_show_task_at is null
       and v_now > l.trial_at + make_interval(hours => coalesce(s.lead_no_show_hours, 3))
  ), notified as (
    insert into notifications (recipient_id, type, payload)
    select p.id, 'lead_no_show_call',
           jsonb_build_object('lead_id', d.id, 'child_name', d.child_name, 'trial_at', d.trial_at)
      from due d
      join profiles p
        on p.organization_id = d.organization_id
       and p.deleted_at is null
       and (p.id = d.responsible_manager_id
            or (d.responsible_manager_id is null and p.role in ('manager', 'senior_manager')))
    returning 1
  )
  update leads set no_show_task_at = v_now
   where id in (select id from due);

  -- 4.6 После пробной — задача «позвонить и предложить абонемент» (§8.2).
  with due as (
    select l.id, l.organization_id, l.responsible_manager_id, l.child_name
      from leads l
     where l.stage = 'trial_attended'
       and l.conversion_task_at is null
  ), notified as (
    insert into notifications (recipient_id, type, payload)
    select p.id, 'lead_conversion_call',
           jsonb_build_object('lead_id', d.id, 'child_name', d.child_name)
      from due d
      join profiles p
        on p.organization_id = d.organization_id
       and p.deleted_at is null
       and (p.id = d.responsible_manager_id
            or (d.responsible_manager_id is null and p.role in ('manager', 'senior_manager')))
    returning 1
  )
  update leads set conversion_task_at = v_now
   where id in (select id from due);
end;
$refresh_lead_sla$;

comment on function refresh_lead_sla() is
  'ТЗ §8.3: нормативы воронки — просрочка первого контакта, эскалация старшему менеджеру, напоминания о пробной за 24ч и 2ч, задачи «не пришёл» и «предложить абонемент». Идемпотентна.';

-- ---------------------------------------------------------------------
-- 5. Первый контакт проставляется сам
--
-- Менеджер не должен помнить про отдельную кнопку: любой переход лида
-- с этапа «новый» дальше означает, что контакт состоялся.
-- ---------------------------------------------------------------------
create or replace function fn_lead_stamp_first_contact() returns trigger
language plpgsql
security definer
set search_path = public
as $stamp$
begin
  if new.stage is distinct from old.stage
     and old.stage = 'new'
     and new.stage <> 'new'
     and new.first_contact_at is null then
    new.first_contact_at := now();
    new.first_contact_by := coalesce(new.first_contact_by, auth.uid());
  end if;
  return new;
end;
$stamp$;

drop trigger if exists lead_stamp_first_contact on leads;
create trigger lead_stamp_first_contact
  before update on leads
  for each row execute function fn_lead_stamp_first_contact();

comment on function fn_lead_stamp_first_contact() is
  'ТЗ §8.3: уход лида с этапа «новый» и есть первый контакт — отмечаем время, чтобы SLA считался без ручных действий.';

-- ---------------------------------------------------------------------
-- 6. v_lead_funnel — воронка с конверсиями для отчётов (§7.4, §11.1)
--
-- Считает по всем лидам организации: сколько дошло до каждого этапа и
-- средняя скорость первого контакта. Конверсии §7.4 берутся отсюда.
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
    count(*) filter (where l.trial_at is not null)    as trial_booked_total,
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


notify pgrst, 'reload schema';
