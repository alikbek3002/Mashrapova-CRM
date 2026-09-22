-- Стоимость уходит из секции на абонемент: цену вводят при продаже/продлении
-- (club_cards.price_paid через sell_card_with_deposit / renew_card_with_deposit).
-- Секция остаётся справочником направления (название, категория, цвет).

alter table sections drop column if exists subscription_price;
alter table sections drop column if exists trial_price;
