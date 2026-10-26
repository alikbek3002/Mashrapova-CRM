-- =====================================================================
-- Источники клиента и лида: больше вариантов (просьба клиента 2026-10-20)
-- =====================================================================
-- ТЗ §3.2 и §8.1 перечисляли три-четыре источника: таргет, рекомендация,
-- прямое обращение, другое. Офису этого мало — клиент попросил больше
-- вариантов, чтобы видеть, откуда приходят люди. Список один для
-- ученика и для лида, чтобы каналы сравнивались между собой.
-- Тот же список держит фронтенд: frontend/src/shared/sources.ts.
--
-- Старые значения не меняются. У ученика добавлен и 'direct', который
-- раньше был только у лида.

-- Проверка на children.source создавалась без имени (inline в add column),
-- поэтому снимаем её по определению, а не по имени.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.children'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.children drop constraint %I', c);
  end loop;
end $$;

alter table children add constraint children_source_valid check (
  source is null or source in (
    'target', 'instagram', 'tiktok', 'blogger', 'maps', 'messenger',
    'referral', 'sibling', 'returning',
    'direct', 'event', 'offline_ads',
    'other'
  )
);

alter table leads drop constraint if exists leads_source_valid;
alter table leads add constraint leads_source_valid check (
  source is null or source in (
    'target', 'instagram', 'tiktok', 'blogger', 'maps', 'messenger',
    'referral', 'sibling', 'returning',
    'direct', 'event', 'offline_ads',
    'other'
  )
);

comment on column children.source is
  'Источник клиента (ТЗ §3.2, расширено 2026-10-20): target — таргет Instagram, instagram — страница и сторис, tiktok, blogger — блогер, maps — 2ГИС/Google Карты, messenger — WhatsApp/Telegram, referral — рекомендация, sibling — брат или сестра уже занимается, returning — занимался раньше, direct — пришёл сам, event — соревнования/мероприятие, offline_ads — листовки/баннер, other — другое. Дата регистрации = created_at.';

comment on column leads.source is
  'Источник лида (ТЗ §8.1, расширено 2026-10-20): те же значения, что у children.source.';
