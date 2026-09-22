-- =====================================================================
-- v_child_card_balance: посещения считаем только по секции карты.
--
-- БАГ: у ребёнка с картами двух секций (напр. гимнастика + дзюдо)
-- lateral-подзапрос считал посещения по child_id за период карты БЕЗ
-- привязки к секции — каждая карта вычитала посещения ВСЕХ групп
-- ребёнка. Вскрылось на прод-импорте августа 2026 (7 детей в двух
-- секциях, остатки уезжали в минус).
--
-- ФИКС: занятие уменьшает карту только если секция его группы совпадает
-- с club_cards.section_id. Старые карты без section_id (null) ведут
-- себя по-прежнему: любое посещение в окне карты.
-- =====================================================================

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
    -- Карта с секцией уменьшается только занятиями групп своей секции.
    and (
      cc.section_id is null
      or exists (
        select 1 from groups g
         where g.id = l.group_id
           and g.section_id = cc.section_id
      )
    )
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
  'Authoritative source for remaining lessons. Present-count учитывает только занятия секции карты (для карт с section_id) и исключает дни внутри approved-freeze. Never compute on frontend.';

grant select on v_child_card_balance to authenticated;
