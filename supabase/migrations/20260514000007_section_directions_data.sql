-- =====================================================================
-- Реальные 11 секций по 4 направлениям (с лендинга uniqumsport.kg).
-- Идемпотентно:
--   1) Удаляем старые тестовые секции, если на них нет ссылок.
--   2) Вставляем 11 новых, если такой по name_ru ещё нет в той же org.
-- Применяется на dev (поверх старого seed) и на prod (на чистой схеме).
-- =====================================================================

-- 1) Чистка старых тестовых секций по каждой организации
delete from sections s
where s.name_ru in (
    'Спортивная гимнастика',
    'Ритмическая гимнастика',
    'Акробатическая',
    'Эстетическая',
    'Акробатика-КА',
    'Единоборства'
  )
  and not exists (select 1 from groups g          where g.section_id = s.id)
  and not exists (select 1 from section_coaches c where c.section_id = s.id);

-- 2) Реальные секции: вставляем для каждой существующей организации
insert into sections (organization_id, name_ru, name_ky, category, subscription_price, trial_price, color)
select o.id, v.name_ru, v.name_ky, v.category, v.subscription_price, v.trial_price, v.color
from organizations o
cross join (values
  ('Здоровая спина и стопы',                  'Дени соо омуртка жана таман',              'therapy'::section_category,       4500::numeric, 500::numeric, '#10b981'),
  ('Коррекция осанки',                        'Дене сөөктү түздөө',                        'therapy'::section_category,       4500::numeric, 500::numeric, '#14b8a6'),
  ('Коррекция таза, вальгуса, плоскостопия',  'Таз, вальгус жана жалпак таманды түздөө',   'therapy'::section_category,       4500::numeric, 500::numeric, '#34d399'),
  ('Спортивная гимнастика',                   'Спорттук гимнастика',                       'gymnastics'::section_category,    5000::numeric, 500::numeric, '#2563eb'),
  ('Акробатика',                              'Акробатика',                                'gymnastics'::section_category,    4500::numeric, 500::numeric, '#0ea5e9'),
  ('Аэробная гимнастика',                     'Аэробдук гимнастика',                       'gymnastics'::section_category,    4500::numeric, 500::numeric, '#a855f7'),
  ('Эстетическая гимнастика',                 'Эстетикалык гимнастика',                    'gymnastics'::section_category,    4500::numeric, 500::numeric, '#ec4899'),
  ('Дзюдо',                                   'Дзюдо',                                     'martial_arts'::section_category,  4500::numeric, 500::numeric, '#ef4444'),
  ('Тхэквондо ITF',                           'Тхэквондо ITF',                             'martial_arts'::section_category,  4500::numeric, 500::numeric, '#f97316'),
  ('Бокс',                                    'Бокс',                                      'martial_arts'::section_category,  5000::numeric, 500::numeric, '#dc2626'),
  ('Развивающая гимнастика',                  'Өнүктүрүүчү гимнастика',                    'developmental'::section_category, 4000::numeric, 500::numeric, '#fbbf24')
) as v(name_ru, name_ky, category, subscription_price, trial_price, color)
where not exists (
  select 1 from sections s
  where s.organization_id = o.id
    and s.name_ru = v.name_ru
    and s.deleted_at is null
);
