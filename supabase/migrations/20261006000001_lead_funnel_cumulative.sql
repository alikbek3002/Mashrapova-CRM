-- =====================================================================
-- Воронка §7.4 накопительная: «записан на пробную» — и тот, кто уже дальше
--
-- После подключения Kommo плитка «Запись → приход» показала 289% (52 из 18):
-- «пришёл» считался по этапу (trial_attended, converted), а «записан» — по
-- факту записи (trial_at / trial_booked_at). Сделки Kommo часто переводят
-- сразу в «Пришли» или «Успешно», минуя этап записи, — и пришедших
-- получалось больше записанных.
--
-- Воронка должна быть накопительной: кто пришёл на пробную, купил или не
-- явился, тот был записан. Добавлено одно условие в трёх местах — дальше
-- те же manager_kpi, v_lead_funnel и kommo_report, что в 20261001000001.
-- =====================================================================

drop view if exists v_lead_funnel;
-- security_invoker: view читает leads правами вызывающего, поэтому
-- работает политика leads_staff_all (свой офис, только сотрудники).
-- Без этого view отдавал бы воронку всех организаций любому, кто вошёл.
create view v_lead_funnel with (security_invoker = true) as
  select
    l.organization_id,
    l.responsible_manager_id,
    date_trunc('month', l.created_at)::date          as month,
    count(*)                                          as leads_total,
    count(*) filter (where l.first_contact_at is not null) as contacted_total,
    -- Средняя скорость первого контакта, минут (цель §7.4 — меньше 10).
    avg(extract(epoch from (l.first_contact_at - l.created_at)) / 60)
      filter (where l.first_contact_at is not null)   as avg_first_contact_min,
    count(*) filter (where l.first_contact_at is not null
                       and l.first_contact_at <= l.created_at + interval '10 minutes')
                                                      as within_sla_total,
    -- Записан на пробную: этап пройден, даже если лид уехал дальше.
    count(*) filter (where l.trial_at is not null or l.trial_booked_at is not null
                       or l.stage in ('trial_attended', 'converted', 'no_show'))
                                                      as trial_booked_total,
    count(*) filter (where l.stage in ('trial_attended', 'converted')) as trial_attended_total,
    count(*) filter (where l.stage = 'no_show')       as no_show_total,
    count(*) filter (where l.stage = 'converted')     as converted_total,
    count(*) filter (where l.stage = 'lost')          as lost_total
  from leads l
  group by l.organization_id, l.responsible_manager_id, date_trunc('month', l.created_at);

comment on view v_lead_funnel is
  'ТЗ §7.4 и §11.1: воронка по месяцам и менеджерам — лиды, первый контакт и его скорость, записи на пробную, приходы, конверсии.';

revoke all on v_lead_funnel from anon;
grant select on v_lead_funnel to authenticated, service_role;

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
      -- этапу — лид, который уже купил, этот шаг тоже прошёл. Для сделок
      -- Kommo даты пробной нет, есть время перехода на этап записи.
      count(*) filter (where l.trial_at is not null
                          or l.trial_booked_at is not null
                          or l.stage in ('trial_attended', 'converted', 'no_show'))                as booked,
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

create or replace function kommo_report(p_from date, p_to date, p_org uuid default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $kommo_report$
declare
  v_org uuid := coalesce(p_org, auth_org());
  v jsonb;
begin
  with
  talks as (
    select e.talk_id,
           min(e.created_at) filter (where e.type = 'incoming_chat_message') as first_in,
           (array_agg(e.origin order by e.created_at))[1]                    as origin
      from kommo_events e
     where e.organization_id = v_org
       and e.talk_id is not null
       and e.type in ('incoming_chat_message', 'outgoing_chat_message')
     group by e.talk_id
  ), resp as (
    select t.talk_id,
           t.origin,
           extract(hour from t.first_in at time zone 'Asia/Bishkek')::int as hour_local,
           (select min(o.created_at)
              from kommo_events o
             where o.organization_id = v_org
               and o.talk_id = t.talk_id
               and o.type = 'outgoing_chat_message'
               and o.created_at > t.first_in + interval '5 seconds') - t.first_in as wait
      from talks t
     where t.first_in is not null
       and (t.first_in at time zone 'Asia/Bishkek')::date between p_from and p_to
  ), resp_split as (
    select 'all' as k, r.* from resp r
    union all select 'work_hours', r.* from resp r where r.hour_local between 9 and 20
    union all select 'off_hours',  r.* from resp r where r.hour_local not between 9 and 20
    union all select 'whatsapp',   r.* from resp r where r.origin = 'waba'
    union all select 'instagram',  r.* from resp r where r.origin like 'instagram%'
  ), resp_agg as (
    select k,
           jsonb_build_object(
             'talks',       count(*),
             'answered',    count(wait),
             'no_reply',    count(*) - count(wait),
             'median_min',  round((percentile_cont(0.5)  within group (order by extract(epoch from wait)) / 60)::numeric, 1),
             'p75_min',     round((percentile_cont(0.75) within group (order by extract(epoch from wait)) / 60)::numeric, 1),
             'within_10_min', count(*) filter (where wait <= interval '10 minutes'),
             'within_30_min', count(*) filter (where wait <= interval '30 minutes'),
             'over_3_hours',  count(*) filter (where wait > interval '3 hours')
           ) as j
      from resp_split
     group by k
  ), by_hour as (
    select coalesce(jsonb_agg(c order by h), '[]'::jsonb) as j
      from (select h, (select count(*) from resp where hour_local = h) as c
              from generate_series(0, 23) h) x
  ), kl as (
    select l.*
      from leads l
     where l.organization_id = v_org
       and l.kommo_lead_id is not null
       and l.kommo_deleted_at is null
       and (l.created_at at time zone 'Asia/Bishkek')::date between p_from and p_to
  ), funnel as (
    select jsonb_build_object(
      'leads',          count(*),
      'unsorted',       count(*) filter (where ks.is_unsorted),
      'contacted',      count(*) filter (where kl.first_contact_at is not null),
      'trial_booked',   count(*) filter (where kl.trial_booked_at is not null or kl.trial_at is not null
                                                or kl.stage in ('trial_attended', 'converted', 'no_show')),
      'trial_attended', count(*) filter (where kl.stage in ('trial_attended', 'converted')),
      'converted',      count(*) filter (where kl.stage = 'converted'),
      'lost',           count(*) filter (where kl.stage = 'lost'),
      'lost_with_reason', count(*) filter (where kl.stage = 'lost' and kl.lost_reason is not null),
      'revenue',        coalesce(sum(kl.kommo_price) filter (where kl.stage = 'converted'), 0),
      'avg_check',      round(avg(kl.kommo_price) filter (where kl.stage = 'converted' and kl.kommo_price > 0)),
      'with_manager',   count(*) filter (where kl.kommo_manager_tag is not null or kl.responsible_manager_id is not null)
    ) as j
      from kl
      left join kommo_statuses ks
        on ks.organization_id = kl.organization_id
       and ks.pipeline_id = kl.kommo_pipeline_id
       and ks.status_id = kl.kommo_status_id
  ), by_channel as (
    select coalesce(jsonb_object_agg(ch, n), '{}'::jsonb) as j
      from (select coalesce(channel, 'unknown') as ch, count(*) as n from kl group by 1) x
  ), by_status as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'pipeline', ks.pipeline_name, 'status', ks.status_name, 'stage', ks.stage, 'leads', x.n)
             order by ks.pipeline_name, ks.sort), '[]'::jsonb) as j
      from (select kommo_pipeline_id, kommo_status_id, count(*) as n from kl group by 1, 2) x
      join kommo_statuses ks
        on ks.organization_id = v_org
       and ks.pipeline_id = x.kommo_pipeline_id
       and ks.status_id = x.kommo_status_id
  ), by_manager as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'manager', m, 'leads', n, 'converted', c, 'revenue', r) order by c desc, n desc), '[]'::jsonb) as j
      from (select coalesce(p.full_name, kl.kommo_manager_tag, '—') as m,
                   count(*) as n,
                   count(*) filter (where kl.stage = 'converted') as c,
                   coalesce(sum(kl.kommo_price) filter (where kl.stage = 'converted'), 0) as r
              from kl
              left join profiles p on p.id = kl.responsible_manager_id
             group by 1) x
  ), by_section as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'section', sname, 'leads', n, 'converted', c) order by n desc), '[]'::jsonb) as j
      from (select coalesce(s.name_ru, '—') as sname,
                   count(*) as n,
                   count(*) filter (where kl.stage = 'converted') as c
              from kl
              left join sections s on s.id = kl.section_interest_id
             group by 1) x
  ), backlog as (
    -- Бэклог — на сегодня, не за период.
    select jsonb_build_object(
      'unsorted_total',  count(*),
      'replied',         count(*) filter (where l.first_contact_at is not null),
      'never_replied',   count(*) filter (where l.first_contact_at is null),
      'older_than_7_days', count(*) filter (where l.created_at < now() - interval '7 days')
    ) as j
      from leads l
      join kommo_statuses ks
        on ks.organization_id = l.organization_id
       and ks.pipeline_id = l.kommo_pipeline_id
       and ks.status_id = l.kommo_status_id
     where l.organization_id = v_org
       and ks.is_unsorted
       and l.kommo_deleted_at is null
  ), sync as (
    select coalesce((select jsonb_build_object(
             'last_ok_at', s.last_ok_at, 'last_run_at', s.last_run_at,
             'last_error', s.last_error, 'base_url', s.base_url)
             from kommo_sync_state s where s.organization_id = v_org), '{}'::jsonb) as j
  )
  select jsonb_build_object(
    'period',     jsonb_build_object('from', p_from, 'to', p_to),
    'response',   coalesce((select jsonb_object_agg(k, j) from resp_agg), '{}'::jsonb),
    'by_hour',    (select j from by_hour),
    'funnel',     (select j from funnel),
    'by_channel', (select j from by_channel),
    'by_status',  (select j from by_status),
    'by_manager', (select j from by_manager),
    'by_section', (select j from by_section),
    'backlog',    (select j from backlog),
    'sync',       (select j from sync)
  ) into v;
  return v;
end;
$kommo_report$;

notify pgrst, 'reload schema';
