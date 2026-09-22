-- =====================================================================
-- Заморозки: доведение до «работает на 100%» + срок жизни группы.
--
-- Что чинится:
--
--  1. Заморозка продлевала club_cards.end_date, но НЕ двигала окно записи
--     ребёнка в группу (enrollments.start_date/end_date). В миграции
--     20260521000001 это было отложено («точный сдвиг окна = Phase 2») и
--     закрыто стоп-гардом «не архивируем, пока карта frozen». Итог: после
--     окончания заморозки карта продлена, а окно записи — нет; ребёнок
--     выпадал из ростера и табеля на те самые доплаченные дни, и особенно
--     заметно это становилось при переносе занятий (перенесённый урок
--     уезжал за границу окна). Теперь окно двигается вместе с картой.
--
--  2. Карта помечалась 'frozen' сразу при создании заморозки, даже если
--     заморозка начинается через месяц. Из-за этого абонемент выглядел
--     замороженным заранее, а UI, который ищет карты со статусом 'active',
--     переставал их находить. Теперь 'frozen' ставится, только когда
--     окно заморозки покрывает сегодняшний день.
--
--  3. Не было защиты от пересекающихся заморозок по одной карте: две
--     approved-записи на один период продлевали end_date дважды.
--
--  4. groups: появился срок жизни группы (starts_on / ends_on) — группу
--     набирают на год-два, после чего занятия по ней генерировать нельзя.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Срок жизни группы
-- ---------------------------------------------------------------------
alter table groups add column if not exists starts_on date;
alter table groups add column if not exists ends_on   date;

comment on column groups.starts_on is
  'С какой даты группа работает. NULL = без ограничения снизу.';
comment on column groups.ends_on is
  'До какой даты группа существует (включительно). Занятия за этой датой не генерируются. NULL = бессрочно.';

alter table groups drop constraint if exists groups_term_valid;
alter table groups add constraint groups_term_valid
  check (starts_on is null or ends_on is null or ends_on >= starts_on);

-- ---------------------------------------------------------------------
-- 1. Сдвиг окон записи ребёнка вместе с картой
--
-- p_days > 0 — продлеваем (заморозка применена),
-- p_days < 0 — откатываем (заморозка завершена досрочно / укорочена).
--
-- Двигаем только те окна, которые ещё «живы» на момент начала заморозки
-- (end_date >= p_from): завершённые до заморозки записи трогать не за что.
-- Если у карты указана секция — ограничиваемся группами этой секции,
-- чтобы заморозка гимнастики не растягивала окно записи в дзюдо.
-- ---------------------------------------------------------------------
create or replace function fn_shift_enrollment_window(
  p_child uuid,
  p_section uuid,
  p_from date,
  p_days int
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_days = 0 or p_child is null then
    return;
  end if;

  update enrollments e
     set end_date = e.end_date + p_days
   where e.child_id = p_child
     and e.archived_at is null
     and e.end_date is not null
     and e.end_date >= p_from
     and (
       p_section is null
       or exists (
         select 1 from groups g
          where g.id = e.group_id and g.section_id = p_section
       )
     );

  -- Запись, которая ещё не началась к моменту заморозки, едет целиком.
  update enrollments e
     set start_date = e.start_date + p_days
   where e.child_id = p_child
     and e.archived_at is null
     and e.start_date is not null
     and e.start_date >= p_from
     and (
       p_section is null
       or exists (
         select 1 from groups g
          where g.id = e.group_id and g.section_id = p_section
       )
     );
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Триггер применения заморозки — v2
--
-- Отличия от версии 20260522000005:
--   • вместе с club_cards.end_date двигает окно записи в группу;
--   • статус 'frozen' ставится, только если окно покрывает сегодня;
--   • при откате возвращает карте корректный статус.
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
  v_section uuid;
  v_child uuid;
begin
  select cc.section_id, cc.child_id into v_section, v_child
    from club_cards cc where cc.id = coalesce(new.club_card_id, old.club_card_id);
  -- freeze.child_id — источник правды: карта могла быть не найдена.
  v_child := coalesce(v_child, new.child_id, old.child_id);

  -- INSERT с approved — применяем сразу.
  if tg_op = 'INSERT' and new.status = 'approved' then
    v_new_days := greatest(0, (new.end_date - new.start_date + 1));
    new.applied_days := v_new_days;
    if v_new_days > 0 then
      update club_cards
         set end_date = end_date + v_new_days,
             status = case
               when current_date between new.start_date and new.end_date then 'frozen'
               else status end
       where id = new.club_card_id;
      perform fn_shift_enrollment_window(v_child, v_section, new.start_date, v_new_days);
    end if;
    return new;
  end if;

  -- INSERT с pending/rejected — эффекта нет.
  if tg_op = 'INSERT' then
    new.applied_days := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- pending → approved: применяем впервые.
    if (old.status <> 'approved') and (new.status = 'approved') then
      v_new_days := greatest(0, (new.end_date - new.start_date + 1));
      new.applied_days := v_new_days;
      if v_new_days > 0 then
        update club_cards
           set end_date = end_date + v_new_days,
               status = case
                 when current_date between new.start_date and new.end_date then 'frozen'
                 else status end
         where id = new.club_card_id;
        perform fn_shift_enrollment_window(v_child, v_section, new.start_date, v_new_days);
      end if;
      return new;
    end if;

    -- approved → rejected. Два разных сценария:
    --   • досрочное завершение (rejected_at внутри окна) — откатываем
    --     разницу между «продлили» и «реально прожили»;
    --   • естественное закрытие из refresh_lifecycle (rejected_at после
    --     end_date) — дельта нулевая, ничего не откатываем.
    if (old.status = 'approved') and (new.status = 'rejected') then
      v_old_days := coalesce(old.applied_days, greatest(0, old.end_date - old.start_date + 1));
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
        perform fn_shift_enrollment_window(v_child, v_section, old.start_date, -v_diff);
      end if;

      select exists (
        select 1 from freezes
         where club_card_id = old.club_card_id
           and status = 'approved'
           and id <> old.id
           and current_date between start_date and end_date
      ) into v_has_other_active;
      if not v_has_other_active then
        -- ::card_status обязателен: CASE со строковыми литералами выводит
        -- text, а столбец — enum (та же грабля, что в 20260525000001).
        update club_cards
           set status = (case when end_date < current_date then 'expired'
                              when end_date <= (current_date + 7) then 'ending'
                              else 'active' end)::card_status
         where id = old.club_card_id
           and status = 'frozen';
      end if;
      return new;
    end if;

    -- approved → approved со сдвинутыми датами — применяем дельту.
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
        perform fn_shift_enrollment_window(v_child, v_section, least(old.start_date, new.start_date), v_diff);
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
-- 3. Защита от пересекающихся approved-заморозок по одной карте.
--    Без неё две записи на один период продлевали абонемент дважды.
--    Отдельным триггером (а не EXCLUDE-констрейнтом), чтобы ограничение
--    касалось только approved: pending-заявок может быть сколько угодно.
-- ---------------------------------------------------------------------
create or replace function fn_freezes_no_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'approved' then
    return new;
  end if;
  -- Записи без дат (legacy: заморозки заводились до появления окна) окна не
  -- занимают и эффекта на карту не оказывают. Через daterange NULL-границы
  -- дали бы «бесконечный» интервал, который пересекается со всем и намертво
  -- заблокировал бы новые заморозки по этой карте.
  if new.start_date is null or new.end_date is null then
    return new;
  end if;
  if exists (
    select 1 from freezes f
     where f.club_card_id = new.club_card_id
       and f.status = 'approved'
       and f.id <> new.id
       and f.start_date is not null
       and f.end_date is not null
       and daterange(f.start_date, f.end_date, '[]')
           && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'freeze_overlaps_existing'
      using errcode = '23505',
            hint = 'На этот абонемент уже есть действующая заморозка на пересекающийся период.';
  end if;
  return new;
end;
$$;

-- Имя с «aa» — чтобы сработать раньше trg_freezes_apply: BEFORE-триггеры
-- выполняются в алфавитном порядке, и проверку дешевле сделать до того,
-- как apply-триггер начнёт двигать карту и окна записи.
drop trigger if exists trg_freezes_no_overlap on freezes;
drop trigger if exists trg_freezes_aa_no_overlap on freezes;
create trigger trg_freezes_aa_no_overlap
  before insert or update on freezes
  for each row execute function fn_freezes_no_overlap();

-- ---------------------------------------------------------------------
-- 4. refresh_lifecycle
--   • карта размораживается, когда сегодня уже вне окна заморозки
--     (раньше сравнивали только с end_date, и будущая заморозка держала
--     карту в 'frozen' заранее);
--   • окно записи не архивируем, пока действует заморозка;
--   • группы с истёкшим сроком помечаем неактивными.
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

  -- Заморозки, чьё окно прошло, закрываем. Триггер увидит rejected_at
  -- позже end_date и не будет ничего откатывать.
  update freezes
     set status = 'rejected', rejected_at = now()
   where status = 'approved'
     and end_date is not null
     and end_date < current_date;

  -- Карта в заморозке ↔ сегодня внутри окна активной заморозки.
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

  -- Авто-выход из группы по истёкшему окну. Не трогаем детей, у которых
  -- есть действующая заморозка: их окно ещё будет сдвинуто.
  update enrollments e
     set archived_at = now()
   where e.archived_at is null
     and e.end_date is not null
     and e.end_date < current_date
     and not exists (
       select 1 from club_cards cc
        where cc.child_id = e.child_id and cc.status = 'frozen'
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

-- ---------------------------------------------------------------------
-- 5. Бэкфилл окон записи под уже применённые заморозки.
--    Берём approved/завершённые заморозки с applied_days > 0, у которых
--    окно записи ещё не двигали. Признак «не двигали» вывести неоткуда,
--    поэтому идём по действующим заморозкам (status='approved'): именно
--    они сейчас держат окна на стоп-гарде и сломаются после разморозки.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select f.id, f.child_id, f.start_date, f.applied_days, cc.section_id
      from freezes f
      join club_cards cc on cc.id = f.club_card_id
     where f.status = 'approved'
       and coalesce(f.applied_days, 0) > 0
  loop
    perform fn_shift_enrollment_window(r.child_id, r.section_id, r.start_date, r.applied_days);
  end loop;
end $$;

notify pgrst, 'reload schema';
