-- =====================================================================
-- История группы: кто и когда менял тренера, расписание и состав.
--
-- Отдельная таблица событий (audit_log покрывает только cards/payments/
-- freezes/lessons и хранит сырые json-снапшоты — для «истории группы
-- человеческим языком» нужен свой журнал). События пишут триггеры —
-- неважно, откуда пришло изменение (UI, бэкенд, скрипт), история полная.
--
-- Имена (тренеров, детей) денормализуются в payload при записи: история
-- остаётся читаемой, даже если сущность потом удалят.
--
-- Типы событий:
--   coach_changed      — сменили основного тренера группы
--   coach_substituted  — замена тренера на одно занятие
--   schedule_slot_added / schedule_slot_removed — правка расписания
--   child_added / child_removed / child_returned — состав
--   renamed / activated / deactivated — прочие правки группы
-- =====================================================================

create table if not exists group_events (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  group_id uuid not null references groups(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists group_events_group_idx
  on group_events (group_id, created_at desc);

alter table group_events enable row level security;

-- Читает офис и тренер; пишут только триггеры (security definer),
-- insert-политики нет намеренно.
drop policy if exists group_events_staff_read on group_events;
create policy group_events_staff_read on group_events for select
using (
  organization_id = auth_org()
  and (is_staff() or is_coach())
);

-- ---------------------------------------------------------------------
-- Хелперы
-- ---------------------------------------------------------------------
create or replace function fn_ge_actor() returns uuid
language plpgsql stable as $$
declare a uuid;
begin
  a := auth.uid();
  if a is null then
    begin
      a := nullif(current_setting('app.actor_id', true), '')::uuid;
    exception when others then a := null;
    end;
  end if;
  return a;
end $$;

create or replace function fn_ge_profile_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select full_name from profiles where id = p_id
$$;

create or replace function fn_ge_child_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select full_name from children where id = p_id
$$;

-- ---------------------------------------------------------------------
-- 1. groups: смена тренера / имени / активности
-- ---------------------------------------------------------------------
create or replace function fn_ge_on_group_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.coach_id is distinct from old.coach_id then
    insert into group_events (organization_id, group_id, type, payload, actor_id)
    values (new.organization_id, new.id, 'coach_changed', jsonb_build_object(
      'old_coach_id', old.coach_id,
      'old_coach_name', fn_ge_profile_name(old.coach_id),
      'new_coach_id', new.coach_id,
      'new_coach_name', fn_ge_profile_name(new.coach_id)
    ), fn_ge_actor());
  end if;
  if new.name is distinct from old.name then
    insert into group_events (organization_id, group_id, type, payload, actor_id)
    values (new.organization_id, new.id, 'renamed',
      jsonb_build_object('old_name', old.name, 'new_name', new.name), fn_ge_actor());
  end if;
  if new.is_active is distinct from old.is_active then
    insert into group_events (organization_id, group_id, type, payload, actor_id)
    values (new.organization_id, new.id,
      case when new.is_active then 'activated' else 'deactivated' end,
      '{}'::jsonb, fn_ge_actor());
  end if;
  return new;
end $$;

drop trigger if exists trg_ge_group_update on groups;
create trigger trg_ge_group_update
  after update on groups
  for each row execute function fn_ge_on_group_update();

-- ---------------------------------------------------------------------
-- 2. group_schedule: слоты расписания
-- ---------------------------------------------------------------------
create or replace function fn_ge_on_schedule() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_gid uuid;
begin
  v_gid := coalesce(new.group_id, old.group_id);
  select organization_id into v_org from groups where id = v_gid;
  if v_org is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    insert into group_events (organization_id, group_id, type, payload, actor_id)
    values (v_org, v_gid, 'schedule_slot_added', jsonb_build_object(
      'day_of_week', new.day_of_week, 'start_time', new.start_time, 'duration_min', new.duration_min
    ), fn_ge_actor());
    return new;
  elsif tg_op = 'DELETE' then
    insert into group_events (organization_id, group_id, type, payload, actor_id)
    values (v_org, v_gid, 'schedule_slot_removed', jsonb_build_object(
      'day_of_week', old.day_of_week, 'start_time', old.start_time, 'duration_min', old.duration_min
    ), fn_ge_actor());
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_ge_schedule on group_schedule;
create trigger trg_ge_schedule
  after insert or delete on group_schedule
  for each row execute function fn_ge_on_schedule();

-- ---------------------------------------------------------------------
-- 3. enrollments: состав группы
-- ---------------------------------------------------------------------
create or replace function fn_ge_on_enrollment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from groups where id = new.group_id;
  if v_org is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.archived_at is null then
      insert into group_events (organization_id, group_id, type, payload, actor_id)
      values (v_org, new.group_id, 'child_added', jsonb_build_object(
        'child_id', new.child_id, 'child_name', fn_ge_child_name(new.child_id),
        'start_date', new.start_date, 'end_date', new.end_date
      ), fn_ge_actor());
    end if;
  elsif tg_op = 'UPDATE' then
    if old.archived_at is null and new.archived_at is not null then
      insert into group_events (organization_id, group_id, type, payload, actor_id)
      values (v_org, new.group_id, 'child_removed', jsonb_build_object(
        'child_id', new.child_id, 'child_name', fn_ge_child_name(new.child_id)
      ), fn_ge_actor());
    elsif old.archived_at is not null and new.archived_at is null then
      insert into group_events (organization_id, group_id, type, payload, actor_id)
      values (v_org, new.group_id, 'child_returned', jsonb_build_object(
        'child_id', new.child_id, 'child_name', fn_ge_child_name(new.child_id)
      ), fn_ge_actor());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ge_enrollment on enrollments;
create trigger trg_ge_enrollment
  after insert or update on enrollments
  for each row execute function fn_ge_on_enrollment();

-- ---------------------------------------------------------------------
-- 4. lessons: замена тренера на конкретное занятие.
--    Пишем событие, только если тренер занятия стал ОТЛИЧАТЬСЯ от
--    основного тренера группы — массовый каскад при пермяк-смене
--    (уроки выравниваются под нового основного) события не плодит.
-- ---------------------------------------------------------------------
create or replace function fn_ge_on_lesson_coach() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_main uuid;
  v_eff_old uuid;
  v_eff_new uuid;
begin
  v_eff_old := coalesce(old.substitute_coach_id, old.coach_id);
  v_eff_new := coalesce(new.substitute_coach_id, new.coach_id);
  if v_eff_new is distinct from v_eff_old then
    select coach_id into v_main from groups where id = new.group_id;
    if v_eff_new is distinct from v_main then
      insert into group_events (organization_id, group_id, type, payload, actor_id)
      values (new.organization_id, new.group_id, 'coach_substituted', jsonb_build_object(
        'lesson_id', new.id, 'date', new.date, 'start_time', new.start_time,
        'old_coach_id', v_eff_old, 'old_coach_name', fn_ge_profile_name(v_eff_old),
        'new_coach_id', v_eff_new, 'new_coach_name', fn_ge_profile_name(v_eff_new)
      ), fn_ge_actor());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ge_lesson_coach on lessons;
create trigger trg_ge_lesson_coach
  after update on lessons
  for each row execute function fn_ge_on_lesson_coach();

notify pgrst, 'reload schema';
