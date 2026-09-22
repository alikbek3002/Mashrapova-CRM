-- =====================================================================
-- Wipe ALL operational data while keeping schema, RLS, migrations,
-- auth.users (login accounts) and the organizations row.
--
-- This version is tolerant: if a table does not yet exist in your DB
-- (e.g. you skipped migration 003/004), it is silently skipped.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New query → paste this file → Run.
--
-- WARNING: irreversible. Take a backup snapshot first
-- (Supabase Dashboard → Database → Backups).
-- =====================================================================

do $$
declare
  tbl text;
  tables_to_clean text[] := array[
    -- attendance & related (leaves only after lessons exist)
    'attendance',
    'progress_notes',
    'freezes',
    'refunds',
    'payments',
    -- subscription stack
    'payroll_periods',
    'coach_rates',
    'club_cards',
    -- group membership & schedule
    'enrollments',
    'lessons',
    'group_schedule',
    'groups',
    'section_coaches',
    'sections',
    -- people (clients side)
    'children',
    'families',
    -- sales funnel
    'leads',
    -- misc
    'notifications',
    'outreach_log',
    'audit_log'
  ];
begin
  -- Disable triggers temporarily so audit / archive guards don't fight us.
  perform set_config('session_replication_role', 'replica', true);

  foreach tbl in array tables_to_clean loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = tbl
    ) then
      execute format('truncate table public.%I restart identity cascade', tbl);
      raise notice 'truncated: %', tbl;
    else
      raise notice 'skipped (not exists): %', tbl;
    end if;
  end loop;

  perform set_config('session_replication_role', 'origin', true);
end $$;

-- Sanity check — counts of what's left. Operational tables that don't
-- exist yet are reported as -1 (informational).
do $$
declare
  rec record;
  cnt int;
  ops text[] := array[
    'children','families','sections','groups','lessons','attendance',
    'club_cards','payments','freezes','refunds','payroll_periods',
    'coach_rates','leads'
  ];
  t text;
begin
  raise notice '--- operational tables (should all be 0) ---';
  foreach t in array ops loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('select count(*) from public.%I', t) into cnt;
      raise notice '%: %', rpad(t, 18), cnt;
    else
      raise notice '%: (table does not exist — apply migration first)', rpad(t, 18);
    end if;
  end loop;

  raise notice '--- preserved tables ---';
  select count(*) into cnt from profiles;
  raise notice 'profiles:           %', cnt;
  select count(*) into cnt from organizations;
  raise notice 'organizations:      %', cnt;
end $$;
