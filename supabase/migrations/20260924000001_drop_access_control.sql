-- =====================================================================
-- Удаление интеграции с турникетами (Hikvision Face ID / ISUP).
-- Для «Академии Машрапова» пропускная система не используется —
-- убираем таблицы, колонки, функции и настройки проходной,
-- добавленные миграциями 20260820000002..04 и 20260905000001.
-- =====================================================================

drop function if exists public.fn_access_windows(date);
drop function if exists public.next_access_person_no();

drop table if exists access_grants;
drop table if exists access_door_commands;
drop table if exists access_events;
drop table if exists access_devices;

alter table children
  drop column if exists access_person_no,
  drop column if exists face_photo_path,
  drop column if exists face_enrolled_at;

alter table org_settings
  drop column if exists access_schedule_enabled,
  drop column if exists access_before_min,
  drop column if exists access_after_min,
  drop column if exists access_auto_exit_hours;

-- Проведение ПТ: источник «turnstile» больше невозможен.
update pt_sessions set completed_source = 'admin' where completed_source = 'turnstile';
alter table pt_sessions drop constraint if exists pt_sessions_completed_source_check;
alter table pt_sessions add constraint pt_sessions_completed_source_check
  check (completed_source in ('coach', 'admin'));
