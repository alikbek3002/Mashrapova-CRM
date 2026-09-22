-- =====================================================================
-- Снятие тренировок с абонемента («Удалить тренировки»).
--
-- Запрос офиса 2026-09-02: старший менеджер в карточке ребёнка выбирает
-- из предстоящих тренировок те, что нужно убрать, — они пропадают у
-- ребёнка (карточка, журнал, табель тренера, состав занятия), а число
-- занятий абонемента уменьшается на столько же. Занятие группы при этом
-- остаётся для остальных детей.
--
-- Хранится как исключение «ребёнок × занятие» на конкретной карте.
-- Пишет только бэкенд (service role, POST /v1/cards/remove-lessons и
-- /restore-lessons); фронт читает, чтобы прятать даты.
-- =====================================================================

create table if not exists public.card_lesson_exclusions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  club_card_id uuid not null references club_cards(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (child_id, lesson_id)
);

create index if not exists card_lesson_exclusions_lesson_idx on card_lesson_exclusions (lesson_id);
create index if not exists card_lesson_exclusions_child_idx on card_lesson_exclusions (child_id);
create index if not exists card_lesson_exclusions_card_idx on card_lesson_exclusions (club_card_id);

comment on table card_lesson_exclusions is
  'Тренировки, снятые с абонемента ребёнка офисом («Удалить тренировки»). Занятие группы остаётся, у ребёнка его нет.';

alter table card_lesson_exclusions enable row level security;

drop policy if exists cle_staff_read on card_lesson_exclusions;
create policy cle_staff_read on card_lesson_exclusions for select
  using (is_staff() and organization_id = auth_org());

drop policy if exists cle_coach_read on card_lesson_exclusions;
create policy cle_coach_read on card_lesson_exclusions for select
  using (is_coach() and lesson_id in (select coach_lesson_ids()));

drop policy if exists cle_parent_read on card_lesson_exclusions;
create policy cle_parent_read on card_lesson_exclusions for select
  using (is_parent() and child_id in (select parent_child_ids()));

grant select on card_lesson_exclusions to authenticated;

-- ---------------------------------------------------------------------
-- Состав занятия: снятая тренировка убирает ребёнка из занятия (пути
-- «окно» и «карта»); отметка, если она уже есть, по-прежнему показывает.
-- ---------------------------------------------------------------------
drop function if exists public.fn_lesson_roster(uuid);
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
declare
  v_date date;
  v_group uuid;
  v_section uuid;
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

comment on function public.fn_lesson_roster(uuid) is
  'Состав занятия: окно записи ИЛИ абонемент секции покрывает дату ИЛИ есть отметка; минус снятые тренировки (card_lesson_exclusions).';

grant execute on function public.fn_lesson_roster(uuid) to authenticated;

notify pgrst, 'reload schema';
