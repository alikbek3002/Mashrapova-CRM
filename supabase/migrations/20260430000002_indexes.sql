-- =====================================================================
-- Performance indexes
-- =====================================================================

-- Search by names (trigram for fuzzy matching)
create index children_full_name_trgm on children using gin (full_name gin_trgm_ops);
create index families_father_name_trgm on families using gin (father_name gin_trgm_ops);
create index families_mother_name_trgm on families using gin (mother_name gin_trgm_ops);

-- Phone searches
create index families_father_phone on families (father_phone) where father_phone is not null;
create index families_mother_phone on families (mother_phone) where mother_phone is not null;

-- FK navigation
create index children_family_id on children (family_id) where deleted_at is null;
create index children_org on children (organization_id) where deleted_at is null;

-- Schedule queries
create index lessons_date_group on lessons (date, group_id);
create index lessons_coach_date on lessons (coach_id, date);

-- Attendance queries
create index attendance_lesson on attendance (lesson_id);
create index attendance_child_lesson on attendance (child_id, lesson_id);

-- Card queries
create index club_cards_child_status on club_cards (child_id, status);
create index club_cards_ending on club_cards (end_date) where status in ('active', 'ending');

-- Payments
create index payments_child_paid on payments (child_id, paid_at desc);
create index payments_org_paid on payments (organization_id, paid_at desc);

-- Notifications
create index notifications_recipient_unread on notifications (recipient_id, is_read, created_at desc);

-- Enrollments
create index enrollments_group_active on enrollments (group_id) where archived_at is null;
create index enrollments_child_active on enrollments (child_id) where archived_at is null;

-- Idempotency keys cleanup
create index idempotency_keys_created on idempotency_keys (created_at);
