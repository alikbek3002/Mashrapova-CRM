-- =====================================================================
-- Фикс fn_apply_freeze_to_card: при досрочном завершении заморозки
-- (approved → rejected) триггер делал `update club_cards set status =
-- (case ... 'active' ... 'ending' ... 'expired' ... end)`. Постгрес
-- читает CASE-без-каста как text, а `club_cards.status` — enum
-- `card_status`. INSERT/UPDATE падает с 42804 → backend получает 500.
--
-- То же самое грабло, что чинили на child_status в 20260523000001.
-- Решение: явный cast `(case ... end)::card_status`.
--
-- Этот же триггер также проверяем по другим CASE-выражениям, но они
-- присваиваются в plpgsql-переменные (v_*), там тип выводится корректно.
-- =====================================================================

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
             status = 'frozen'::card_status
       where id = new.club_card_id;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.applied_days := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- pending → approved
    if (old.status <> 'approved') and (new.status = 'approved') then
      v_new_days := greatest(0, (new.end_date - new.start_date + 1));
      new.applied_days := v_new_days;
      if v_new_days > 0 then
        update club_cards
           set end_date = end_date + v_new_days,
               status = 'frozen'::card_status
         where id = new.club_card_id;
      end if;
      return new;
    end if;

    -- approved → rejected (досрочное завершение): откат лишних дней
    -- и возврат статуса в active/ending/expired по фактическим датам.
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
      end if;

      select exists (
        select 1 from freezes
         where club_card_id = old.club_card_id
           and status = 'approved'
           and id <> old.id
      ) into v_has_other_active;

      if not v_has_other_active then
        -- ВАЖНО: каст в card_status — без него CASE отдаёт text,
        -- ассайнмент в enum-колонку падает с 42804 → 500 на ручке /end.
        update club_cards
           set status = (case
             when end_date < current_date then 'expired'
             when end_date <= (current_date + 7) then 'ending'
             else 'active'
           end)::card_status
         where id = old.club_card_id;
      end if;
      return new;
    end if;

    -- approved → approved с изменёнными датами — пересчёт дельты.
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

-- Триггер уже навешан в 20260522000005, его пересоздавать не нужно —
-- функция заменилась через create or replace.

notify pgrst, 'reload schema';
