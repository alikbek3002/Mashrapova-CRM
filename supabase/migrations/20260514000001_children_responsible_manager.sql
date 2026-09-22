-- =====================================================================
-- Children: ответственный менеджер за конкретного ребёнка.
-- Дополняет families.responsible_manager_id (там — менеджер на всю семью);
-- здесь — переопределение/обязательная привязка на уровне ребёнка.
-- =====================================================================

alter table children
  add column if not exists responsible_manager_id uuid references profiles(id);

create index if not exists children_responsible_manager_idx
  on children(responsible_manager_id) where deleted_at is null;

-- Существующая children_staff_select политика разрешает офис-ролям видеть
-- всех детей организации — отдельный manager-only policy не нужен.
-- При создании ребёнка приложение само заполняет responsible_manager_id
-- (по умолчанию = families.responsible_manager_id, либо явный выбор).
