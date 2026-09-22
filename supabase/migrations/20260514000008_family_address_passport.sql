-- =====================================================================
-- Семьи: домашний адрес + паспортные данные родителей (КР).
--
-- Все поля necessary, но не обязательные на уровне БД, чтобы старые семьи
-- продолжили работать. Frontend сам решает что требовать.
--
-- Хранятся как free-form text (KR-документы бывают разных форматов:
-- AN1234567, 14-значный ПИН, ID-карта). Валидацию делает UI.
-- =====================================================================

alter table families
  add column if not exists address text,
  add column if not exists father_passport text,
  add column if not exists mother_passport text;

comment on column families.address is 'Домашний адрес семьи (свободная строка)';
comment on column families.father_passport is 'Паспорт/ID отца (КР, free-form)';
comment on column families.mother_passport is 'Паспорт/ID матери (КР, free-form)';
