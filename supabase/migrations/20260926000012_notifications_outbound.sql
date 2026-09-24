-- =====================================================================
-- Модуль «Уведомления» по ТЗ Академии Машрапова §9 — транспортный слой.
--
-- Что здесь есть и чего нет
-- -------------------------
-- Провайдера SMS у Академии пока нет (§13, открытые вопросы 1–2), Push
-- упирается в решение по приложению родителя (вопрос 3). Поэтому здесь
-- строится ВСЁ, кроме самой отправки: матрица каналов, шаблоны текстов,
-- очередь исходящих и точки постановки в неё. Когда договор с SMS.kg
-- будет подписан, останется вписать ключи и включить провайдера в
-- бэкенде — трогать схему и триггеры не придётся.
--
-- Матрица §9.1 сделана ТАБЛИЦЕЙ, а не кодом. Открытый вопрос 3 к
-- Академии — «финальная матрица Push/SMS: согласовать приоритеты», то
-- есть галочки заведомо будут меняться. Менять их правкой строки в базе
-- дешевле, чем деплоем.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Матрица каналов (§9.1)
-- ---------------------------------------------------------------------
create table if not exists notification_matrix (
  organization_id uuid not null references organizations(id),
  -- Тип события совпадает с notifications.type там, где событие уже
  -- пишется в систему; для лидов — собственные типы.
  event_type text not null,
  channel text not null check (channel in ('push', 'sms', 'inapp')),
  enabled boolean not null default true,
  -- Кому: клиенту (родителю или лиду) или сотруднику.
  audience text not null check (audience in ('client', 'staff')),
  updated_at timestamptz not null default now(),
  primary key (organization_id, event_type, channel)
);

comment on table notification_matrix is
  'ТЗ §9.1: какие каналы включены для каждого события. Таблица, а не код: финальную матрицу Push/SMS Академия ещё согласовывает (открытый вопрос 3).';

alter table notification_matrix enable row level security;

create policy notification_matrix_staff_read on notification_matrix for select
  using (is_staff() and organization_id = auth_org());

create policy notification_matrix_director_write on notification_matrix for all
  using (is_director() and organization_id = auth_org())
  with check (is_director() and organization_id = auth_org());

-- Заполняем строго по таблице §9.1.
insert into notification_matrix (organization_id, event_type, channel, audience, enabled)
select o.id, v.event_type, v.channel, v.audience, v.enabled
from organizations o
cross join (values
  -- Запись на пробную (подтверждение): push ✅, sms ✅
  ('lead_trial_booked',        'push',  'client', true),
  ('lead_trial_booked',        'sms',   'client', true),
  -- Напоминание о пробной за 24 ч: push ✅, sms ✅
  ('lead_trial_reminder_24h',  'push',  'client', true),
  ('lead_trial_reminder_24h',  'sms',   'client', true),
  -- Напоминание за 2 ч: push ✅, sms —
  ('lead_trial_reminder_2h',   'push',  'client', true),
  ('lead_trial_reminder_2h',   'sms',   'client', false),
  -- Ребёнок не пришёл на тренировку: push ✅, sms —, менеджеру ✅
  ('child_absent',             'push',  'client', true),
  ('child_absent',             'sms',   'client', false),
  ('child_absent',             'inapp', 'staff',  true),
  -- Абонемент заканчивается через 7 / 3 дня и истёк: push ✅, sms ✅, менеджеру ✅
  ('card_expiring',            'push',  'client', true),
  ('card_expiring',            'sms',   'client', true),
  ('card_renewal_task',        'inapp', 'staff',  true),
  ('card_expired',             'push',  'client', true),
  ('card_expired',             'sms',   'client', true),
  -- Win-back: push —, sms ✅
  ('card_winback',             'push',  'client', false),
  ('card_winback',             'sms',   'client', true),
  -- Отмена / перенос занятия: push ✅, sms ✅, менеджеру ✅
  ('lesson.cancelled',         'push',  'client', true),
  ('lesson.cancelled',         'sms',   'client', true),
  ('lesson.rescheduled',       'push',  'client', true),
  ('lesson.rescheduled',       'sms',   'client', true),
  -- Тренер поставил заморозку: только менеджеру
  ('freeze.pending',           'inapp', 'staff',  true),
  -- Риск оттока: только менеджеру
  ('churn_risk',               'inapp', 'staff',  true),
  -- Ребёнок отмечен на тренировке: push ✅
  ('child_present',            'push',  'client', true),
  ('child_present',            'sms',   'client', false)
) as v(event_type, channel, audience, enabled)
on conflict (organization_id, event_type, channel) do nothing;

-- ---------------------------------------------------------------------
-- 2. Шаблоны текстов
--
-- Тексты SMS клиент правит сам: менять формулировку через деплой — плохая
-- идея, особенно для сообщений, которые видит 525 семей. Подстановка
-- простая: {child_name}, {end_date} и т.п.
-- ---------------------------------------------------------------------
create table if not exists message_templates (
  organization_id uuid not null references organizations(id),
  event_type text not null,
  channel text not null check (channel in ('push', 'sms')),
  body_ru text not null,
  body_ky text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, event_type, channel)
);

comment on table message_templates is
  'ТЗ §9: тексты сообщений клиенту. Правятся Академией без деплоя; подстановки вида {child_name}.';

alter table message_templates enable row level security;

create policy message_templates_staff_read on message_templates for select
  using (is_staff() and organization_id = auth_org());

create policy message_templates_manage_write on message_templates for all
  using (can_view_finance_reports() and organization_id = auth_org())
  with check (can_view_finance_reports() and organization_id = auth_org());

insert into message_templates (organization_id, event_type, channel, body_ru)
select o.id, v.event_type, v.channel, v.body_ru
from organizations o
cross join (values
  ('lead_trial_booked',       'sms',  'Академия Машрапова: {child_name} записан на пробную {trial_at}. Ждём вас!'),
  ('lead_trial_booked',       'push', 'Пробная тренировка {trial_at}'),
  ('lead_trial_reminder_24h', 'sms',  'Напоминаем: завтра в {trial_at} пробная тренировка в Академии Машрапова.'),
  ('lead_trial_reminder_24h', 'push', 'Завтра пробная тренировка в {trial_at}'),
  ('lead_trial_reminder_2h',  'push', 'Через 2 часа пробная тренировка'),
  ('card_expiring',           'sms',  'Абонемент {child_name} заканчивается {end_date}. Продлите, чтобы не потерять место в группе.'),
  ('card_expiring',           'push', 'Абонемент заканчивается {end_date}'),
  ('card_expired',            'sms',  'Абонемент {child_name} закончился {end_date}. Ждём вас на продление!'),
  ('card_expired',            'push', 'Абонемент закончился'),
  ('card_winback',            'sms',  'Скучаем по {child_name}! Специальное предложение на продление действует 48 часов.'),
  ('lesson.cancelled',        'sms',  'Тренировка {date} отменена. Причина: {reason}. Занятие добавлено к абонементу.'),
  ('lesson.cancelled',        'push', 'Тренировка {date} отменена'),
  ('lesson.rescheduled',      'sms',  'Тренировка перенесена: было {previous_date}, стало {new_date} в {new_start_time}.'),
  ('lesson.rescheduled',      'push', 'Тренировка перенесена на {new_date}'),
  ('child_present',           'push', '{child_name} на тренировке'),
  ('child_absent',            'push', '{child_name} не пришёл на тренировку')
) as v(event_type, channel, body_ru)
on conflict (organization_id, event_type, channel) do nothing;

-- ---------------------------------------------------------------------
-- 3. Очередь исходящих
--
-- Отдельно от notifications: та — журнал событий в системе, эта —
-- транспорт с попытками, ошибками и идентификаторами от провайдера.
-- Смешивать нельзя: у сообщения своя судьба, оно может не уйти.
-- ---------------------------------------------------------------------
create table if not exists outbound_messages (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  channel text not null check (channel in ('push', 'sms')),
  event_type text not null,
  -- Получатель: телефон для SMS, пользователь для push. Для лида
  -- пользователя нет вовсе, поэтому телефон хранится строкой.
  to_phone text,
  to_user_id uuid references profiles(id),
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  provider text,
  provider_message_id text,
  -- Защита от повторной постановки того же события: ключ собирается из
  -- типа, канала и идентификатора сущности.
  dedup_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

comment on table outbound_messages is
  'ТЗ §9: очередь исходящих SMS и push. Отдельно от notifications — там журнал событий, здесь транспорт с попытками и ответами провайдера.';

create index if not exists outbound_queued_idx
  on outbound_messages (organization_id, created_at)
  where status = 'queued';

alter table outbound_messages enable row level security;

-- Читают сотрудники с доступом к финотчётам и выше: массовые рассылки и
-- их результат — управленческая информация (§9.2).
create policy outbound_staff_read on outbound_messages for select
  using (can_view_finance_reports() and organization_id = auth_org());

-- Пишет только бэкенд (service_role) — клиентских политик на запись нет.

-- ---------------------------------------------------------------------
-- 4. enqueue_outbound() — постановка с учётом матрицы и шаблона
--
-- Никаких «отправить» здесь нет: функция только кладёт в очередь. Если
-- канал выключен в матрице или шаблона нет — тихо выходим, это не ошибка.
-- ---------------------------------------------------------------------
create or replace function enqueue_outbound(
  p_organization_id uuid,
  p_event_type text,
  p_channel text,
  p_to_phone text,
  p_to_user_id uuid,
  p_payload jsonb,
  p_dedup_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $enqueue_outbound$
declare
  v_enabled boolean;
  v_body text;
  v_key text;
  v_val text;
  v_id uuid;
begin
  select enabled into v_enabled
    from notification_matrix
   where organization_id = p_organization_id
     and event_type = p_event_type
     and channel = p_channel;
  if not coalesce(v_enabled, false) then
    return null;
  end if;

  -- SMS без телефона и push без пользователя отправить невозможно.
  if p_channel = 'sms' and coalesce(btrim(p_to_phone), '') = '' then
    return null;
  end if;
  if p_channel = 'push' and p_to_user_id is null then
    return null;
  end if;

  select body_ru into v_body
    from message_templates
   where organization_id = p_organization_id
     and event_type = p_event_type
     and channel = p_channel;
  if v_body is null then
    return null;
  end if;

  -- Подстановка {ключ} значениями из payload.
  for v_key, v_val in select key, value #>> '{}' from jsonb_each(coalesce(p_payload, '{}'::jsonb))
  loop
    v_body := replace(v_body, '{' || v_key || '}', coalesce(v_val, ''));
  end loop;

  insert into outbound_messages (
    organization_id, channel, event_type, to_phone, to_user_id,
    body, payload, dedup_key
  ) values (
    p_organization_id, p_channel, p_event_type, nullif(btrim(p_to_phone), ''), p_to_user_id,
    v_body, coalesce(p_payload, '{}'::jsonb), p_dedup_key
  )
  on conflict (dedup_key) do nothing
  returning id into v_id;

  return v_id;
end;
$enqueue_outbound$;

comment on function enqueue_outbound(uuid, text, text, text, uuid, jsonb, text) is
  'ТЗ §9: ставит сообщение в очередь, если канал включён в матрице и есть шаблон. Дедупликация по dedup_key.';

-- ---------------------------------------------------------------------
-- 5. Мост из notifications в очередь
--
-- События уже пишутся в notifications из шести разных мест (SQL-функции
-- жизненного цикла, воронка лидов, отмена занятия, заморозки). Вместо
-- правки каждого — триггер: появилось уведомление родителю, смотрим
-- матрицу и ставим клиентские каналы. Сотрудницкие уведомления остаются
-- как есть, это и есть канал «менеджеру в системе».
-- ---------------------------------------------------------------------
create or replace function fn_notification_to_outbound() returns trigger
language plpgsql
security definer
set search_path = public
as $notif_bridge$
declare
  v_org uuid;
  v_role user_role;
  v_phone text;
  v_child_name text;
begin
  select p.organization_id, p.role into v_org, v_role
    from profiles p where p.id = new.recipient_id;
  if v_org is null then
    return new;
  end if;

  -- Клиентские каналы — только для родителя. Сотруднику сообщение в
  -- системе уже доставлено самой строкой notifications.
  if v_role is distinct from 'parent' then
    return new;
  end if;

  -- Телефон берём у семьи ребёнка из события; если ребёнка в payload
  -- нет — у первой семьи этого родителя.
  select coalesce(f.father_phone, f.mother_phone), c.full_name
    into v_phone, v_child_name
    from families f
    left join children c on c.family_id = f.id
      and c.id = nullif(new.payload ->> 'child_id', '')::uuid
   where f.parent_user_id = new.recipient_id
   limit 1;

  perform enqueue_outbound(
    v_org, new.type, 'push', null, new.recipient_id,
    new.payload || jsonb_build_object('child_name', coalesce(new.payload ->> 'child_name', v_child_name, '')),
    new.type || ':push:' || new.id::text
  );
  perform enqueue_outbound(
    v_org, new.type, 'sms', v_phone, new.recipient_id,
    new.payload || jsonb_build_object('child_name', coalesce(new.payload ->> 'child_name', v_child_name, '')),
    new.type || ':sms:' || new.id::text
  );

  return new;
end;
$notif_bridge$;

comment on function fn_notification_to_outbound() is
  'ТЗ §9.1: превращает уведомление родителю в исходящие push и SMS согласно матрице каналов. Уведомления сотрудникам не трогает — они и есть канал «менеджеру в системе».';

drop trigger if exists notification_to_outbound on notifications;
create trigger notification_to_outbound
  after insert on notifications
  for each row execute function fn_notification_to_outbound();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 6. События матрицы, которых в системе ещё не было
--
-- Мост выше работает через notifications, но у лида нет пользователя —
-- он ещё не клиент, только телефон. Поэтому для лидов ставим в очередь
-- напрямую, триггером на изменение его карточки.
--
-- Покрываются три строки §9.1:
--   «Запись на пробную (подтверждение)»   — push ✅, sms ✅
--   «Напоминание о пробной за 24 ч»       — push ✅, sms ✅
--   «Напоминание о пробной за 2 ч»        — push ✅
-- Отметки времени напоминаний проставляет refresh_lead_sla (§8.3), так
-- что переписывать её не нужно — ловим сам факт простановки.
-- ---------------------------------------------------------------------
create or replace function fn_lead_outbound() returns trigger
language plpgsql
security definer
set search_path = public
as $lead_outbound$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'lead_id', new.id,
    'child_name', coalesce(new.child_name, new.parent_name, ''),
    'trial_at', coalesce(to_char(new.trial_at at time zone 'Asia/Bishkek', 'DD.MM HH24:MI'), '')
  );

  -- Подтверждение записи на пробную.
  if new.stage = 'trial_booked' and new.trial_at is not null
     and (old.stage is distinct from new.stage or old.trial_at is distinct from new.trial_at) then
    perform enqueue_outbound(new.organization_id, 'lead_trial_booked', 'sms',
      new.phone, null, v_payload, 'lead_trial_booked:sms:' || new.id::text || ':' || new.trial_at::text);
    perform enqueue_outbound(new.organization_id, 'lead_trial_booked', 'push',
      null, null, v_payload, 'lead_trial_booked:push:' || new.id::text || ':' || new.trial_at::text);
  end if;

  -- Напоминание за 24 часа.
  if new.reminder_24h_at is not null and old.reminder_24h_at is null then
    perform enqueue_outbound(new.organization_id, 'lead_trial_reminder_24h', 'sms',
      new.phone, null, v_payload, 'lead_reminder_24h:sms:' || new.id::text);
    perform enqueue_outbound(new.organization_id, 'lead_trial_reminder_24h', 'push',
      null, null, v_payload, 'lead_reminder_24h:push:' || new.id::text);
  end if;

  -- Напоминание за 2 часа (по матрице только push).
  if new.reminder_2h_at is not null and old.reminder_2h_at is null then
    perform enqueue_outbound(new.organization_id, 'lead_trial_reminder_2h', 'push',
      null, null, v_payload, 'lead_reminder_2h:push:' || new.id::text);
  end if;

  return new;
end;
$lead_outbound$;

comment on function fn_lead_outbound() is
  'ТЗ §9.1: подтверждение записи на пробную и напоминания за 24ч и 2ч. У лида нет пользователя, поэтому очередь наполняется по телефону напрямую, минуя notifications.';

drop trigger if exists lead_outbound on leads;
create trigger lead_outbound
  after update on leads
  for each row execute function fn_lead_outbound();

-- ---------------------------------------------------------------------
-- 7. «Ребёнок отмечен на тренировке» и «не пришёл» (§9.1)
--
-- Единственные две строки матрицы, которые рождаются не из жизненного
-- цикла, а из действия тренера. Пишем в notifications родителю — дальше
-- их подхватит мост из пункта 5; менеджеру о неявке тоже полагается
-- уведомление, ставим его тем же триггером.
-- ---------------------------------------------------------------------
create or replace function fn_attendance_outbound() returns trigger
language plpgsql
security definer
set search_path = public
as $att_outbound$
declare
  r record;
  v_type text;
begin
  v_type := case
    when new.status in ('present', 'late', 'makeup') then 'child_present'
    when new.status in ('absent', 'excused') then 'child_absent'
    else null
  end;
  if v_type is null then
    return new;
  end if;

  -- Отметку переставляют: приложение тренера сохраняет пачку как
  -- «удалить прежние → вставить», и без этой проверки исправление
  -- ошибки слало бы родителю push повторно. Считаем событие уже
  -- случившимся, если уведомление по этой паре занятие+ребёнок есть.
  if exists (
    select 1 from notifications n
     where n.type in ('child_present', 'child_absent')
       and n.payload ->> 'lesson_id' = new.lesson_id::text
       and n.payload ->> 'child_id' = new.child_id::text
  ) then
    return new;
  end if;

  for r in
    select f.parent_user_id as pid, c.full_name as child_name, c.organization_id,
           c.responsible_manager_id, l.date as lesson_date
      from children c
      join families f on f.id = c.family_id
      join lessons l on l.id = new.lesson_id
     where c.id = new.child_id
       and f.parent_user_id is not null
  loop
    insert into notifications (recipient_id, type, payload)
    values (
      r.pid, v_type,
      jsonb_build_object(
        'child_id', new.child_id,
        'child_name', r.child_name,
        'lesson_id', new.lesson_id,
        'date', to_char(r.lesson_date, 'DD.MM')
      )
    );

    -- §9.1: о неявке узнаёт и менеджер.
    if v_type = 'child_absent' then
      insert into notifications (recipient_id, type, payload)
      select m.id, 'child_absent',
             jsonb_build_object('child_id', new.child_id, 'child_name', r.child_name,
                                'lesson_id', new.lesson_id, 'date', to_char(r.lesson_date, 'DD.MM'))
        from profiles m
       where m.organization_id = r.organization_id
         and m.deleted_at is null
         and (m.id = r.responsible_manager_id
              or (r.responsible_manager_id is null and m.role in ('manager', 'senior_manager')));
    end if;
  end loop;

  return new;
end;
$att_outbound$;

comment on function fn_attendance_outbound() is
  'ТЗ §9.1: «Ребёнок отмечен на тренировке» и «Ребёнок не пришёл» — уведомление родителю, о неявке ещё и менеджеру.';

drop trigger if exists attendance_outbound on attendance;
create trigger attendance_outbound
  after insert on attendance
  for each row execute function fn_attendance_outbound();

notify pgrst, 'reload schema';
