-- =====================================================================
-- Attendance: forbid marking lessons in the future.
-- Posseschienie can only be recorded for lessons whose date <= today.
-- Defense in depth: frontend disables UI, backend validates, RLS enforces.
-- =====================================================================

-- Replace the coach write policy: must be the lesson's coach AND the
-- lesson must already have happened (date <= today).
drop policy if exists attendance_coach_write on attendance;
create policy attendance_coach_write on attendance for all
using (
  is_coach() and exists (
    select 1 from lessons l
    where l.id = attendance.lesson_id
      and l.coach_id = auth.uid()
  )
)
with check (
  is_coach() and exists (
    select 1 from lessons l
    where l.id = attendance.lesson_id
      and l.coach_id = auth.uid()
      and l.date <= current_date
  )
);

-- Replace the staff write policy: any office role can edit any lesson
-- in their org, but still not in the future.
drop policy if exists attendance_staff_write on attendance;
create policy attendance_staff_write on attendance for all
using (is_staff())
with check (
  is_staff()
  and exists (
    select 1 from lessons l
    where l.id = attendance.lesson_id
      and l.date <= current_date
  )
);
