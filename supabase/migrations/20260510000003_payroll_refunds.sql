-- =====================================================================
-- Payroll, coach rates, refunds — implements ТЗ §6 (зарплаты тренеров)
-- and §5 (возвраты с удержанием 30%).
--
-- Coach rates: per (coach × group), with effective_from/to to support
-- history. Computation joins lessons → rate active on that date.
--
-- Payroll periods: per coach × period, with computed amount + manual
-- adjustment + status (draft → advance_paid → paid). Only fitness_director
-- and director can approve.
--
-- Refunds: per club_card. Two kinds: with_30pct (default) or full_no_fee
-- (only director/fitness_director/senior_manager via can_cancel_30pct()).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Coach rates
-- ---------------------------------------------------------------------
create table coach_rates (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  coach_id uuid not null references profiles(id),
  group_id uuid not null references groups(id),
  rate_per_kid numeric(10, 2) not null check (rate_per_kid >= 0),
  effective_from date not null,
  effective_to date,
  set_by uuid references profiles(id),
  comment text,
  created_at timestamptz not null default now()
);
create index coach_rates_lookup_idx on coach_rates (coach_id, group_id, effective_from desc);

-- ---------------------------------------------------------------------
-- Payroll periods
-- ---------------------------------------------------------------------
create type payroll_status as enum ('draft', 'advance_paid', 'paid');

create table payroll_periods (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  coach_id uuid not null references profiles(id),
  period_start date not null,
  period_end date not null,
  computed_amount numeric(12, 2) not null default 0,
  manual_adjustment numeric(12, 2) not null default 0,
  adjustment_reason text,
  adjusted_by uuid references profiles(id),
  adjusted_at timestamptz,
  status payroll_status not null default 'draft',
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index payroll_periods_unique on payroll_periods (coach_id, period_start, period_end);

-- ---------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------
create type refund_kind as enum ('with_30pct', 'full_no_fee');

create table refunds (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  club_card_id uuid not null references club_cards(id),
  child_id uuid not null references children(id),
  kind refund_kind not null,
  remaining_lessons int not null,
  total_lessons int not null,
  card_price numeric(10, 2) not null,
  refund_amount numeric(10, 2) not null,
  fee_amount numeric(10, 2) not null default 0,
  reason text not null,
  processed_by uuid not null references profiles(id),
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------
alter table coach_rates enable row level security;
alter table payroll_periods enable row level security;
alter table refunds enable row level security;

-- coach_rates: only fit-director / director can manage; coach can read own.
create policy coach_rates_admin_rw on coach_rates for all
  using (can_manage_coaches() and organization_id = auth_org())
  with check (can_manage_coaches() and organization_id = auth_org());

create policy coach_rates_self_read on coach_rates for select
  using (is_coach() and coach_id = auth.uid());

-- payroll_periods: fit-director / director CRUD, coach read-own.
create policy payroll_admin_rw on payroll_periods for all
  using (can_manage_coaches() and organization_id = auth_org())
  with check (can_manage_coaches() and organization_id = auth_org());

create policy payroll_self_read on payroll_periods for select
  using (is_coach() and coach_id = auth.uid());

-- refunds: read by all staff in org; insert by sales/sr-manager+,
-- full_no_fee additionally requires can_cancel_30pct().
create policy refunds_view on refunds for select
  using (is_staff() and organization_id = auth_org());

create policy refunds_create on refunds for insert
  with check (
    is_staff() and organization_id = auth_org()
    and (kind = 'with_30pct' or can_cancel_30pct())
  );

-- ---------------------------------------------------------------------
-- compute_coach_payroll(coach, from, to) — sum per-lesson per-rate
-- across all coach's lessons in [from, to], counting only 'present',
-- 'late', 'makeup' attendances. Trial lessons are excluded per ТЗ.
-- ---------------------------------------------------------------------
create or replace function compute_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
as $$
  select coalesce(sum(
    cr.rate_per_kid * (
      select count(*) from attendance a
      where a.lesson_id = l.id
        and a.status in ('present', 'late', 'makeup')
    )
  ), 0)
  from lessons l
  join coach_rates cr
    on cr.group_id = l.group_id
   and cr.coach_id = l.coach_id
   and l.date between cr.effective_from
                 and coalesce(cr.effective_to, l.date)
  where l.coach_id = p_coach
    and l.date between p_from and p_to
    and l.type <> 'trial'
    and l.status = 'completed';
$$;
