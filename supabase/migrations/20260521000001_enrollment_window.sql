-- =====================================================================
-- Окно записи (date-window enrollment).
--
-- Ребёнок числится в группе только в окне [start_date, end_date]:
-- от даты первой тренировки до даты N-го (12/36) занятия по расписанию
-- группы. Ростер-запросы фильтруют по окну; refresh_lifecycle()
-- архивирует записи с истёкшим окном. NULL на любой границе = открытое
-- окно (legacy/ручные записи ведут себя как раньше — видны всегда).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Колонки окна на enrollments
-- ---------------------------------------------------------------------
alter table enrollments add column if not exists start_date date;
alter table enrollments add column if not exists end_date   date;

comment on column enrollments.start_date is
  'Дата первой тренировки окна. NULL = открыто (legacy/ручная запись).';
comment on column enrollments.end_date is
  'Дата N-го занятия окна. NULL = открыто. Ростер прячет ребёнка после этой даты.';

-- Ростер читает по (group_id, end_date) среди активных записей.
create index if not exists enrollments_group_window_idx
  on enrollments (group_id, end_date)
  where archived_at is null;

-- ---------------------------------------------------------------------
-- 2. sell_card_with_deposit — добавляем окно записи.
--    Сигнатура меняется (2 новых параметра) → дропаем старую версию,
--    иначе остаётся неоднозначный overload (16-арг + 18-арг с default).
-- ---------------------------------------------------------------------
drop function if exists sell_card_with_deposit(
  uuid, uuid, uuid, card_type, int, int, numeric, numeric, date, date,
  uuid, uuid, payment_method, numeric, numeric, uuid
);

create or replace function sell_card_with_deposit(
  p_organization_id uuid,
  p_child_id uuid,
  p_received_by uuid,
  p_type card_type,
  p_total_lessons int,
  p_freeze_quota int,
  p_price numeric,
  p_discount_pct numeric,
  p_start_date date,
  p_end_date date,
  p_section_id uuid,
  p_group_id uuid,
  p_payment_method payment_method,
  p_deposit_amount numeric,
  p_cash_amount numeric,
  p_idempotency_key uuid,
  p_enrollment_start_date date default null,
  p_enrollment_end_date date default null
) returns table (
  card_id uuid,
  applied_discount numeric,
  applied_discount_pct numeric,
  discount_reason text,
  enrollment_id uuid
)
language plpgsql security definer
as $sell_card$
declare
  v_existing_active uuid;
  v_settings_enabled boolean;
  v_settings_amount numeric;
  v_family_id uuid;
  v_pct_discount numeric;
  v_final_discount numeric;
  v_final_pct numeric;
  v_discount_reason text;
  v_card_id uuid;
  v_existing_enrollment uuid;
  v_enrollment_id uuid;
begin
  select id into v_existing_active
    from club_cards
    where child_id = p_child_id and status in ('active', 'ending')
    limit 1;
  if v_existing_active is not null then
    raise exception 'active_card_exists' using errcode = 'P0001';
  end if;

  v_pct_discount := round((p_price * p_discount_pct) / 100, 2);
  v_final_discount := v_pct_discount;
  v_final_pct := p_discount_pct;
  v_discount_reason := null;

  select sibling_discount_enabled, sibling_discount_amount
    into v_settings_enabled, v_settings_amount
    from org_settings where organization_id = p_organization_id;

  if v_settings_enabled and coalesce(v_settings_amount, 0) > 0 then
    select family_id into v_family_id from children where id = p_child_id;
    if v_family_id is not null then
      perform 1 from club_cards cc
        join children c on c.id = cc.child_id
        where c.family_id = v_family_id
          and cc.child_id <> p_child_id
          and cc.status in ('active', 'ending')
        limit 1;
      if found and v_final_discount < v_settings_amount then
        v_final_discount := v_settings_amount;
        v_final_pct := case when p_price > 0
          then round((v_settings_amount / p_price) * 100, 2)
          else p_discount_pct end;
        v_discount_reason := 'auto_2nd_child';
      end if;
    end if;
  end if;

  insert into club_cards (
    organization_id, child_id, type, total_lessons, freeze_quota,
    price_paid, discount, discount_pct, start_date, end_date,
    status, section_id
  ) values (
    p_organization_id, p_child_id, p_type, p_total_lessons, p_freeze_quota,
    p_price, v_final_discount, v_final_pct, p_start_date, p_end_date,
    'active', p_section_id
  ) returning id into v_card_id;

  if p_deposit_amount > 0 then
    insert into deposit_transactions (
      organization_id, child_id, amount, type,
      related_card_id, received_by, comment, idempotency_key
    ) values (
      p_organization_id, p_child_id, -p_deposit_amount, 'card_purchase',
      v_card_id, p_received_by, v_discount_reason, p_idempotency_key
    );
  end if;

  if p_cash_amount > 0 then
    insert into payments (
      organization_id, child_id, club_card_id, amount, method,
      received_by, comment, idempotency_key
    ) values (
      p_organization_id, p_child_id, v_card_id, p_cash_amount, p_payment_method,
      p_received_by, v_discount_reason, p_idempotency_key
    );
  end if;

  v_enrollment_id := null;
  if p_group_id is not null then
    select id into v_existing_enrollment
      from enrollments
      where child_id = p_child_id and group_id = p_group_id and archived_at is null
      limit 1;
    if v_existing_enrollment is not null then
      -- Новая продажа пере-задаёт окно записи существующей активной записи.
      update enrollments
         set start_date = p_enrollment_start_date,
             end_date   = p_enrollment_end_date
       where id = v_existing_enrollment;
      v_enrollment_id := v_existing_enrollment;
    else
      insert into enrollments (child_id, group_id, enrolled_at, start_date, end_date)
        values (p_child_id, p_group_id, current_date,
                p_enrollment_start_date, p_enrollment_end_date)
        returning id into v_enrollment_id;
    end if;
  end if;

  card_id := v_card_id;
  applied_discount := v_final_discount;
  applied_discount_pct := v_final_pct;
  discount_reason := v_discount_reason;
  enrollment_id := v_enrollment_id;
  return next;
end;
$sell_card$;

-- ---------------------------------------------------------------------
-- 3. refresh_lifecycle — добавляем архивацию записей с истёкшим окном.
--    Стоп-гард: записи замороженных карт не архивируем (окно не должно
--    «протухнуть» во время заморозки — точный сдвиг окна = Phase 2).
-- ---------------------------------------------------------------------
create or replace function refresh_lifecycle() returns void
language plpgsql security definer as $$
begin
  -- expired: end_date already passed
  update club_cards
     set status = 'expired'
   where end_date < current_date
     and status in ('active', 'ending');

  -- ending: 5 days or less remaining
  update club_cards
     set status = 'ending'
   where end_date >= current_date
     and end_date <= current_date + interval '5 days'
     and status = 'active';

  -- thaw: approved freeze whose end_date passed → close it,
  --       and bring its card back to 'active'
  update freezes
     set status = 'rejected', rejected_at = now()
   where status = 'approved'
     and end_date is not null
     and end_date < current_date;

  update club_cards cc
     set status = 'active'
   where cc.status = 'frozen'
     and not exists (
       select 1 from freezes f
        where f.club_card_id = cc.id
          and f.status = 'approved'
          and (f.end_date is null or f.end_date >= current_date)
     );

  -- archive enrollments whose window has fully elapsed (auto-выход из группы).
  -- Стоп-гард: пропускаем детей с замороженной картой.
  update enrollments e
     set archived_at = now()
   where e.archived_at is null
     and e.end_date is not null
     and e.end_date < current_date
     and not exists (
       select 1 from club_cards cc
        where cc.child_id = e.child_id and cc.status = 'frozen'
     );
end $$;
