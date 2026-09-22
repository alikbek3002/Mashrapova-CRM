-- =====================================================================
-- Подготовка к логину по телефону: уникальный индекс на profiles.phone
-- (среди активных записей). Никаких других изменений схемы не требуется —
-- email в profiles уже nullable, citext без unique-constraint.
-- =====================================================================

create unique index if not exists profiles_phone_unique
  on profiles(phone)
  where deleted_at is null and phone is not null;
