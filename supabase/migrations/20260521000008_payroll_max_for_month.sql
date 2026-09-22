-- =====================================================================
-- compute_coach_max_payroll(coach, from, to) — потенциальный максимум
-- ставки тренера за период, если КАЖДЫЙ зачисленный ребёнок пришёл бы
-- на ВСЕ занятия в этом периоде (прошлые + будущие).
--
-- Зачем: «Итого за месяц» = факт + прогноз приводил к ощущению что
-- 900 (накапало) + 7000 (прогноз) = 7900 — выше потолка 7000.
-- Это сбивало логику для пользователя: «накапало» и «прогноз» вообще
-- не должны складываться, у них общий потолок — это и есть максимум.
--
-- Меняем v_coach_live_payroll: вместо projected_amount теперь
-- max_amount = compute_coach_max_payroll. UI покажет:
--   actual_amount / max_amount — прогресс по шкале «из X сом».
-- =====================================================================

create or replace function compute_coach_max_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
as $$
  -- Для каждого занятия за период считаем сумму ставок по всем
  -- enrolment-card парам, у которых карта покрывает дату занятия.
  -- Без фильтра на attendance — это потолок, max-сценарий.
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
         and cc2.status in ('active', 'ending', 'frozen', 'expired')
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

-- View обновляем: max_amount + пересчитанный projected.
-- DROP перед CREATE: create-or-replace не пропустит добавление
-- колонки не в конце.
drop view if exists v_coach_live_payroll;
create view v_coach_live_payroll as
  select
    p.id as coach_id,
    p.organization_id,
    p.full_name,
    date_trunc('month', current_date)::date as period_start,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date as period_end,
    compute_coach_payroll(
      p.id,
      date_trunc('month', current_date)::date,
      current_date
    ) as actual_amount,
    compute_coach_max_payroll(
      p.id,
      date_trunc('month', current_date)::date,
      (date_trunc('month', current_date) + interval '1 month - 1 day')::date
    ) as max_amount,
    -- Прогноз оставляем для обратной совместимости: max - actual.
    -- Это и есть «сколько ещё может прийти», без двойного счёта.
    greatest(
      0,
      compute_coach_max_payroll(
        p.id,
        date_trunc('month', current_date)::date,
        (date_trunc('month', current_date) + interval '1 month - 1 day')::date
      ) - compute_coach_payroll(
        p.id,
        date_trunc('month', current_date)::date,
        current_date
      )
    ) as projected_amount
    from profiles p
   where p.role = 'coach'
     and p.deleted_at is null;

grant select on v_coach_live_payroll to authenticated;
