-- =====================================================================
-- Зарплата тренера: посещения, отмеченные тренером, не попадали в факт.
--
-- Жалоба офиса 2026-09-02: «система показывает не фактическую сумму».
-- Причина: триггер trg_attendance_complete_lesson (attendance →
-- lessons.status = 'completed') работал с правами вызывающего, а у
-- тренера нет UPDATE-политики на lessons — update молча обновлял 0
-- строк, занятие оставалось 'scheduled'. compute_coach_payroll считала
-- только l.status = 'completed' → всё, что отметил сам тренер, в
-- «заработано» не входило (02.09: 11 занятий, ~90 посещений, 0 сом).
--
-- Фикс: (1) триггер — security definer; (2) формула зарплаты не зависит
-- от статуса занятия: любое не отменённое занятие с отметкой «пришёл»
-- (present/late/makeup, как считает и остаток абонемента); (3) ремонт —
-- прошедшие занятия с отметками получают статус 'completed'.
-- =====================================================================

create or replace function public.fn_mark_lesson_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update lessons
     set status = 'completed'
   where id = new.lesson_id
     and status = 'scheduled';
  return new;
end;
$$;

create or replace function public.compute_coach_payroll(p_coach uuid, p_from date, p_to date)
returns numeric
language sql
stable
security definer
as $$
  select coalesce(sum(g.coach_rate_per_child), 0)
    from lessons l
    join attendance a
      on a.lesson_id = l.id
     and a.status in ('present', 'late', 'makeup')
    join groups g on g.id = l.group_id
   where l.coach_id = p_coach
     and l.date between p_from and p_to
     and l.type <> 'trial'
     and l.status not in ('cancelled', 'force_majeure');
$$;

comment on function public.compute_coach_payroll(uuid, date, date) is
  'Факт зарплаты тренера: ставка группы × отметки «пришёл» (present/late/makeup) на не отменённых занятиях тренера за период. Статус completed не требуется.';

-- Ремонт: прошедшие занятия с отметками — проведены.
update lessons l
   set status = 'completed'
 where l.status = 'scheduled'
   and l.date <= (now() at time zone 'Asia/Bishkek')::date
   and exists (select 1 from attendance a where a.lesson_id = l.id);

notify pgrst, 'reload schema';
