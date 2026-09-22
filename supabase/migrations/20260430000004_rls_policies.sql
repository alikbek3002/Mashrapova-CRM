-- =====================================================================
-- Row Level Security — DENY by default, allow per role
-- =====================================================================

-- Helper functions
create or replace function auth_role() returns user_role
language sql stable security definer
as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function auth_org() returns uuid
language sql stable security definer
as $$
  select organization_id from profiles where id = auth.uid()
$$;

create or replace function is_staff() returns boolean
language sql stable security definer
as $$
  select coalesce(auth_role() in ('admin','manager','cashier'), false)
$$;

create or replace function is_coach() returns boolean
language sql stable security definer
as $$
  select coalesce(auth_role() = 'coach', false)
$$;

create or replace function is_parent() returns boolean
language sql stable security definer
as $$
  select coalesce(auth_role() = 'parent', false)
$$;

-- Enable RLS on all user-facing tables
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table families enable row level security;
alter table children enable row level security;
alter table coaches enable row level security;
alter table sections enable row level security;
alter table section_coaches enable row level security;
alter table groups enable row level security;
alter table group_schedule enable row level security;
alter table lessons enable row level security;
alter table enrollments enable row level security;
alter table club_cards enable row level security;
alter table attendance enable row level security;
alter table freezes enable row level security;
alter table payments enable row level security;
alter table progress_notes enable row level security;
alter table notifications enable row level security;
alter table leads enable row level security;

-- =====================================================================
-- Profiles: user can read own + staff can read all in org
-- =====================================================================
create policy profiles_self_read on profiles for select
using (id = auth.uid() or (is_staff() and organization_id = auth_org()));

create policy profiles_staff_write on profiles for all
using (is_staff() and organization_id = auth_org())
with check (is_staff() and organization_id = auth_org());

-- =====================================================================
-- Organizations: read own
-- =====================================================================
create policy organizations_read on organizations for select
using (id = auth_org());

-- =====================================================================
-- Families
-- =====================================================================
-- Staff sees all in org; parent sees only own family
create policy families_staff_select on families for select
using (is_staff() and organization_id = auth_org());

create policy families_parent_select on families for select
using (is_parent() and parent_user_id = auth.uid());

-- Staff writes; parents read-only
create policy families_staff_write on families for insert
with check (is_staff() and organization_id = auth_org());

create policy families_staff_update on families for update
using (is_staff() and organization_id = auth_org())
with check (is_staff() and organization_id = auth_org());

-- =====================================================================
-- Children
-- =====================================================================
create policy children_staff_select on children for select
using (is_staff() and organization_id = auth_org());

create policy children_coach_select on children for select
using (
  is_coach() and id in (
    select e.child_id from enrollments e
    join groups g on g.id = e.group_id
    where g.coach_id = auth.uid() and e.archived_at is null
  )
);

create policy children_parent_select on children for select
using (
  is_parent() and family_id in (
    select id from families where parent_user_id = auth.uid()
  )
);

create policy children_staff_write on children for all
using (is_staff() and organization_id = auth_org())
with check (is_staff() and organization_id = auth_org());

-- =====================================================================
-- Coaches
-- =====================================================================
create policy coaches_read on coaches for select
using (
  exists (select 1 from profiles p where p.id = coaches.id and p.organization_id = auth_org())
);

create policy coaches_staff_write on coaches for all
using (is_staff())
with check (is_staff());

-- =====================================================================
-- Sections / section_coaches / groups / group_schedule
-- Read open in org; write — staff only
-- =====================================================================
create policy sections_read on sections for select using (organization_id = auth_org());
create policy sections_staff_write on sections for all
using (is_staff() and organization_id = auth_org())
with check (is_staff() and organization_id = auth_org());

create policy section_coaches_read on section_coaches for select using (
  exists (select 1 from sections s where s.id = section_coaches.section_id and s.organization_id = auth_org())
);
create policy section_coaches_staff_write on section_coaches for all
using (is_staff()) with check (is_staff());

create policy groups_read on groups for select using (organization_id = auth_org());
create policy groups_staff_write on groups for all
using (is_staff() and organization_id = auth_org())
with check (is_staff() and organization_id = auth_org());

create policy group_schedule_read on group_schedule for select using (
  exists (select 1 from groups g where g.id = group_schedule.group_id and g.organization_id = auth_org())
);
create policy group_schedule_staff_write on group_schedule for all
using (is_staff()) with check (is_staff());

-- =====================================================================
-- Lessons
-- =====================================================================
create policy lessons_staff_read on lessons for select
using (is_staff() and organization_id = auth_org());

create policy lessons_coach_read on lessons for select
using (is_coach() and coach_id = auth.uid());

create policy lessons_parent_read on lessons for select
using (
  is_parent() and group_id in (
    select e.group_id from enrollments e
    join children c on c.id = e.child_id
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid() and e.archived_at is null
  )
);

-- WRITE: only staff via direct, but cancel/force-majeure go through backend
create policy lessons_staff_write on lessons for insert
with check (is_staff() and organization_id = auth_org());

create policy lessons_staff_update on lessons for update
using (is_staff() and organization_id = auth_org())
with check (is_staff() and organization_id = auth_org());

-- =====================================================================
-- Enrollments
-- =====================================================================
create policy enrollments_staff_read on enrollments for select
using (
  is_staff() and exists (
    select 1 from groups g where g.id = enrollments.group_id and g.organization_id = auth_org()
  )
);

create policy enrollments_coach_read on enrollments for select
using (
  is_coach() and exists (
    select 1 from groups g where g.id = enrollments.group_id and g.coach_id = auth.uid()
  )
);

create policy enrollments_parent_read on enrollments for select
using (
  is_parent() and child_id in (
    select c.id from children c
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

create policy enrollments_staff_write on enrollments for all
using (is_staff()) with check (is_staff());

-- =====================================================================
-- Club cards: READ для staff/parent. WRITE — только через бэк (service role).
-- =====================================================================
create policy club_cards_staff_read on club_cards for select
using (is_staff() and organization_id = auth_org());

create policy club_cards_parent_read on club_cards for select
using (
  is_parent() and child_id in (
    select c.id from children c
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

create policy club_cards_coach_read on club_cards for select
using (
  is_coach() and child_id in (
    select e.child_id from enrollments e
    join groups g on g.id = e.group_id
    where g.coach_id = auth.uid()
  )
);

-- NO write policies → only service role can insert/update club_cards.

-- =====================================================================
-- Attendance: coach пишет в свои lessons; staff пишет свободно; parent читает.
-- =====================================================================
create policy attendance_staff_read on attendance for select
using (is_staff());

create policy attendance_coach_read on attendance for select
using (
  is_coach() and exists (
    select 1 from lessons l where l.id = attendance.lesson_id and l.coach_id = auth.uid()
  )
);

create policy attendance_parent_read on attendance for select
using (
  is_parent() and child_id in (
    select c.id from children c
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

create policy attendance_coach_write on attendance for all
using (
  is_coach() and exists (
    select 1 from lessons l where l.id = attendance.lesson_id and l.coach_id = auth.uid()
  )
)
with check (
  is_coach() and exists (
    select 1 from lessons l where l.id = attendance.lesson_id and l.coach_id = auth.uid()
  )
);

create policy attendance_staff_write on attendance for all
using (is_staff()) with check (is_staff());

-- =====================================================================
-- Freezes: coach пишет pending; staff читает все; одобрение — только бэк.
-- =====================================================================
create policy freezes_staff_read on freezes for select using (is_staff());

create policy freezes_coach_read on freezes for select
using (
  is_coach() and child_id in (
    select e.child_id from enrollments e
    join groups g on g.id = e.group_id
    where g.coach_id = auth.uid()
  )
);

create policy freezes_parent_read on freezes for select
using (
  is_parent() and child_id in (
    select c.id from children c
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

-- Coach can only insert pending freezes for own kids
create policy freezes_coach_insert on freezes for insert
with check (
  is_coach() and status = 'pending' and initiator_role = 'coach'
  and initiated_by = auth.uid()
  and child_id in (
    select e.child_id from enrollments e
    join groups g on g.id = e.group_id
    where g.coach_id = auth.uid()
  )
);

-- Approve/reject — только service role (через бэк)

-- =====================================================================
-- Payments: READ for staff/parent. WRITE — только бэк (service role).
-- =====================================================================
create policy payments_staff_read on payments for select
using (is_staff() and organization_id = auth_org());

create policy payments_parent_read on payments for select
using (
  is_parent() and child_id in (
    select c.id from children c
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

-- NO write policies → only service role.

-- =====================================================================
-- Progress notes
-- =====================================================================
create policy progress_notes_staff_read on progress_notes for select using (is_staff());

create policy progress_notes_coach_rw on progress_notes for all
using (is_coach() and coach_id = auth.uid())
with check (is_coach() and coach_id = auth.uid());

create policy progress_notes_parent_read on progress_notes for select
using (
  is_parent() and is_public = true
  and child_id in (
    select c.id from children c
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

-- =====================================================================
-- Notifications
-- =====================================================================
create policy notifications_owner_rw on notifications for all
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

-- =====================================================================
-- Leads — staff only
-- =====================================================================
create policy leads_staff_all on leads for all
using (is_staff() and organization_id = auth_org())
with check (is_staff() and organization_id = auth_org());
