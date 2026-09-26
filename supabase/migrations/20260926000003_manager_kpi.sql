-- =====================================================================
-- KPI менеджеров по ТЗ §7.4 (и разрез по менеджерам для §11.2).
--
-- Шесть метрик из таблицы ТЗ:
--   1. Скорость первого контакта, минут          цель < 10
--   2. Лид → запись на пробную, %
--   3. Запись → приход на пробную, %             цель > 70
--   4. Пробная → продажа, %
--   5. Конверсия продлений, %                    цель > 80
--   6. Среднее число продаж в день
--
-- Первые четыре считаются по leads (модуль воронки), пятая по
-- club_cards, шестая по payments — поэтому и ответственный менеджер
-- берётся из трёх разных мест:
--   лиды        → leads.responsible_manager_id
--   продления   → children.responsible_manager_id (менеджер клиента)
--   продажи     → payments.received_by (кто принял оплату)
--
-- Функция, а не view: период задаётся снаружи, а view параметров не
-- принимает. Права — invoker (по умолчанию для language sql), поэтому
-- работают RLS-политики leads/children/club_cards/payments и менеджер
-- видит только свою организацию.
--
-- ВАЖНО про RLS и полноту цифр: payments_staff_read (20260522000003)
-- отдаёт платежи чужих клиентов только тем, у кого can_see_all_children().
-- Сейчас туда входят все офисные роли, включая manager (20260820000005),
-- поэтому разбивка по менеджерам полная. Если список ролей в
-- can_see_all_children() когда-нибудь сузят, метрика «продаж в день»
-- начнёт показывать чужие продажи нулями — молча. Тогда функцию нужно
-- перевести в security definer с явной проверкой права на отчёты.
-- =====================================================================

create or replace function manager_kpi(p_from date, p_to date)
returns table (
  manager_id              uuid,
  manager_name            text,
  leads_total             bigint,
  first_contact_total     bigint,
  avg_first_contact_min   numeric,
  within_sla_total        bigint,
  trial_booked_total      bigint,
  trial_attended_total    bigint,
  converted_total         bigint,
  renewals_due            bigint,
  renewals_done           bigint,
  sales_total             bigint,
  sales_per_day           numeric
)
language sql
stable
as $manager_kpi$
  with
  -- Строка на каждого сотрудника плюс «нулевая» — под лиды и клиентов
  -- без ответственного менеджера. Без неё они выпали бы из итогов.
  mgrs as (
    select p.id, p.full_name
      from profiles p
     where p.deleted_at is null
       and p.role in ('manager', 'senior_manager', 'director', 'fitness_director', 'cashier')
    union all
    select null::uuid, null::text
  ),
  sla as (
    select coalesce(min(s.lead_first_contact_min), 10) as first_contact_min
      from org_settings s
  ),
  lead_agg as (
    select
      l.responsible_manager_id as mid,
      count(*)                                                      as leads_total,
      count(*) filter (where l.first_contact_at is not null)         as contacted,
      -- Метрика §7.4 «Скорость первого контакта» — именно среднее время,
      -- а не доля уложившихся; долю считаем отдельно (within_sla).
      avg(extract(epoch from (l.first_contact_at - l.created_at)) / 60)
        filter (where l.first_contact_at is not null)                as avg_min,
      count(*) filter (
        where l.first_contact_at is not null
          and l.first_contact_at <= l.created_at
              + make_interval(mins => sla.first_contact_min)
      )                                                              as within_sla,
      -- Записан на пробную: считаем по факту записи, а не по текущему
      -- этапу — лид, который уже купил, этот шаг тоже прошёл.
      count(*) filter (where l.trial_at is not null)                 as booked,
      count(*) filter (where l.stage in ('trial_attended', 'converted')) as attended,
      count(*) filter (where l.stage = 'converted')                  as converted
    from leads l
    -- Норматив подмешиваем джойном, а не подзапросом внутри FILTER:
    -- в filter_clause подзапросам не место.
    cross join sla
    where l.created_at::date between p_from and p_to
    group by l.responsible_manager_id
  ),
  -- Продления (§7.4, цель > 80%). Знаменатель — абонементы, срок которых
  -- истекал в периоде. Числитель — те, по кому продление куплено НЕ ПОЗЖЕ
  -- дня окончания: по ТЗ §4.5 менеджер ведёт продление с −7 дней до дня
  -- окончания, всё, что после, — это уже win-back, а не «в срок».
  renew_agg as (
    select
      ch.responsible_manager_id as mid,
      count(*)                  as due,
      count(*) filter (where exists (
        select 1
          from club_cards n
         where n.child_id = cc.child_id
           and n.id <> cc.id
           and n.start_date > cc.start_date
           and n.created_at::date <= cc.end_date
           -- Ребёнок может заниматься в нескольких секциях параллельно,
           -- поэтому продлением считается карта той же секции.
           and (cc.section_id is null or n.section_id is null
                or n.section_id = cc.section_id)
      ))                        as done
    from club_cards cc
    join children ch on ch.id = cc.child_id
    where cc.end_date between p_from and p_to
    group by ch.responsible_manager_id
  ),
  -- Продажи: абонемент считается проданным тем, кто принял по нему оплату.
  -- distinct по карте — частичные оплаты одной карты не должны считаться
  -- двумя продажами.
  sales_agg as (
    select
      pm.received_by                 as mid,
      count(distinct pm.club_card_id) as sales
    from payments pm
    where pm.club_card_id is not null
      and pm.amount > 0
      and pm.paid_at::date between p_from and p_to
    group by pm.received_by
  )
  select
    m.id,
    m.full_name,
    coalesce(l.leads_total, 0),
    coalesce(l.contacted, 0),
    round(l.avg_min, 1),
    coalesce(l.within_sla, 0),
    coalesce(l.booked, 0),
    coalesce(l.attended, 0),
    coalesce(l.converted, 0),
    coalesce(r.due, 0),
    coalesce(r.done, 0),
    coalesce(s.sales, 0),
    round(coalesce(s.sales, 0)::numeric / greatest(p_to - p_from + 1, 1), 2)
  from mgrs m
  -- is not distinct from: нулевая строка должна поймать записи без
  -- ответственного, а обычное = на NULL их бы потеряло.
  left join lead_agg  l on l.mid is not distinct from m.id
  left join renew_agg r on r.mid is not distinct from m.id
  left join sales_agg s on s.mid is not distinct from m.id
  where coalesce(l.leads_total, 0) + coalesce(r.due, 0) + coalesce(s.sales, 0) > 0
  order by coalesce(s.sales, 0) desc, coalesce(l.converted, 0) desc, m.full_name;
$manager_kpi$;

comment on function manager_kpi(date, date) is
  'ТЗ §7.4: шесть KPI менеджера за период — скорость первого контакта, конверсии лид→запись→приход→продажа, конверсия продлений, продаж в день. Строка с manager_id = null — записи без ответственного менеджера.';

notify pgrst, 'reload schema';
