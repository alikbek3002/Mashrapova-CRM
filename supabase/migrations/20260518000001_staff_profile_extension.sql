-- Staff profile extension: HR-поля для сотрудников
-- ИНН (Кыргызстан 14 цифр), дата рождения, дата приёма, адрес, внутренние заметки.

alter table profiles
  add column if not exists inn        text,
  add column if not exists birthday   date,
  add column if not exists hire_date  date,
  add column if not exists address    text,
  add column if not exists notes      text;

-- ИНН Кыргызстана — ровно 14 цифр; null допускается.
alter table profiles
  drop constraint if exists profiles_inn_format;
alter table profiles
  add  constraint profiles_inn_format check (inn is null or inn ~ '^[0-9]{14}$');

-- Уникальность ИНН в рамках организации, не учитывая удалённых.
drop   index if exists profiles_org_inn_uq;
create unique index profiles_org_inn_uq
  on profiles (organization_id, inn)
  where inn is not null and deleted_at is null;
