-- =====================================================================
-- Академия Машрапова: адаптация движка Uniqum под ТЗ (docs/ТЗ_Академия_Машрапова.md).
--
--  1) Направление «Фитнес-зона» (§1.3, §4.2, §5.1) — новая категория секции;
--     пакеты абонементов на 6 и 12 месяцев (§4.1).
--  2) Источник клиента на карточке ученика (§3.2): таргет / рекомендация / другое.
--  3) Аудитория группы (§5.1): дети / взрослые / смешанная.
--  4) Удалять данные не может никто (§2.2, §12.3): убираем RPC каскадного
--     удаления и запрещаем DELETE по учётным таблицам — только архивирование.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Фитнес-зона и пакеты 6/12 месяцев
-- ---------------------------------------------------------------------
alter type section_category add value if not exists 'fitness';

-- Пакеты 6 и 12 месяцев. Срок продления берётся из снимка
-- club_cards.duration_days (его всегда пишет форма продажи/тариф).
alter type card_type add value if not exists 'half_year' after 'quarterly';
alter type card_type add value if not exists 'annual' after 'half_year';

-- ---------------------------------------------------------------------
-- 2. Источник клиента
-- ---------------------------------------------------------------------
alter table children
  add column if not exists source text
    check (source is null or source in ('target', 'referral', 'other'));

comment on column children.source is
  'Источник клиента (ТЗ §3.2): target — таргет Instagram, referral — рекомендация, other — другое. Дата регистрации = created_at.';

-- ---------------------------------------------------------------------
-- 3. Аудитория группы
-- ---------------------------------------------------------------------
alter table groups
  add column if not exists audience text not null default 'kids'
    check (audience in ('kids', 'adults', 'mixed'));

comment on column groups.audience is
  'Аудитория группы (ТЗ §5.1): kids — дети, adults — взрослые, mixed — смешанная.';

-- ---------------------------------------------------------------------
-- 4. Запрет удаления
-- ---------------------------------------------------------------------
drop function if exists hard_delete_with_cascade(text, uuid);
drop function if exists archive_dependents_count(text, uuid);

create or replace function forbid_delete() returns trigger
language plpgsql
as $$
begin
  raise exception 'delete_forbidden: % — удаление запрещено, используйте архивирование', tg_table_name
    using errcode = 'P0001';
end;
$$;

comment on function forbid_delete() is
  'ТЗ §2.2: удалять данные не может никто, только архивировать (deleted_at / статус).';

do $$
declare
  t text;
begin
  foreach t in array array[
    'families', 'children', 'coaches', 'sections', 'groups',
    'club_cards', 'payments', 'refunds', 'freezes', 'leads',
    'payroll_periods', 'deposit_transactions', 'audit_log'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists forbid_delete on %I', t);
      execute format(
        'create trigger forbid_delete before delete on %I for each row execute function forbid_delete()', t
      );
    end if;
  end loop;
end $$;
