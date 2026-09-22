-- =====================================================================
-- Заморозка — теперь scope=карта, а не ребёнок.
--
-- Как в реальных фитнес-клубах: подписка ставится на паузу на N дней,
-- но клиент остаётся клиентом клуба. По текущей логике у нас
-- card.status='frozen' триггерил children.status='frozen' — и ребёнок
-- помечался «замороженным» во всех списках, что неверно.
--
-- Новое правило для children.status:
--   active   — есть хотя бы одна active / ending / frozen карта
--              (заморозка считается «в клубе»)
--   debtor   — все карты в долге, активных и замороженных нет
--   expired  — нет ни активных, ни долговых, ни замороженных
--   archived — административно архивирован, не пересчитываем
--
-- card.status='frozen' остаётся как было (это правильно: конкретный
-- абонемент в паузе). Меняется только производный child.status.
-- =====================================================================

create or replace function fn_refresh_child_status() returns trigger
language plpgsql as $$
declare
  v_child uuid;
  v_has_live boolean;  -- active / ending / frozen
  v_has_debt boolean;
begin
  v_child := coalesce(new.child_id, old.child_id);

  select exists(
    select 1 from club_cards
     where child_id = v_child
       and status in ('active', 'ending', 'frozen')
  ) into v_has_live;

  select exists(
    select 1 from club_cards
     where child_id = v_child and status = 'debt'
  ) into v_has_debt;

  if v_has_live then
    update children set status = 'active'
     where id = v_child and status <> 'archived' and status <> 'active';
  elsif v_has_debt then
    update children set status = 'debtor'
     where id = v_child and status <> 'archived' and status <> 'debtor';
  else
    update children set status = 'expired'
     where id = v_child and status <> 'archived' and status <> 'expired';
  end if;

  return coalesce(new, old);
end $$;

-- Backfill: пересчёт уже существующих children.status — у того одного
-- ребёнка с действующей заморозкой child.status сейчас 'frozen', надо
-- вернуть в 'active' (если карта frozen или активна).
-- ::child_status — потому что CASE выводит text, а столбец enum-типа.
update children c
   set status = (case
     when exists (
       select 1 from club_cards cc
        where cc.child_id = c.id
          and cc.status in ('active', 'ending', 'frozen')
     ) then 'active'
     when exists (
       select 1 from club_cards cc
        where cc.child_id = c.id and cc.status = 'debt'
     ) then 'debtor'
     else 'expired'
   end)::child_status
 where c.status <> 'archived';

-- Обновляем кэш PostgREST schema.
notify pgrst, 'reload schema';
