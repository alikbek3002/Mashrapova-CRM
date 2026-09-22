-- =====================================================================
-- Views — single source of truth for derived values
-- =====================================================================

-- Child card balance: total - present - + approved freezes
-- Used by both frontend and backend; never compute remaining manually.
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
left join (
  select a.child_id, count(*) filter (where a.status = 'present') as present_count
  from attendance a
  join lessons l on l.id = a.lesson_id
  group by a.child_id
) att on att.child_id = cc.child_id
left join (
  select f.club_card_id, count(*) filter (where f.status = 'approved') as approved_count
  from freezes f
  group by f.club_card_id
) fr on fr.club_card_id = cc.id;

comment on view v_child_card_balance is 'Authoritative source for remaining lessons. Never compute on frontend.';

-- Director KPI dashboard
create or replace view v_director_kpi as
with active_children as (
  select organization_id, count(*) as cnt
  from children
  where deleted_at is null and status = 'active'
  group by organization_id
),
month_revenue as (
  select organization_id, coalesce(sum(amount), 0) as total
  from payments
  where paid_at >= date_trunc('month', now())
  group by organization_id
),
active_cards as (
  select organization_id, count(*) as cnt
  from club_cards
  where status in ('active', 'ending')
  group by organization_id
),
ending_soon as (
  select organization_id, count(*) as cnt
  from club_cards
  where status = 'ending' or (status = 'active' and end_date <= current_date + interval '7 days')
  group by organization_id
)
select
  o.id as organization_id,
  coalesce(ac.cnt, 0) as active_children,
  coalesce(mr.total, 0) as month_revenue,
  coalesce(acd.cnt, 0) as active_cards,
  coalesce(es.cnt, 0) as cards_ending_7d
from organizations o
left join active_children ac on ac.organization_id = o.id
left join month_revenue mr on mr.organization_id = o.id
left join active_cards acd on acd.organization_id = o.id
left join ending_soon es on es.organization_id = o.id;

comment on view v_director_kpi is 'Aggregated KPI for director dashboard.';
