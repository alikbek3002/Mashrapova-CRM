-- =====================================================================
-- project_coach_payroll: не считаем тех детей, кому отметка УЖЕ
-- проставлена на этом уроке.
--
-- Сценарий двойного счёта (если триггер fn_mark_lesson_completed
-- не применён): сегодняшний урок остаётся `scheduled` даже после
-- части present-отметок. compute уже учитывает present (по факту),
-- а project всё ещё суммировал ВСЕХ enrolled — в т.ч. тех самых
-- present, что давало двойной счёт в «Итого».
--
-- Исправляем: project пропускает (lesson, child), если в attendance
-- уже есть строка по этой паре — независимо от её статуса.
-- =====================================================================

create or replace function project_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
as $$
  select coalesce(sum(cc.coach_rate_per_lesson), 0)
    from lessons l
    join groups g on g.id = l.group_id
    join enrollments e
      on e.group_id = l.group_id
     and e.archived_at is null
     and (e.start_date is null or e.start_date <= l.date)
     and (e.end_date   is null or e.end_date   >= l.date)
    join lateral (
      select cc2.coach_rate_per_lesson
        from club_cards cc2
       where cc2.child_id = e.child_id
         and cc2.status in ('active', 'ending', 'frozen')
         and l.date between cc2.start_date and cc2.end_date
         and (cc2.section_id is null or cc2.section_id = g.section_id)
       order by
         case
           when cc2.section_id = g.section_id then 0
           when cc2.section_id is null then 1
           else 2
         end,
         cc2.created_at desc
       limit 1
    ) cc on true
   where l.coach_id = p_coach
     and l.date between p_from and p_to
     and l.date >= current_date
     and l.type <> 'trial'
     and l.status not in ('cancelled', 'force_majeure')
     -- Защита от двойного счёта: если по этому уроку для этого
     -- ребёнка УЖЕ есть отметка — её учитывает compute_coach_payroll,
     -- здесь повторно не суммируем.
     and not exists (
       select 1 from attendance a
        where a.lesson_id = l.id
          and a.child_id  = e.child_id
     );
$$;
