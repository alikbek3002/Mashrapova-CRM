-- =====================================================================
-- Фикс расчёта зарплаты: убираем требование l.status = 'completed' в
-- compute_coach_payroll. На некоторых средах триггер
-- fn_mark_lesson_completed (миграция 20260510000004) мог не примениться,
-- и тогда даже отмеченные посещения не попадают в зарплату — функция
-- возвращает 0 при наличии реальных present-отметок.
--
-- Новое условие: учитываем все занятия, кроме явно отменённых
-- ('cancelled', 'force_majeure'). Логика смысловая: тренер провёл
-- занятие и отметил ребёнка как present → платим, независимо от того,
-- стоит ли у lesson флаг completed.
--
-- Project-функция не трогается — там фильтр l.status='scheduled'
-- осмыслен (прогноз = только будущие, ещё не проведённые занятия).
-- =====================================================================

create or replace function compute_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
as $$
  select coalesce(sum(cc.coach_rate_per_lesson), 0)
    from lessons l
    join attendance a
      on a.lesson_id = l.id
     and a.status = 'present'
    join groups g on g.id = l.group_id
    join lateral (
      select cc2.coach_rate_per_lesson
        from club_cards cc2
       where cc2.child_id = a.child_id
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
     and l.type <> 'trial'
     and l.status not in ('cancelled', 'force_majeure');
$$;
