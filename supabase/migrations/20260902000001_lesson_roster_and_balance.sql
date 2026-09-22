-- =====================================================================
-- Состав занятия: единый источник для расписания (админ) и тренера.
--
-- ЖАЛОБА ОФИСА 2026-09-02: в карточке ребёнка видно 3 пропущенных
-- тренировки, а в самом занятии в расписании ребёнка нет — отметить
-- задним числом некого. Причина: модалка занятия строила состав ТОЛЬКО
-- по окну записи (enrollments.start_date/end_date), а окно у части
-- детей устарело (импорт) или было перезаписано продажей нового
-- абонемента (старая версия sell_card_with_deposit). Карточка же
-- ребёнка считает занятия по абонементу — и они расходились.
--
-- Правило состава занятия на дату D (любое из условий):
--   1. окно записи в группу покрывает D;
--   2. у ребёнка есть абонемент (не archived) этой секции, чей срок
--      покрывает D, и он был зачислен в группу не позже D — при этом в
--      ЭТОЙ секции он в день D не числится по окну в другой группе
--      (перешёл в другую группу — в старой не показываем);
--   3. по занятию уже есть отметка (история никогда не прячется).
--
-- security definer: как fn_group_tabel_roster — состав занятия должен
-- видеть любой сотрудник и тренер целиком, manager-scoping не режет.
-- =====================================================================

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
  'Состав занятия: окно записи ИЛИ абонемент секции покрывает дату ИЛИ есть отметка. Обходит manager-scoping.';

grant execute on function public.fn_lesson_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- v_child_card_balance: «был» = present/late/makeup, а не только present.
-- Комментарий к вьюхе и refunds.ts всегда описывали именно это, а
-- фильтр считал только present — опоздание не списывало занятие.
-- На момент миграции late/makeup в базе нет, остатки не меняются.
-- ---------------------------------------------------------------------
drop view if exists v_child_card_balance;
create view v_child_card_balance as
select
  cc.id as club_card_id,
  cc.child_id,
  cc.organization_id,
  cc.type,
  cc.total_lessons,
  cc.start_date,
  cc.end_date,
  cc.status,
  coalesce(att.present_count, 0) as attended_present,
  coalesce(fr.approved_count, 0) as approved_freezes,
  case
    when cc.total_lessons is null then null
    else cc.total_lessons - coalesce(att.present_count, 0)
  end as remaining
from club_cards cc
left join lateral (
  select count(*) filter (where a.status in ('present', 'late', 'makeup')) as present_count
  from attendance a
  join lessons l on l.id = a.lesson_id
  where a.child_id = cc.child_id
    and l.date between cc.start_date and cc.end_date
    and (
      cc.section_id is null
      or exists (
        select 1 from groups g
         where g.id = l.group_id
           and g.section_id = cc.section_id
      )
    )
    and not exists (
      select 1 from freezes f
       where f.club_card_id = cc.id
         and f.status = 'approved'
         and l.date between f.start_date and f.end_date
    )
) att on true
left join (
  select f.club_card_id, count(*) filter (where f.status = 'approved') as approved_count
  from freezes f
  group by f.club_card_id
) fr on fr.club_card_id = cc.id;

comment on view v_child_card_balance is
  'Authoritative source for remaining lessons. «Был» = present/late/makeup по занятиям секции карты в её сроке, без дней approved-freeze. Never compute on frontend.';

grant select on v_child_card_balance to authenticated;

-- ---------------------------------------------------------------------
-- Ремонт окон записи (одноразово, идемпотентно).
--
-- Окно записи — это период членства в группе. Расширяем его только туда,
-- где членство доказано данными:
--   a) есть отметки по занятиям группы раньше start_date / позже end_date
--      → раздвигаем до крайних отмеченных дат;
--   b) окно не покрывает сегодня, а у ребёнка действующий абонемент этой
--      секции и другой группы в секции у него нет → тянем окно до срока
--      абонемента (иначе ребёнок с оплаченной картой пропадает из занятий).
-- ---------------------------------------------------------------------
with att_range as (
  select a.child_id, l.group_id, min(l.date) as min_date, max(l.date) as max_date
    from attendance a
    join lessons l on l.id = a.lesson_id
   group by a.child_id, l.group_id
)
update enrollments e
   set start_date = least(e.start_date, r.min_date),
       end_date   = greatest(e.end_date, r.max_date)
  from att_range r
 where r.child_id = e.child_id
   and r.group_id = e.group_id
   and e.archived_at is null
   and (
     (e.start_date is not null and e.start_date > r.min_date)
     or (e.end_date is not null and e.end_date < r.max_date)
   );

with stale as (
  select e.id,
         min(cc.start_date) as card_start,
         max(cc.end_date)   as card_end
    from enrollments e
    join groups g on g.id = e.group_id
    join club_cards cc
      on cc.child_id = e.child_id
     and cc.status in ('active', 'ending')
     and (cc.section_id is null or cc.section_id = g.section_id)
     and current_date between cc.start_date and cc.end_date
   where e.archived_at is null
     and (e.start_date > current_date or e.end_date < current_date)
     and not exists (
       select 1 from enrollments e2
         join groups g2 on g2.id = e2.group_id
        where e2.child_id = e.child_id
          and e2.id <> e.id
          and e2.archived_at is null
          and g2.section_id = g.section_id
          and (e2.start_date is null or e2.start_date <= current_date)
          and (e2.end_date is null or e2.end_date >= current_date)
     )
   group by e.id
)
update enrollments e
   set start_date = least(e.start_date, s.card_start),
       end_date   = greatest(e.end_date, s.card_end)
  from stale s
 where s.id = e.id;

notify pgrst, 'reload schema';
