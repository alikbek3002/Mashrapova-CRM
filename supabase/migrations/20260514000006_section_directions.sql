-- =====================================================================
-- Реальные направления секций Uniqum Sport (с лендинга uniqumsport.kg).
-- Раньше было 3 категории (gymnastics, martial_arts, special).
-- Добавляем therapy (ЛФК) и developmental (Развивающая гимнастика).
-- =====================================================================

alter type section_category add value if not exists 'therapy';
alter type section_category add value if not exists 'developmental';
