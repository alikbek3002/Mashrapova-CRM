-- =====================================================================
-- RLS helper functions v2 — extend is_staff() to all 5 office roles
-- and add granular feature-level helpers used by new payroll/refund tables.
-- =====================================================================

-- All 5 office roles count as staff (was: admin/manager/cashier).
create or replace function is_staff() returns boolean
language sql stable security definer
as $$
  select coalesce(auth_role() in
    ('director','fitness_director','senior_manager','manager','cashier'), false)
$$;

-- Director only — system settings, hard delete (denied for everyone in code).
create or replace function is_director() returns boolean
language sql stable security definer
as $$
  select coalesce(auth_role() = 'director', false)
$$;

-- Director + Fitness Director — coaches, rates, payroll approval, sections, archive.
create or replace function can_manage_coaches() returns boolean
language sql stable security definer
as $$
  select coalesce(auth_role() in ('director','fitness_director'), false)
$$;

-- Director + Fitness Director + Senior Manager — schedule, freeze approve,
-- cancel 30% withholding, finance reports.
create or replace function can_manage_schedule() returns boolean
language sql stable security definer
as $$
  select coalesce(auth_role() in
    ('director','fitness_director','senior_manager'), false)
$$;

create or replace function can_view_finance_reports() returns boolean
language sql stable security definer
as $$
  select coalesce(auth_role() in
    ('director','fitness_director','senior_manager'), false)
$$;

create or replace function can_cancel_30pct() returns boolean
language sql stable security definer
as $$
  select coalesce(auth_role() in
    ('director','fitness_director','senior_manager'), false)
$$;
