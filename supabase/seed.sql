-- =====================================================================
-- Seed data — dev-набор для Академии Машрапова (Ош).
-- DO NOT run on production.
--
-- Секции и тарифы — по ТЗ (docs/ТЗ_Академия_Машрапова.md §1.3, §4.1, §4.2).
-- Идемпотентно (where not exists): повторный seed не дублирует.
-- =====================================================================

-- Organization
insert into organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Академия Машрапова (dev)')
on conflict (id) do nothing;

insert into org_settings (organization_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (organization_id) do nothing;

-- 6 дисциплин единоборств + фитнес-зона.
insert into sections (organization_id, name_ru, name_ky, category, color)
select '00000000-0000-0000-0000-000000000001'::uuid, v.name_ru, v.name_ky, v.category, v.color
from (values
  ('Бокс',            'Бокс',             'martial_arts'::section_category, '#dc2626'),
  ('ММА',             'ММА',              'martial_arts'::section_category, '#7c3aed'),
  ('Вольная борьба',  'Эркин күрөш',      'martial_arts'::section_category, '#2563eb'),
  ('Дзюдо',           'Дзюдо',            'martial_arts'::section_category, '#0891b2'),
  ('Кикбоксинг',      'Кикбоксинг',       'martial_arts'::section_category, '#ea580c'),
  ('Таэквондо',       'Таэквондо',        'martial_arts'::section_category, '#16a34a'),
  ('Фитнес-зона',     'Фитнес-зона',      'fitness'::section_category,      '#475569')
) as v(name_ru, name_ky, category, color)
where not exists (
  select 1 from sections s
  where s.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
    and s.name_ru = v.name_ru
    and s.deleted_at is null
);

-- Каталог тарифов (ТЗ §4.1 — единоборства, §4.2 — фитнес-зона).
-- Кол-во занятий в ТЗ не указано: «через день» ≈ 12 тренировок в месяц,
-- «каждый день» ≈ 26. Цены разовой/пробной «по секции» — заглушка 500 сом,
-- уточнить у Академии. Скидка 2-го ребёнка (−500) — org_settings, не тариф.
insert into card_plans (organization_id, name_ru, name_ky, type, duration_days, lessons_count, price, freeze_quota, sort_order)
select '00000000-0000-0000-0000-000000000001'::uuid, v.name_ru, v.name_ky, v.type, v.duration_days, v.lessons_count, v.price, v.freeze_quota, v.sort_order
from (values
  -- Единоборства
  ('Пробная тренировка',               'Сыноо машыгуу',               'trial'::card_type,     30,   1,   500::numeric, 0, 10),
  ('Разовое занятие',                  'Бир жолку сабак',             'single'::card_type,    30,   1,   500::numeric, 0, 20),
  ('Детский · 1 месяц (через день)',   'Балдар · 1 ай (күн аралап)',  'monthly'::card_type,   30,  12,  2500::numeric, 0, 30),
  ('Взрослый · 1 месяц (через день)',  'Чоңдор · 1 ай (күн аралап)',  'monthly'::card_type,   30,  12,  2800::numeric, 0, 40),
  ('Пакет 3 месяца (−15%)',            '3 айлык пакет (−15%)',        'quarterly'::card_type, 90,  36,  6375::numeric, 1, 50),
  ('Пакет 6 месяцев (−20%)',           '6 айлык пакет (−20%)',        'half_year'::card_type, 180, 72, 12000::numeric, 2, 60),
  ('Пакет 12 месяцев (−40%)',          '12 айлык пакет (−40%)',       'annual'::card_type,    360, 144, 18000::numeric, 3, 70),
  -- Фитнес-зона
  ('Фитнес · каждый день',             'Фитнес · күн сайын',          'monthly'::card_type,   30,  26,  3000::numeric, 0, 110),
  ('Фитнес · через день',              'Фитнес · күн аралап',         'monthly'::card_type,   30,  12,  2500::numeric, 0, 120),
  ('Фитнес · комбо для ученика',       'Фитнес · окуучу үчүн комбо',  'monthly'::card_type,   30,  26,  1500::numeric, 0, 130),
  ('Фитнес · разовое посещение',       'Фитнес · бир жолку',          'single'::card_type,    30,   1,   400::numeric, 0, 140)
) as v(name_ru, name_ky, type, duration_days, lessons_count, price, freeze_quota, sort_order)
where not exists (
  select 1 from card_plans p
  where p.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
    and p.name_ru = v.name_ru
);

-- Note: profiles seed requires auth.users entries first.
-- Test users: node backend/scripts/seed-test-users.mjs (…@mashrapov.test).
