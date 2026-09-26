-- =====================================================================
-- Дашборд директора по ТЗ Академии Машрапова §11.1 (реальное время).
--
--   • Выручка за день / неделю / месяц с динамикой к прошлому периоду
--   • Активные клиенты — всего и по дисциплинам
--   • Новые клиенты за период
--   • Конверсия «запись → приход на пробную» (цель > 70%)
--   • Продления: план и факт (цель > 80%)
--   • Топ менеджеров по продажам и продлениям
--   • Клиенты в зоне риска: не приходили 10+ дней ИЛИ абонемент
--     истекает через 7 дней
--   • Заполненность групп (% по каждой секции)
--
-- Конверсия пробных, продления и топ менеджеров уже считает
-- manager_kpi(from, to) (20260926000003) — дублировать не нужно, дашборд
-- вызывает её же.
--
-- Всё остальное — здесь. Одной функцией и тремя view вместо каскада
-- клиентских запросов: сейчас useStats делает 11 параллельных выборок и
-- досчитывает на клиенте, включая выгрузку 2000 строк посещаемости.
--
-- Права — invoker: работают RLS-политики payments/children/club_cards,
-- то есть каждый видит только свою организацию. Доступ к деньгам
-- ограничивает сама страница (право view_finance_reports, §2.2).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Выручка и клиенты с динамикой
--
-- Прошлый период берём той же длины, а не «прошлый календарный месяц»:
-- сравнивать неполный текущий месяц с полным прошлым — значит всегда
-- показывать падение. Для месяца сравнение идёт month-to-date против
-- такого же отрезка прошлого месяца.
--
-- Выручка = сумма payments.amount. Возвраты пишутся отрицательным
-- платежом (create_refund_with_deposit), поэтому сумма уже нетто.
-- ---------------------------------------------------------------------
create or replace function director_dashboard()
returns table (
  revenue_day             numeric,
  revenue_day_prev        numeric,
  revenue_week            numeric,
  revenue_week_prev       numeric,
  revenue_month           numeric,
  revenue_month_prev      numeric,
  active_clients          bigint,
  new_clients_month       bigint,
  new_clients_month_prev  bigint,
  risk_no_visits          bigint,
  risk_expiring_7         bigint
)
language sql
stable
as $director_dashboard$
  with bounds as (
    select
      current_date                                              as today,
      current_date - 1                                          as yesterday,
      current_date - 6                                          as week_from,
      current_date - 13                                         as week_prev_from,
      current_date - 7                                          as week_prev_to,
      date_trunc('month', current_date)::date                   as month_from,
      -- Столько дней месяца уже прошло — ровно такой же отрезок берём
      -- в прошлом месяце.
      (current_date - date_trunc('month', current_date)::date)   as month_offset,
      (date_trunc('month', current_date) - interval '1 month')::date as month_prev_from
  )
  select
    (select coalesce(sum(p.amount), 0) from payments p, bounds b
      where p.paid_at::date = b.today),
    (select coalesce(sum(p.amount), 0) from payments p, bounds b
      where p.paid_at::date = b.yesterday),
    (select coalesce(sum(p.amount), 0) from payments p, bounds b
      where p.paid_at::date between b.week_from and b.today),
    (select coalesce(sum(p.amount), 0) from payments p, bounds b
      where p.paid_at::date between b.week_prev_from and b.week_prev_to),
    (select coalesce(sum(p.amount), 0) from payments p, bounds b
      where p.paid_at::date between b.month_from and b.today),
    (select coalesce(sum(p.amount), 0) from payments p, bounds b
      where p.paid_at::date between b.month_prev_from and b.month_prev_from + b.month_offset),
    -- Активный клиент — у кого есть живой абонемент. Заморозка из клуба
    -- не выкидывает, это пауза (та же трактовка, что в useStats).
    (select count(distinct cc.child_id) from club_cards cc
      where cc.status in ('active', 'ending', 'frozen')),
    (select count(*) from children c, bounds b
      where c.deleted_at is null and c.created_at::date between b.month_from and b.today),
    (select count(*) from children c, bounds b
      where c.deleted_at is null
        and c.created_at::date between b.month_prev_from and b.month_prev_from + b.month_offset),
    -- ТЗ §4.5: флаг оттока ставит refresh_card_notices().
    (select count(*) from children c
      where c.deleted_at is null and c.churn_risk_at is not null),
    (select count(distinct cc.child_id) from club_cards cc, bounds b
      where cc.status in ('active', 'ending')
        and cc.end_date between b.today and b.today + 7);
$director_dashboard$;

comment on function director_dashboard() is
  'ТЗ §11.1: выручка день/неделя/месяц с динамикой к равному по длине прошлому периоду, активные и новые клиенты, счётчики зоны риска.';

-- ---------------------------------------------------------------------
-- 2. Активные клиенты по дисциплинам (§11.1)
-- ---------------------------------------------------------------------
drop view if exists v_active_clients_by_section;
create view v_active_clients_by_section with (security_invoker = true) as
  select
    s.id                          as section_id,
    s.organization_id,
    s.name_ru,
    s.name_ky,
    s.category,
    count(distinct cc.child_id)   as active_clients
  from sections s
  left join club_cards cc
    on cc.section_id = s.id
   and cc.status in ('active', 'ending', 'frozen')
  where s.deleted_at is null
    and s.is_active
  group by s.id, s.organization_id, s.name_ru, s.name_ky, s.category;

comment on view v_active_clients_by_section is
  'ТЗ §11.1: сколько активных клиентов в каждой дисциплине.';

-- ---------------------------------------------------------------------
-- 3. Заполненность групп по секциям (§11.1)
--
-- Считаем по активным зачислениям против max_capacity групп. Сумму
-- вместимости берём по группам, а не по строкам зачислений: иначе
-- join размножил бы capacity на число детей.
-- ---------------------------------------------------------------------
drop view if exists v_section_load;
create view v_section_load with (security_invoker = true) as
  with grp as (
    select
      g.id,
      g.section_id,
      g.organization_id,
      g.max_capacity,
      (select count(*) from enrollments e
        where e.group_id = g.id and e.archived_at is null) as enrolled
    from groups g
    where g.is_active
      and g.deleted_at is null
  )
  select
    s.id                                  as section_id,
    s.organization_id,
    s.name_ru,
    s.name_ky,
    count(grp.id)                         as groups_count,
    coalesce(sum(grp.max_capacity), 0)    as capacity,
    coalesce(sum(grp.enrolled), 0)        as enrolled,
    case
      when coalesce(sum(grp.max_capacity), 0) > 0
        then round(sum(grp.enrolled)::numeric * 100 / sum(grp.max_capacity), 0)
      else null
    end                                   as fill_pct
  from sections s
  join grp on grp.section_id = s.id
  where s.deleted_at is null
    and s.is_active
  group by s.id, s.organization_id, s.name_ru, s.name_ky;

comment on view v_section_load is
  'ТЗ §11.1: заполненность групп в процентах по каждой секции — активные зачисления против вместимости.';

-- ---------------------------------------------------------------------
-- 4. Клиенты в зоне риска (§11.1)
--
-- Два разных повода, оба из ТЗ: не приходил 10+ дней (флаг §4.5) или
-- абонемент истекает в ближайшие 7 дней. Колонка reason говорит, какой
-- именно — списки смешивать нельзя, звонки по ним разные.
-- ---------------------------------------------------------------------
drop view if exists v_clients_at_risk;
create view v_clients_at_risk with (security_invoker = true) as
  select
    c.id                        as child_id,
    c.organization_id,
    c.full_name,
    c.responsible_manager_id,
    c.churn_risk_at,
    nearest.end_date            as card_end_date,
    case
      when c.churn_risk_at is not null then 'no_visits'
      else 'expiring'
    end                         as reason
  from children c
  left join lateral (
    select cc.end_date
      from club_cards cc
     where cc.child_id = c.id
       and cc.status in ('active', 'ending')
     order by cc.end_date
     limit 1
  ) nearest on true
  where c.deleted_at is null
    and (
      c.churn_risk_at is not null
      or (nearest.end_date is not null
          and nearest.end_date between current_date and current_date + 7)
    );

comment on view v_clients_at_risk is
  'ТЗ §11.1: клиенты в зоне риска — не приходили 10+ дней (reason = no_visits) или абонемент истекает через 7 дней (reason = expiring).';

notify pgrst, 'reload schema';
