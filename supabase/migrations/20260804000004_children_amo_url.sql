-- =====================================================================
-- children.amo_url — ссылка на сделку в AmoCRM у каждого ребёнка.
--
-- При импорте из Excel («База.xlsx») ссылки складывались в comment
-- семьи строкой «AMO: <url>». Клиенту нужна ссылка на самом ребёнке,
-- видимая в карточке. Добавляем колонку и бэкфиллим из семей: ссылка
-- семьи достаётся каждому её ребёнку.
-- =====================================================================

alter table children add column if not exists amo_url text;

comment on column children.amo_url is
  'Ссылка на сделку/чат AmoCRM. Заполняется менеджером или импортом.';

update children c
   set amo_url = substring(f.comment from 'AMO:\s*(https?://[^\s]+)')
  from families f
 where f.id = c.family_id
   and c.amo_url is null
   and f.comment ~ 'AMO:\s*https?://';

notify pgrst, 'reload schema';
