-- =====================================================================
-- Fix RLS infinite recursion: child <-> enrollments <-> groups <-> families
-- Wrap cross-table membership lookups in security-definer helper functions
-- so the inner queries bypass RLS and break the cycle.
-- =====================================================================

-- Helper: child_ids visible to the current parent
create or replace function parent_child_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select c.id from children c
  join families f on f.id = c.family_id
  where f.parent_user_id = auth.uid()
$$;

-- Helper: family_ids owned by the current parent
create or replace function parent_family_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select id from families where parent_user_id = auth.uid()
$$;

-- Helper: child_ids visible to the current coach
create or replace function coach_child_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select e.child_id from enrollments e
  join groups g on g.id = e.group_id
  where g.coach_id = auth.uid() and e.archived_at is null
$$;

-- Helper: group_ids owned by the current coach
create or replace function coach_group_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select id from groups where coach_id = auth.uid()
$$;

-- Helper: lesson_ids the current coach is assigned to
create or replace function coach_lesson_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select id from lessons where coach_id = auth.uid()
$$;

-- =====================================================================
-- Children — drop and recreate parent/coach select policies
-- =====================================================================
drop policy if exists children_coach_select on children;
drop policy if exists children_parent_select on children;

create policy children_coach_select on children for select
using (is_coach() and id in (select coach_child_ids()));

create policy children_parent_select on children for select
using (is_parent() and family_id in (select parent_family_ids()));

-- =====================================================================
-- Enrollments — replace parent/coach select policies
-- =====================================================================
drop policy if exists enrollments_coach_read on enrollments;
drop policy if exists enrollments_parent_read on enrollments;

create policy enrollments_coach_read on enrollments for select
using (is_coach() and group_id in (select coach_group_ids()));

create policy enrollments_parent_read on enrollments for select
using (is_parent() and child_id in (select parent_child_ids()));

-- =====================================================================
-- Lessons — parent read
-- =====================================================================
drop policy if exists lessons_parent_read on lessons;

create policy lessons_parent_read on lessons for select
using (
  is_parent() and group_id in (
    select e.group_id from enrollments e where e.child_id in (select parent_child_ids()) and e.archived_at is null
  )
);

-- =====================================================================
-- Club cards — parent + coach read
-- =====================================================================
drop policy if exists club_cards_parent_read on club_cards;
drop policy if exists club_cards_coach_read on club_cards;

create policy club_cards_parent_read on club_cards for select
using (is_parent() and child_id in (select parent_child_ids()));

create policy club_cards_coach_read on club_cards for select
using (is_coach() and child_id in (select coach_child_ids()));

-- =====================================================================
-- Attendance — parent read; coach read/write
-- =====================================================================
drop policy if exists attendance_parent_read on attendance;
drop policy if exists attendance_coach_read on attendance;
drop policy if exists attendance_coach_write on attendance;

create policy attendance_parent_read on attendance for select
using (is_parent() and child_id in (select parent_child_ids()));

create policy attendance_coach_read on attendance for select
using (is_coach() and lesson_id in (select coach_lesson_ids()));

create policy attendance_coach_write on attendance for all
using (is_coach() and lesson_id in (select coach_lesson_ids()))
with check (is_coach() and lesson_id in (select coach_lesson_ids()));

-- =====================================================================
-- Freezes — parent + coach read; coach insert
-- =====================================================================
drop policy if exists freezes_parent_read on freezes;
drop policy if exists freezes_coach_read on freezes;
drop policy if exists freezes_coach_insert on freezes;

create policy freezes_parent_read on freezes for select
using (is_parent() and child_id in (select parent_child_ids()));

create policy freezes_coach_read on freezes for select
using (is_coach() and child_id in (select coach_child_ids()));

create policy freezes_coach_insert on freezes for insert
with check (
  is_coach() and status = 'pending' and initiator_role = 'coach'
  and initiated_by = auth.uid()
  and child_id in (select coach_child_ids())
);

-- =====================================================================
-- Payments — parent read
-- =====================================================================
drop policy if exists payments_parent_read on payments;

create policy payments_parent_read on payments for select
using (is_parent() and child_id in (select parent_child_ids()));

-- =====================================================================
-- Progress notes — parent read
-- =====================================================================
drop policy if exists progress_notes_parent_read on progress_notes;

create policy progress_notes_parent_read on progress_notes for select
using (is_parent() and is_public = true and child_id in (select parent_child_ids()));
