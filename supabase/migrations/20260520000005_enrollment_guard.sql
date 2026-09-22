-- =====================================================================
-- Жёсткий запрет на уровне БД: нельзя записать ребёнка в группу без
-- активного (оплаченного) абонемента именно на секцию этой группы.
--
-- Раньше проверка была только клиентской (validateEnrollment в JS).
-- Это защищало UI, но не БД: при старой версии фронта или прямом insert
-- ребёнок попадал в группу без абонемента. Теперь правило — инвариант СУБД.
--
-- Срабатывает на INSERT активной записи (archived_at IS NULL).
-- Карта должна быть status IN ('active','ending') И section_id = секции группы.
-- Legacy-карты без секции и карты на другие секции — не подходят.
-- =====================================================================

create or replace function fn_guard_enrollment() returns trigger
language plpgsql security definer
as $guard_enroll$
declare
  v_group_section uuid;
  v_has_match boolean;
  v_has_any boolean;
begin
  -- Архивные записи (снятие с группы / история) не проверяем.
  if new.archived_at is not null then
    return new;
  end if;

  select section_id into v_group_section from groups where id = new.group_id;

  -- Есть ли у ребёнка активная/ending карта именно на секцию группы?
  select exists (
    select 1 from club_cards
    where child_id = new.child_id
      and status in ('active', 'ending')
      and section_id is not null
      and section_id = v_group_section
  ) into v_has_match;

  if v_has_match then
    return new;
  end if;

  -- Совпадения нет. Уточняем причину для понятного сообщения.
  select exists (
    select 1 from club_cards
    where child_id = new.child_id
      and status in ('active', 'ending')
  ) into v_has_any;

  if not v_has_any then
    raise exception 'Нет активного абонемента — сначала продайте абонемент'
      using errcode = 'P0001';
  else
    raise exception 'Активный абонемент на другую секцию — продайте абонемент на секцию этой группы'
      using errcode = 'P0001';
  end if;
end;
$guard_enroll$;

drop trigger if exists trg_guard_enrollment on enrollments;
create trigger trg_guard_enrollment
  before insert on enrollments
  for each row execute function fn_guard_enrollment();
