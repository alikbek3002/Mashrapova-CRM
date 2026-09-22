-- =====================================================================
-- Attendance: 24-hour marking window for coaches.
-- Coach can write to `attendance` only while now() is within 24 hours
-- after the lesson's end (start_time + duration_min). After that —
-- only office staff can fix it.
--
-- lesson.date / lesson.start_time are local wall-clock values in the
-- org's timezone (default 'Asia/Bishkek', see organizations.timezone).
-- We reinterpret them as Asia/Bishkek to get a timestamptz comparable
-- with now().
-- =====================================================================

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
      and now() <=
        (((l.date::timestamp
            + l.start_time::time
            + (l.duration_min || ' minutes')::interval)
          at time zone 'Asia/Bishkek')
         + interval '24 hours')
  )
);
