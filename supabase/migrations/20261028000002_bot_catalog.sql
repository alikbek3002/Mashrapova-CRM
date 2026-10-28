-- =====================================================================
-- Справочник для ИИ-агента Nextbot в Instagram (2026-10-28)
-- =====================================================================
-- Агент отвечает клиентам про цены, расписание и места в группах и берёт
-- эти факты из ERP через GET /v1/bot/* (backend/src/routes/v1/bot.ts).
-- Бэкенд читает два представления ниже, чтобы цена и занятость считались
-- так же, как в форме продажи и в отчётах, а не заново в TypeScript.
--
-- Оба представления security_invoker: сотрудник видит их под своим RLS,
-- бэкенд читает под service_role.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Цены секции для клиента: через section_price() — цена секции главнее,
-- пусто — цена тарифа того же типа из каталога.
--
-- Только пробное и разовое. Месячного здесь нет: section_price(…,
-- 'monthly') берёт первый месячный тариф каталога, а их несколько
-- (детский 2 500, взрослый 2 800, фитнес) и с секцией они не связаны.
-- Абонементы агент получает списком card_plans и выбирает по названию.
-- ---------------------------------------------------------------------
drop view if exists v_section_prices;
create view v_section_prices with (security_invoker = true) as
  select
    s.id                              as section_id,
    s.organization_id,
    s.name_ru,
    s.name_ky,
    s.category,
    section_price(s.id, 'trial')      as trial_price,
    section_price(s.id, 'single')     as single_price
  from sections s
  where s.is_active
    and s.deleted_at is null;

comment on view v_section_prices is
  'Цены пробного и разового занятия по каждой активной секции через section_price(). Источник для агента Nextbot.';

-- ---------------------------------------------------------------------
-- Занятость групп: активные зачисления против max_capacity, как в
-- v_section_load, только по каждой группе. Зачисление с прошедшим
-- end_date место уже не занимает, даже если refresh_lifecycle() ещё не
-- успел его архивировать.
-- ---------------------------------------------------------------------
drop view if exists v_group_occupancy;
create view v_group_occupancy with (security_invoker = true) as
  select
    g.id                                          as group_id,
    g.organization_id,
    g.section_id,
    g.max_capacity,
    count(e.id)                                   as enrolled,
    greatest(g.max_capacity - count(e.id), 0)     as free
  from groups g
  left join enrollments e
    on e.group_id = g.id
   and e.archived_at is null
   and (e.end_date is null or e.end_date >= current_date)
  where g.is_active
    and g.deleted_at is null
  group by g.id;

comment on view v_group_occupancy is
  'Занятость каждой активной группы: действующие зачисления, вместимость, свободные места. Источник для агента Nextbot.';

notify pgrst, 'reload schema';
