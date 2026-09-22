-- =====================================================================
-- Семантика заморозки — final pass.
--
-- Что фиксим относительно текущего состояния:
--   1. v_child_card_balance считал заморозки как +1 за КАЖДУЮ approved
--      запись (count(*)), а не за реальные «дни внутри окна». Любая
--      заморозка в прошлом задирала remaining → родитель видел врущий
--      остаток. Перепишем формулу: remaining = total_lessons - present,
--      где present считаются ТОЛЬКО вне окон заморозки.
--   2. club_cards.end_date не продлевался на длительность заморозки —
--      абонемент «сгорал» во время freeze. Добавляем триггер: при
--      INSERT/UPDATE freeze со статусом approved сдвигаем end_date
--      на applied_days; при reject из approved — откатываем.
--   3. club_cards.status оставался 'active' во время заморозки. Триггер
--      теперь ставит 'frozen' пока есть хотя бы одна active freeze,
--      и возвращает 'active' / 'ending' (через refresh_lifecycle) после.
--   4. compute_coach_max_payroll включал замороженные дни в «потолок»
--      → тренер видел потенциальную зарплату за дни, которые ему всё
--      равно не оплатят. Исключаем по freeze.
--   5. Backend-страховка: trigger на attendance, отклоняющий INSERT
--      на дату, попадающую в approved-freeze ребёнка.
--   6. Бэкфилл — есть одна реальная approved freeze в проде; применяем
--      эффект (продление end_date + status=frozen) к ней.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Колонка applied_days для идемпотентности триггера.
-- ---------------------------------------------------------------------
alter table freezes
  add column if not exists applied_days int;

comment on column freezes.applied_days is
  'Сколько дней реально продлили club_cards.end_date этой заморозкой. NULL = ещё не применили (например, pending). При early-end пересчитывается.';

-- Индекс под частые SELECT по child_id + date-range, статус approved.
create index if not exists freezes_active_window_idx
  on freezes (child_id, start_date, end_date)
  where status = 'approved';

-- ---------------------------------------------------------------------
-- 2. Триггер: применяем эффект заморозки на club_cards
-- ---------------------------------------------------------------------
create or replace function fn_apply_freeze_to_card()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_new_days int;
  v_old_days int;
  v_diff int;
  v_has_other_active boolean;
begin
  -- INSERT с approved — применяем сразу.
  if tg_op = 'INSERT' and new.status = 'approved' then
    v_new_days := greatest(0, (new.end_date - new.start_date + 1));
    new.applied_days := v_new_days;
    if v_new_days > 0 then
      update club_cards
         set end_date = end_date + v_new_days,
             status = 'frozen'
       where id = new.club_card_id;
    end if;
    return new;
  end if;

  -- INSERT с pending/rejected — ничего не применяем, applied_days = null.
  if tg_op = 'INSERT' then
    new.applied_days := null;
    return new;
  end if;

  -- UPDATE: смотрим переходы статусов.
  if tg_op = 'UPDATE' then
    -- pending → approved: applied впервые.
    if (old.status <> 'approved') and (new.status = 'approved') then
      v_new_days := greatest(0, (new.end_date - new.start_date + 1));
      new.applied_days := v_new_days;
      if v_new_days > 0 then
        update club_cards
           set end_date = end_date + v_new_days,
               status = 'frozen'
         where id = new.club_card_id;
      end if;
      return new;
    end if;

    -- approved → rejected (досрочное завершение). Считаем реально
    -- «прожитые» дни заморозки от start_date до даты завершения.
    -- Если завершили досрочно — продлевали больше, чем нужно, откатываем.
    if (old.status = 'approved') and (new.status = 'rejected') then
      v_old_days := coalesce(old.applied_days, greatest(0, old.end_date - old.start_date + 1));
      -- Сколько по факту прошло заморозки.
      v_new_days := greatest(0, least(
        coalesce((new.rejected_at::date - old.start_date + 1), v_old_days),
        v_old_days
      ));
      v_diff := v_old_days - v_new_days;
      new.applied_days := v_new_days;
      if v_diff > 0 then
        update club_cards
           set end_date = end_date - v_diff
         where id = old.club_card_id;
      end if;
      -- Возвращаем active, если других approved freeze у карты нет.
      select exists (
        select 1 from freezes
         where club_card_id = old.club_card_id
           and status = 'approved'
           and id <> old.id
      ) into v_has_other_active;
      if not v_has_other_active then
        update club_cards
           set status = case when end_date < current_date then 'expired'
                             when end_date <= (current_date + 7) then 'ending'
                             else 'active' end
         where id = old.club_card_id;
      end if;
      return new;
    end if;

    -- approved → approved с изменёнными датами — пересчитываем дельту.
    if (old.status = 'approved') and (new.status = 'approved')
       and (old.start_date <> new.start_date or old.end_date <> new.end_date) then
      v_old_days := coalesce(old.applied_days, greatest(0, old.end_date - old.start_date + 1));
      v_new_days := greatest(0, new.end_date - new.start_date + 1);
      v_diff := v_new_days - v_old_days;
      new.applied_days := v_new_days;
      if v_diff <> 0 then
        update club_cards
           set end_date = end_date + v_diff
         where id = new.club_card_id;
      end if;
      return new;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_freezes_apply on freezes;
create trigger trg_freezes_apply
  before insert or update on freezes
  for each row execute function fn_apply_freeze_to_card();

-- ---------------------------------------------------------------------
-- 3. v_child_card_balance — present считаем ТОЛЬКО вне окон заморозки
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
  select count(*) filter (where a.status = 'present') as present_count
  from attendance a
  join lessons l on l.id = a.lesson_id
  where a.child_id = cc.child_id
    and l.date between cc.start_date and cc.end_date
    -- Игнорируем посещения, попавшие в окно approved-freeze этой карты:
    -- такие занятия «не было», карта продлена.
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
  'Authoritative source for remaining lessons. Present-count исключает дни внутри approved-freeze. Never compute on frontend.';

grant select on v_child_card_balance to authenticated;

-- ---------------------------------------------------------------------
-- 4. compute_coach_max_payroll — исключаем freeze-дни из «потолка»
-- ---------------------------------------------------------------------
create or replace function compute_coach_max_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
set search_path = public
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
      select cc2.id as card_id, cc2.coach_rate_per_lesson
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
     and l.status not in ('cancelled', 'force_majeure')
     -- Дни внутри approved-freeze ребёнка не оплачиваются тренеру.
     and not exists (
       select 1 from freezes f
        where f.club_card_id = cc.card_id
          and f.status = 'approved'
          and l.date between f.start_date and f.end_date
     );
$$;

-- ---------------------------------------------------------------------
-- 5. compute_coach_payroll — то же исключение (страховка на случай
--    «случайной» отметки present в freeze-день).
-- ---------------------------------------------------------------------
create or replace function compute_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(cc.coach_rate_per_lesson), 0)
    from lessons l
    join attendance a
      on a.lesson_id = l.id
     and a.status = 'present'
    join groups g on g.id = l.group_id
    join lateral (
      select cc2.id as card_id, cc2.coach_rate_per_lesson
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
     and l.status not in ('cancelled', 'force_majeure')
     and not exists (
       select 1 from freezes f
        where f.club_card_id = cc.card_id
          and f.status = 'approved'
          and l.date between f.start_date and f.end_date
     );
$$;

-- ---------------------------------------------------------------------
-- 6. Триггер на attendance — блокируем INSERT/UPDATE в freeze-день
-- ---------------------------------------------------------------------
create or replace function fn_block_attendance_in_freeze()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_date date;
begin
  select l.date into v_date from lessons l where l.id = new.lesson_id;
  if v_date is null then
    return new;
  end if;
  if exists (
    select 1 from freezes f
     where f.child_id = new.child_id
       and f.status = 'approved'
       and v_date between f.start_date and f.end_date
  ) then
    raise exception 'Cannot mark attendance during active freeze (%)', v_date
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attendance_block_freeze on attendance;
create trigger trg_attendance_block_freeze
  before insert or update on attendance
  for each row execute function fn_block_attendance_in_freeze();

-- ---------------------------------------------------------------------
-- 7. Backfill: применить эффект к уже существующим approved freezes,
--    у которых applied_days IS NULL (т.е. триггер ещё не отработал).
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_days int;
begin
  for r in
    select * from freezes where status = 'approved' and applied_days is null
  loop
    v_days := greatest(0, r.end_date - r.start_date + 1);
    update freezes set applied_days = v_days where id = r.id;
    if v_days > 0 then
      update club_cards
         set end_date = end_date + v_days,
             status = case
               when current_date between r.start_date and (r.end_date) then 'frozen'
               else status end
       where id = r.club_card_id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. Обновляем кэш схемы PostgREST
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
