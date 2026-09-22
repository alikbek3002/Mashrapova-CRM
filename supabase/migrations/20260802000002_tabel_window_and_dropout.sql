-- =====================================================================
-- Табель: срок абонемента как граница отметок + отложенное отчисление.
--
-- 1. Тренер отмечает посещение только внутри срока ребёнка. До первого
--    дня по абонементу его в группе ещё не было, после последнего —
--    абонемент кончился; в табеле эти дни серые, и БД теперь тоже их
--    не принимает (раньше запрет был только в интерфейсе).
--
-- 2. Ребёнок с законченным абонементом ОСТАЁТСЯ в группе: место за ним
--    держится. Отчисляем только в конце месяца и только если он не
--    платит уже месяц. Раньше refresh_lifecycle() архивировал запись
--    на следующий день после конца окна — ребёнок пропадал из группы
--    сразу, хотя мог оплатить через неделю.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Покрыта ли дата занятия сроком ребёнка
--
-- Источник правды тот же, что и в табеле (buildTabelWindow на фронте):
-- карта ИЛИ окно записи в группу. Окно нужно отдельно, потому что при
-- переносе занятия вперёд его продлевают (extendEnrollmentWindowsForMove),
-- а end_date карты — нет: иначе перенесённый урок стал бы неотмечаемым.
--
-- Дети без единой карты (legacy/демо-данные) остаются открытыми — как и
-- везде в системе, NULL-граница означает «ограничения нет».
-- ---------------------------------------------------------------------
create or replace function public.fn_attendance_date_allowed(p_child uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (select 1 from club_cards c where c.child_id = p_child)
    or exists (
      select 1 from club_cards c
       where c.child_id = p_child
         and c.status <> 'archived'
         and p_date between c.start_date and c.end_date
    )
    or exists (
      select 1 from enrollments e
       where e.child_id = p_child
         and e.archived_at is null
         and e.start_date is not null
         and e.end_date is not null
         and p_date between e.start_date and e.end_date
    );
$$;

comment on function public.fn_attendance_date_allowed(uuid, date) is
  'Покрывает ли абонемент (или окно записи) эту дату. Граница отметок посещаемости для тренера.';

-- ---------------------------------------------------------------------
-- 2. Политика тренера: своё занятие + дата не в будущем + внутри срока.
--
-- Менеджера намеренно не трогаем: ему нужно уметь поправить табель
-- задним числом (например, после продажи нового абонемента).
-- ---------------------------------------------------------------------
drop policy if exists attendance_coach_write on attendance;
create policy attendance_coach_write on attendance for all
using (
  is_coach() and exists (
    select 1 from lessons l
    where l.id = attendance.lesson_id
      and l.coach_id = auth.uid()
  )
)
with check (
  is_coach() and exists (
    select 1 from lessons l
    where l.id = attendance.lesson_id
      and l.coach_id = auth.uid()
      and l.date <= current_date
      and public.fn_attendance_date_allowed(attendance.child_id, l.date)
  )
);

-- ---------------------------------------------------------------------
-- 3. refresh_lifecycle — отложенное отчисление из группы.
--
-- Всё остальное (статусы карт, разморозка, группы с истёкшим сроком)
-- сохраняем как в 20260802000001; меняется только последний блок.
--
-- Дата отчисления = конец месяца, следующего за месяцем окончания
-- абонемента: кончился 10.08 → отчисление 30.09. Условие «>=», а не
-- «=», чтобы пропущенный запуск крона не оставлял ребёнка в группе
-- навсегда.
-- ---------------------------------------------------------------------
create or replace function refresh_lifecycle() returns void
language plpgsql security definer as $$
begin
  update club_cards
     set status = 'expired'
   where end_date < current_date
     and status in ('active', 'ending');

  update club_cards
     set status = 'ending'
   where end_date >= current_date
     and end_date <= current_date + interval '5 days'
     and status = 'active';

  update freezes
     set status = 'rejected', rejected_at = now()
   where status = 'approved'
     and end_date is not null
     and end_date < current_date;

  update club_cards cc
     set status = (case when cc.end_date < current_date then 'expired'
                        when cc.end_date <= (current_date + 7) then 'ending'
                        else 'active' end)::card_status
   where cc.status = 'frozen'
     and not exists (
       select 1 from freezes f
        where f.club_card_id = cc.id
          and f.status = 'approved'
          and current_date between f.start_date and coalesce(f.end_date, current_date)
     );

  update club_cards cc
     set status = 'frozen'
   where cc.status in ('active', 'ending')
     and exists (
       select 1 from freezes f
        where f.club_card_id = cc.id
          and f.status = 'approved'
          and current_date between f.start_date and coalesce(f.end_date, current_date)
     );

  -- Отчисление из группы. Ребёнок с законченным абонементом остаётся в
  -- составе: до конца месяца он точно никуда не денется, а уходит лишь
  -- если не оплатил и через месяц. Любая новая карта отменяет отчисление.
  update enrollments e
     set archived_at = now()
   where e.archived_at is null
     and e.end_date is not null
     and current_date >= (
       date_trunc('month', e.end_date::timestamp + interval '1 month')
         + interval '1 month' - interval '1 day'
     )::date
     and not exists (
       select 1 from club_cards cc
        where cc.child_id = e.child_id
          and (cc.status in ('active', 'ending', 'frozen')
               or cc.end_date >= current_date)
     )
     and not exists (
       select 1 from freezes f
        where f.child_id = e.child_id
          and f.status = 'approved'
          and current_date between f.start_date and coalesce(f.end_date, current_date)
     );

  -- Группы с истёкшим сроком существования.
  update groups g
     set is_active = false
   where g.is_active
     and g.ends_on is not null
     and g.ends_on < current_date
     and g.deleted_at is null;
end $$;

notify pgrst, 'reload schema';
