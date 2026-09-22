-- =====================================================================
-- Seed data — minimal smoke set for dev environment
-- DO NOT run on production.
--
-- Note: на prod секции вставляются миграцией 20260514000007 (через
-- cross join по существующим organizations). Здесь, на свежей dev-БД,
-- организация только что создаётся, поэтому секции добавляем сразу
-- идемпотентно (where not exists) — повторный seed не дублирует.
-- =====================================================================

-- Organization
insert into organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Uniqum Sport (dev)');

-- Реальные 11 секций по 4 направлениям (с лендинга uniqumsport.kg).
-- Цен здесь нет: стоимость задаётся на абонементе при продаже (20260807000001).
insert into sections (organization_id, name_ru, name_ky, category, color)
select '00000000-0000-0000-0000-000000000001'::uuid, v.name_ru, v.name_ky, v.category, v.color
from (values
  ('Здоровая спина и стопы',                  'Дени соо омуртка жана таман',              'therapy'::section_category,       '#10b981'),
  ('Коррекция осанки',                        'Дене сөөктү түздөө',                        'therapy'::section_category,       '#14b8a6'),
  ('Коррекция таза, вальгуса, плоскостопия',  'Таз, вальгус жана жалпак таманды түздөө',   'therapy'::section_category,       '#34d399'),
  ('Спортивная гимнастика',                   'Спорттук гимнастика',                       'gymnastics'::section_category,    '#2563eb'),
  ('Акробатика',                              'Акробатика',                                'gymnastics'::section_category,    '#0ea5e9'),
  ('Аэробная гимнастика',                     'Аэробдук гимнастика',                       'gymnastics'::section_category,    '#a855f7'),
  ('Эстетическая гимнастика',                 'Эстетикалык гимнастика',                    'gymnastics'::section_category,    '#ec4899'),
  ('Дзюдо',                                   'Дзюдо',                                     'martial_arts'::section_category,  '#ef4444'),
  ('Тхэквондо ITF',                           'Тхэквондо ITF',                             'martial_arts'::section_category,  '#f97316'),
  ('Бокс',                                    'Бокс',                                      'martial_arts'::section_category,  '#dc2626'),
  ('Развивающая гимнастика',                  'Өнүктүрүүчү гимнастика',                    'developmental'::section_category, '#fbbf24')
) as v(name_ru, name_ky, category, color)
where not exists (
  select 1 from sections s
  where s.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
    and s.name_ru = v.name_ru
    and s.deleted_at is null
);

-- Каталог тарифов (20260807000003): при продаже менеджер выбирает тариф,
-- поля карты заполняются из него. Цены — дев-заглушки.
insert into card_plans (organization_id, name_ru, name_ky, type, duration_days, lessons_count, price, freeze_quota, sort_order)
select '00000000-0000-0000-0000-000000000001'::uuid, v.name_ru, v.name_ky, v.type, v.duration_days, v.lessons_count, v.price, v.freeze_quota, v.sort_order
from (values
  ('Пробное занятие',        'Сыноо сабагы',    'trial'::card_type,      30,   1,   500::numeric, 0, 10),
  ('Разовое занятие',        'Бир жолку сабак', 'single'::card_type,     30,   1,   500::numeric, 0, 20),
  ('1 месяц · 12 занятий',   '1 ай · 12 сабак', 'monthly'::card_type,    30,  12,  5000::numeric, 0, 30),
  ('3 месяца · 36 занятий',  '3 ай · 36 сабак', 'quarterly'::card_type,  90,  36, 13500::numeric, 3, 40),
  ('9 месяцев · 108 занятий','9 ай · 108 сабак','nine_month'::card_type, 270, 108, 36000::numeric, 9, 50)
) as v(name_ru, name_ky, type, duration_days, lessons_count, price, freeze_quota, sort_order)
where not exists (
  select 1 from card_plans p
  where p.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
    and p.name_ru = v.name_ru
);

-- Note: profiles seed requires auth.users entries first.
-- Use Supabase dashboard or `supabase auth signup` to create test users,
-- then insert matching profiles rows manually with their IDs.
