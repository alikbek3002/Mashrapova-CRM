-- =====================================================================
-- club_cards.section_id — для какой секции продан абонемент.
-- Опционально (старые карты остаются без секции), для отчётов и
-- автоподтягивания цены при продлении.
-- =====================================================================

alter table club_cards
  add column if not exists section_id uuid references sections(id);

create index if not exists club_cards_section_id_idx on club_cards(section_id);

comment on column club_cards.section_id is
  'Секция, для которой куплен абонемент (опционально, для отчётов и для продления).';
