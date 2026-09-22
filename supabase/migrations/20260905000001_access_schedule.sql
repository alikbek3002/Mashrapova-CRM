-- =====================================================================
-- Турникеты × расписание: окна доступа и авто-выход.
--
-- Решение «пускать/не пускать» принимает сам терминал Hikvision через
-- срок действия персоны (UserInfo.Valid, точность до секунды). Backend
-- раз в минуту выставляет каждому ребёнку окно «ближайшее занятие сегодня
-- −N мин … конец +M мин» (см. backend/src/lib/hik-access-windows.ts).
--
-- Здесь: настройки режима, таблица отправленных окон (ребёнок × терминал),
-- новые типы событий журнала и RPC состава дня для планировщика.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Настройки режима (org_settings)
-- ---------------------------------------------------------------------
alter table org_settings
  add column if not exists access_schedule_enabled boolean not null default false,
  add column if not exists access_before_min int not null default 15
    check (access_before_min between 0 and 180),
  add column if not exists access_after_min int not null default 15
    check (access_after_min between 0 and 180),
  add column if not exists access_auto_exit_hours int not null default 5
    check (access_auto_exit_hours between 1 and 24);

comment on column org_settings.access_schedule_enabled is
  'Проходная по расписанию: детям выставляется срок действия на терминале = окно занятия. Выкл = бессрочный доступ.';
comment on column org_settings.access_before_min is 'За сколько минут до начала занятия пускать.';
comment on column org_settings.access_after_min is 'Сколько минут после конца занятия разрешён проход (вход и выход).';
comment on column org_settings.access_auto_exit_hours is
  'Через сколько часов после конца занятия ребёнок без выхода автоматически считается вышедшим.';

-- ---------------------------------------------------------------------
-- 2. Журнал: синтетический выход и отказ терминала
-- ---------------------------------------------------------------------
alter table access_events drop constraint if exists access_events_event_type_check;
alter table access_events add constraint access_events_event_type_check
  check (event_type in ('face_ok','face_fail','card_ok','other','auto_out','denied'));

-- ---------------------------------------------------------------------
-- 3. Отправленные окна: что реально выставлено на каждом терминале
-- ---------------------------------------------------------------------
create table if not exists access_grants (
  child_id uuid not null references children(id) on delete cascade,
  device_serial text not null,
  state text not null check (state in ('window','none','unrestricted')),
  valid_from timestamptz,                 -- окно (state = window)
  valid_until timestamptz,
  pushed_at timestamptz not null default now(),
  error text,                             -- последняя ошибка отправки (null = ок)
  primary key (child_id, device_serial)
);

comment on table access_grants is
  'Срок действия (Valid), выставленный ребёнку на терминале. window = окно занятия; none = доступа сегодня нет; unrestricted = бессрочно (режим выключен).';

create index if not exists access_grants_device on access_grants (device_serial);

alter table access_grants enable row level security;

drop policy if exists access_grants_staff_select on access_grants;
create policy access_grants_staff_select on access_grants for select
  using (is_staff());
-- пишет только service role (backend)

-- ---------------------------------------------------------------------
-- 4. Состав занятия без проверки прав — для планировщика (service role,
--    auth.uid() отсутствует). fn_lesson_roster остаётся публичным
--    интерфейсом с проверкой прав и тем же результатом.
-- ---------------------------------------------------------------------
create or replace function public.fn_lesson_roster_core(p_lesson_id uuid)
returns table (
  child_id uuid,
  full_name text,
  card_number text,
  photo_path text,
  enrollment_id uuid,
  via text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_date date;
  v_group uuid;
  v_section uuid;
begin
  select l.date, l.group_id, g.section_id
    into v_date, v_group, v_section
    from lessons l
    join groups g on g.id = l.group_id
   where l.id = p_lesson_id;
  if v_date is null then
    return;
  end if;

  return query
  with cand as (
    -- 1. окно записи
    select e.child_id, e.id as enrollment_id, 'window'::text as via, 1 as prio
      from enrollments e
     where e.group_id = v_group
       and e.archived_at is null
       and (e.start_date is null or e.start_date <= v_date)
       and (e.end_date is null or e.end_date >= v_date)
       and not exists (
         select 1 from card_lesson_exclusions x
          where x.child_id = e.child_id and x.lesson_id = p_lesson_id
       )
    union all
    -- 2. абонемент секции покрывает дату
    select e.child_id, e.id, 'card'::text, 2
      from enrollments e
     where e.group_id = v_group
       and e.archived_at is null
       and v_date >= (e.enrolled_at at time zone 'Asia/Bishkek')::date
       and exists (
         select 1 from club_cards c
          where c.child_id = e.child_id
            and c.status <> 'archived'
            and v_date between c.start_date and c.end_date
            and (c.section_id is null or c.section_id = v_section)
       )
       and not exists (
         select 1 from enrollments e2
           join groups g2 on g2.id = e2.group_id
          where e2.child_id = e.child_id
            and e2.group_id <> v_group
            and e2.archived_at is null
            and g2.section_id = v_section
            and e2.start_date is not null and e2.start_date <= v_date
            and (e2.end_date is null or e2.end_date >= v_date)
       )
       and not exists (
         select 1 from card_lesson_exclusions x
          where x.child_id = e.child_id and x.lesson_id = p_lesson_id
       )
    union all
    -- 3. отметка уже стоит
    select a.child_id, null::uuid, 'attendance'::text, 3
      from attendance a
     where a.lesson_id = p_lesson_id
  ),
  best as (
    select distinct on (c.child_id) c.child_id, c.enrollment_id, c.via
      from cand c
     order by c.child_id, c.prio
  )
  select b.child_id, ch.full_name, ch.card_number, ch.photo_path, b.enrollment_id, b.via
    from best b
    join children ch on ch.id = b.child_id and ch.deleted_at is null
   order by ch.full_name;
end;
$$;

revoke all on function public.fn_lesson_roster_core(uuid) from public;
grant execute on function public.fn_lesson_roster_core(uuid) to service_role;

comment on function public.fn_lesson_roster_core(uuid) is
  'Состав занятия БЕЗ проверки прав — вызывать только из fn_lesson_roster и планировщика (service role).';

create or replace function public.fn_lesson_roster(p_lesson_id uuid)
returns table (
  child_id uuid,
  full_name text,
  card_number text,
  photo_path text,
  enrollment_id uuid,
  via text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    is_staff()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'coach' and p.is_active
    )
  ) then
    raise exception 'forbidden';
  end if;
  return query select * from public.fn_lesson_roster_core(p_lesson_id);
end;
$$;

grant execute on function public.fn_lesson_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Окна дня для проходной: занятия (группы + ПТ) детей с номером на
--    проходной. Время — UTC (timestamptz); паддинги добавляет backend.
-- ---------------------------------------------------------------------
create or replace function public.fn_access_windows(p_date date)
returns table (
  child_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  source text,
  ref_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  -- групповые занятия
  select r.child_id,
         (l.date + l.start_time) at time zone 'Asia/Bishkek' as starts_at,
         ((l.date + l.start_time) at time zone 'Asia/Bishkek') + make_interval(mins => l.duration_min) as ends_at,
         'lesson'::text as source,
         l.id as ref_id
    from lessons l
    cross join lateral public.fn_lesson_roster_core(l.id) r
    join children ch on ch.id = r.child_id
   where l.date = p_date
     and l.status in ('scheduled', 'completed')
     and ch.access_person_no is not null
     and ch.deleted_at is null
  union all
  -- персональные тренировки
  select pl.child_id,
         (s.date + s.start_time) at time zone 'Asia/Bishkek',
         ((s.date + s.start_time) at time zone 'Asia/Bishkek') + make_interval(mins => coalesce(s.duration_min, 60)),
         'pt'::text,
         pl.id
    from pt_lessons pl
    join pt_sessions s on s.id = pl.session_id
    join children ch on ch.id = pl.child_id
   where s.date = p_date
     and s.status not in ('cancelled', 'rescheduled')
     and pl.status not in ('cancelled', 'rescheduled')
     and ch.access_person_no is not null
     and ch.deleted_at is null;
$$;

revoke all on function public.fn_access_windows(date) from public;
grant execute on function public.fn_access_windows(date) to service_role;

comment on function public.fn_access_windows(date) is
  'Занятия дня (группы по fn_lesson_roster_core + ПТ) детей с номером на проходной — источник окон доступа для терминалов.';

notify pgrst, 'reload schema';
