-- =====================================================================
-- club_cards: discount_pct — процент скидки, указанный менеджером
-- при продаже. Сумма скидки в KGS остаётся в club_cards.discount
-- (она может включать авто-скидку 500 сом за 2го ребёнка как минимум).
-- =====================================================================

alter table club_cards
  add column if not exists discount_pct numeric(5,2) not null default 0
    check (discount_pct >= 0 and discount_pct <= 100);
