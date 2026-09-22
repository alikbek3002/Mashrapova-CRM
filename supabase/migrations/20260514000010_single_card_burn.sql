-- =====================================================================
-- Разовый абонемент сгорает после 1 посещения.
--
-- При INSERT в attendance со статусом present/late/makeup,
-- если у ребёнка есть активная карта типа 'single' — переводим её
-- в status='expired', end_date=current_date.
--
-- Триггер только на INSERT: если посещение исправляется позже
-- (absent→present), отдельный handling не нужен — на MVP правит вручную.
-- =====================================================================

create or replace function fn_burn_single_card() returns trigger
language plpgsql security definer as $$
declare
  v_child_id uuid;
begin
  if new.status not in ('present', 'late', 'makeup') then
    return new;
  end if;
  v_child_id := new.child_id;
  update club_cards
     set status = 'expired',
         end_date = current_date,
         updated_at = now()
   where child_id = v_child_id
     and type = 'single'
     and status in ('active', 'ending');
  return new;
end;
$$;

drop trigger if exists trg_burn_single_card on attendance;
create trigger trg_burn_single_card
  after insert on attendance
  for each row
  execute function fn_burn_single_card();

comment on function fn_burn_single_card() is
  'Сжигает single-карты ребёнка при первом посещённом занятии (status=present/late/makeup).';
