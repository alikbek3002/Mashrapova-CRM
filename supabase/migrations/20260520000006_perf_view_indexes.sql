-- =====================================================================
-- Исправление v_child_card_balance + недостающие индексы.
--
-- БАГ: подзапрос attendance агрегировал посещения по child_id (не по карте)
-- и join'ился к club_cards по child_id. У ребёнка с несколькими картами
-- это давало:
--   1) неверный remaining — каждая карта показывала ВСЮ историю посещений;
--   2) раздувание join'а (декартово умножение посещения × карты).
--
-- ФИКС: lateral-join считает посещения в пределах периода действия карты
-- (start_date..end_date), привязывая их к конкретной карте.
-- =====================================================================

create or replace view v_child_card_balance as
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
    else cc.total_lessons
       - coalesce(att.present_count, 0)
       + coalesce(fr.approved_count, 0)
  end as remaining
from club_cards cc
left join lateral (
  select count(*) filter (where a.status = 'present') as present_count
  from attendance a
  join lessons l on l.id = a.lesson_id
  where a.child_id = cc.child_id
    and l.date between cc.start_date and cc.end_date
) att on true
left join (
  select f.club_card_id, count(*) filter (where f.status = 'approved') as approved_count
  from freezes f
  group by f.club_card_id
) fr on fr.club_card_id = cc.id;

comment on view v_child_card_balance is 'Authoritative source for remaining lessons. Посещения считаются в пределах периода карты. Never compute on frontend.';

-- ---------------------------------------------------------------------
-- Недостающие индексы под частые фильтры
-- ---------------------------------------------------------------------
-- freezes: используется в v_child_card_balance (агрегат по club_card_id) и
-- в useFreezesForChild (фильтр по child_id).
create index if not exists freezes_child_idx on freezes (child_id);
create index if not exists freezes_card_idx on freezes (club_card_id);

-- groups: CoachGroups / useCoachTabel фильтруют по coach_id.
create index if not exists groups_coach_idx on groups (coach_id);
