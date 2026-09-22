-- =====================================================================
-- Role expansion: 5 → 7 roles per ТЗ.
-- Old enum values: admin, manager, cashier, coach, parent
-- New enum values: director, fitness_director, senior_manager,
--                  manager, cashier, coach, parent
--
-- Mapping:
--   admin    → director         (existing admin acct becomes Director/Owner)
--   manager  → senior_manager   (legacy "manager" treated as Senior Manager;
--                                fresh "manager" gets a brand-new value)
--
-- Approach: ALTER TYPE … RENAME VALUE + ADD VALUE.
-- No type drop, no cascade, no broken policies. Idempotent: safe to
-- re-run after a partial failure (incl. an aborted attempt of the
-- previous user_role_v2 strategy).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Step 0. Reverse a partial run of the OLD user_role_v2 strategy
-- (only fires if user_role_v2 exists in the database).
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_type where typname = 'user_role_v2') then
    -- If profiles.role got migrated to v2, move it back to user_role
    -- so we can keep using the safe RENAME strategy below.
    if exists (
      select 1 from information_schema.columns
      where table_name = 'profiles' and column_name = 'role' and udt_name = 'user_role_v2'
    ) then
      alter table profiles alter column role type user_role using (
        case role::text
          when 'director'         then 'admin'
          when 'fitness_director' then 'admin'
          when 'senior_manager'   then 'manager'
          else role::text
        end
      )::user_role;
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_name = 'audit_log' and column_name = 'actor_role' and udt_name = 'user_role_v2'
    ) then
      alter table audit_log alter column actor_role type user_role using (
        case actor_role::text
          when 'director'         then 'admin'
          when 'fitness_director' then 'admin'
          when 'senior_manager'   then 'manager'
          else actor_role::text
        end
      )::user_role;
    end if;
    drop type user_role_v2;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Step 1. Rename existing values to ТЗ names
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'admin'
  ) then
    alter type user_role rename value 'admin' to 'director';
  end if;

  -- Rename old 'manager' → 'senior_manager' (only if 'senior_manager'
  -- doesn't already exist — protects against re-run).
  if exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'manager'
  ) and not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'senior_manager'
  ) then
    alter type user_role rename value 'manager' to 'senior_manager';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Step 2. Add the two new values. IF NOT EXISTS keeps it idempotent.
-- These statements MUST be at the top level (not inside a DO block),
-- and Postgres auto-commits each so they're safe.
-- ---------------------------------------------------------------------
alter type user_role add value if not exists 'fitness_director' after 'director';
alter type user_role add value if not exists 'manager' after 'senior_manager';
