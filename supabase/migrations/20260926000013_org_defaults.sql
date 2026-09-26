-- =====================================================================
-- Настройки по умолчанию для организации — фикс молчаливой поломки.
--
-- Проблема, найденная прогоном миграций на чистой базе
-- ---------------------------------------------------
-- Сиды настроек написаны как `insert ... select ... from organizations`,
-- то есть заполняются ТОЛЬКО для организаций, существующих на момент
-- применения миграции. На чистой базе порядок обратный: сначала
-- накатываются миграции, потом заводится организация — и она остаётся
--   • без строки org_settings (скидка 2-го ребёнка, нормативы воронки
--     §8.3, порог оттока §4.5, доля аванса §10.2);
--   • без матрицы каналов §9.1 и без шаблонов сообщений.
--
-- Последствие — худшего сорта: ошибок нет, всё «работает», но
-- уведомления никуда не уходят и скидка не применяется. Обнаружить это
-- можно только по жалобе клиента через несколько недель.
--
-- То же повторится при открытии второго филиала (ТЗ §12.2): новая
-- организация получила бы пустые настройки.
--
-- Решение: дефолты ставит функция, её зовёт триггер на создании
-- организации. Плюс разовый добор для тех, кто уже заведён.
-- =====================================================================

create or replace function seed_organization_defaults(p_org uuid) returns void
language plpgsql
security definer
set search_path = public
as $seed_org$
begin
  -- Настройки клуба: значения по умолчанию описаны в самих колонках
  -- (ТЗ §3.3, §4.5, §8.3, §10.2), поэтому достаточно создать строку.
  insert into org_settings (organization_id)
  values (p_org)
  on conflict (organization_id) do nothing;

  -- Матрица каналов §9.1.
  insert into notification_matrix (organization_id, event_type, channel, audience, enabled)
  select p_org, v.event_type, v.channel, v.audience, v.enabled
  from (values
    ('lead_trial_booked',        'push',  'client', true),
    ('lead_trial_booked',        'sms',   'client', true),
    ('lead_trial_reminder_24h',  'push',  'client', true),
    ('lead_trial_reminder_24h',  'sms',   'client', true),
    ('lead_trial_reminder_2h',   'push',  'client', true),
    ('lead_trial_reminder_2h',   'sms',   'client', false),
    ('child_absent',             'push',  'client', true),
    ('child_absent',             'sms',   'client', false),
    ('child_absent',             'inapp', 'staff',  true),
    ('card_expiring',            'push',  'client', true),
    ('card_expiring',            'sms',   'client', true),
    ('card_renewal_task',        'inapp', 'staff',  true),
    ('card_expired',             'push',  'client', true),
    ('card_expired',             'sms',   'client', true),
    ('card_winback',             'push',  'client', false),
    ('card_winback',             'sms',   'client', true),
    ('lesson.cancelled',         'push',  'client', true),
    ('lesson.cancelled',         'sms',   'client', true),
    ('lesson.rescheduled',       'push',  'client', true),
    ('lesson.rescheduled',       'sms',   'client', true),
    ('freeze.pending',           'inapp', 'staff',  true),
    ('churn_risk',               'inapp', 'staff',  true),
    ('child_present',            'push',  'client', true),
    ('child_present',            'sms',   'client', false)
  ) as v(event_type, channel, audience, enabled)
  on conflict (organization_id, event_type, channel) do nothing;

  -- Шаблоны сообщений клиенту.
  insert into message_templates (organization_id, event_type, channel, body_ru)
  select p_org, v.event_type, v.channel, v.body_ru
  from (values
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
end;
$seed_org$;

comment on function seed_organization_defaults(uuid) is
  'Настройки клуба, матрица каналов §9.1 и шаблоны сообщений для организации. Вызывается триггером при создании организации — иначе новый филиал (§12.2) остаётся без уведомлений молча.';

create or replace function fn_seed_organization_defaults() returns trigger
language plpgsql
security definer
set search_path = public
as $seed_org_trg$
begin
  perform seed_organization_defaults(new.id);
  return new;
end;
$seed_org_trg$;

drop trigger if exists seed_organization_defaults on organizations;
create trigger seed_organization_defaults
  after insert on organizations
  for each row execute function fn_seed_organization_defaults();

-- Добор для организаций, которые уже заведены.
do $$
declare
  r record;
begin
  for r in select id from organizations loop
    perform seed_organization_defaults(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
