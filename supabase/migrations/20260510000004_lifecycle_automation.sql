-- =====================================================================
-- Lifecycle automation — fixes "wall-clock" bugs found in audit:
--
--   1. lessons.status was never moved 'scheduled' → 'completed', so
--      compute_coach_payroll() always returned 0.
--   2. club_cards stayed 'active' forever even after end_date.
--   3. freezes had no end_date, so frozen cards stayed frozen forever.
--   4. children.status didn't track their cards (debtor/expired).
--   5. v_child_card_balance counted only 'present', diverging from
--      payroll/refund formulas which count present+late+makeup.
--
-- Strategy:
--   - Triggers handle event-driven changes (attendance → completed,
--     card change → child status).
--   - A SQL function refresh_lifecycle() handles wall-clock changes
--     (today crossed end_date). It is exposed for pg_cron OR for a
--     backend cron call (POST /v1/lifecycle/refresh) — see backend.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Freeze ranges
-- ---------------------------------------------------------------------
alter table freezes add column if not exists start_date date;
alter table freezes add column if not exists end_date date;

create index if not exists freezes_active_range_idx
  on freezes (status, end_date)
  where status = 'approved';

-- ---------------------------------------------------------------------
-- 2. Trigger: any attendance row → mark its lesson 'completed'
-- ---------------------------------------------------------------------
create or replace function fn_mark_lesson_completed() returns trigger
language plpgsql as $$
begin
  update lessons
     set status = 'completed'
   where id = new.lesson_id
     and status = 'scheduled';
  return new;
end $$;

drop trigger if exists trg_attendance_complete_lesson on attendance;
create trigger trg_attendance_complete_lesson
  after insert or update on attendance
  for each row execute function fn_mark_lesson_completed();

-- ---------------------------------------------------------------------
-- 3. Trigger: card status change → recompute child status
-- ---------------------------------------------------------------------
create or replace function fn_refresh_child_status() returns trigger
language plpgsql as $$
declare
  v_child uuid;
  v_has_active boolean;
  v_has_frozen boolean;
  v_has_debt boolean;
begin
  v_child := coalesce(new.child_id, old.child_id);

  select exists(
    select 1 from club_cards
     where child_id = v_child and status in ('active', 'ending')
  ) into v_has_active;

  select exists(
    select 1 from club_cards
     where child_id = v_child and status = 'frozen'
  ) into v_has_frozen;

  select exists(
    select 1 from club_cards
     where child_id = v_child and status = 'debt'
  ) into v_has_debt;

  if v_has_active then
    update children set status = 'active'
     where id = v_child and status <> 'archived' and status <> 'active';
  elsif v_has_frozen then
    update children set status = 'frozen'
     where id = v_child and status <> 'archived' and status <> 'frozen';
  elsif v_has_debt then
    update children set status = 'debtor'
     where id = v_child and status <> 'archived' and status <> 'debtor';
  else
    update children set status = 'expired'
     where id = v_child and status <> 'archived' and status <> 'expired';
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists trg_card_refresh_child on club_cards;
create trigger trg_card_refresh_child
  after insert or update or delete on club_cards
  for each row execute function fn_refresh_child_status();

-- ---------------------------------------------------------------------
-- 4. Wall-clock refresh — call daily (pg_cron) or manually via backend.
-- ---------------------------------------------------------------------
create or replace function refresh_lifecycle() returns void
language plpgsql security definer as $$
begin
  -- expired: end_date already passed
  update club_cards
     set status = 'expired'
   where end_date < current_date
     and status in ('active', 'ending');

  -- ending: 5 days or less remaining
  update club_cards
     set status = 'ending'
   where end_date >= current_date
     and end_date <= current_date + interval '5 days'
     and status = 'active';

  -- thaw: approved freeze whose end_date passed → close it,
  --       and bring its card back to 'active'
  update freezes
     set status = 'rejected', rejected_at = now()
   where status = 'approved'
     and end_date is not null
     and end_date < current_date;

  update club_cards cc
     set status = 'active'
   where cc.status = 'frozen'
     and not exists (
       select 1 from freezes f
        where f.club_card_id = cc.id
          and f.status = 'approved'
          and (f.end_date is null or f.end_date >= current_date)
     );
end $$;

-- ---------------------------------------------------------------------
-- 5. v_child_card_balance — count present + late + makeup (matches
--    payroll formula). Same shape as before, only filter changed.
-- ---------------------------------------------------------------------
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
  coalesce(att.attended_count, 0) as attended_present,
  coalesce(fr.approved_count, 0) as approved_freezes,
  case
    when cc.total_lessons is null then null
    else cc.total_lessons
       - coalesce(att.attended_count, 0)
       + coalesce(fr.approved_count, 0)
  end as remaining
from club_cards cc
left join (
  select a.child_id,
         count(*) filter (where a.status in ('present','late','makeup')) as attended_count
    from attendance a
    join lessons l on l.id = a.lesson_id
   group by a.child_id
) att on att.child_id = cc.child_id
left join (
  select f.club_card_id,
         count(*) filter (where f.status = 'approved') as approved_count
    from freezes f
   group by f.club_card_id
) fr on fr.club_card_id = cc.id;

-- ---------------------------------------------------------------------
-- 6. Optional: schedule via pg_cron if the extension is enabled.
--    On Supabase pg_cron is available on Pro+ plans; if not present,
--    the backend exposes POST /v1/lifecycle/refresh which calls
--    refresh_lifecycle() and can be invoked by Railway/Vercel cron.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('uniqum_lifecycle_daily')
      where exists (select 1 from cron.job where jobname = 'uniqum_lifecycle_daily');
    perform cron.schedule(
      'uniqum_lifecycle_daily',
      '0 1 * * *',                  -- 01:00 every day
      $cron$ select refresh_lifecycle(); $cron$
    );
  end if;
exception when others then
  -- Ignore — pg_cron not available; backend cron will handle it.
  null;
end $$;
