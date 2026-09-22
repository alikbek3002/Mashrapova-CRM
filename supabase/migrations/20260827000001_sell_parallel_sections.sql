-- =====================================================================
-- Продажа абонемента: параллельные секции и будущее продление.
--
-- Жалобы офиса 2026-08-27:
--  1) «не можем добавить второй абонемент на другую секцию» — guard в
--     sell_card_with_deposit блокировал продажу при ЛЮБОЙ активной карте
--     ребёнка, хотя баланс давно по-секционный.
--  2) «не можем добавить на будущее продление» — та же блокировка не
--     пускала карту той же секции со стартом после конца текущей.
--
-- Guard теперь блокирует только пересекающуюся карту той же секции.
-- Заодно окно записи при продаже в существующую группу расширяется
-- (least/greatest), а не перезаписывается.
-- =====================================================================

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
  p_enrollment_end_date date default null,
  p_coach_rate_per_lesson numeric default 100,
  p_plan_id uuid default null,
  p_duration_days int default null
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
  -- Блокируем только пересекающуюся карту ТОЙ ЖЕ секции:
  --  * другая секция — параллельные абонементы разрешены (баланс
  --    по-секционный, 20260809000001);
  --  * та же секция, но старт после конца карты — «будущее продление»,
  --    периоды сцепляются, конфликта нет.
  -- Карты без секции (legacy) по-прежнему блокируют всё.
  select id into v_existing_active
    from club_cards
    where child_id = p_child_id and status in ('active', 'ending')
      and (p_section_id is null or section_id is null or section_id = p_section_id)
      and end_date >= p_start_date
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
    status, section_id, coach_rate_per_lesson,
    plan_id, duration_days
  ) values (
    p_organization_id, p_child_id, p_type, p_total_lessons, p_freeze_quota,
    p_price, v_final_discount, v_final_pct, p_start_date, p_end_date,
    'active', p_section_id, coalesce(p_coach_rate_per_lesson, 100),
    p_plan_id, p_duration_days
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
      -- Окно записи расширяем, а не перезаписываем: при будущей продаже
      -- (старт после конца текущей карты) ребёнок не должен пропадать из
      -- табеля до начала нового периода.
      update enrollments
         set start_date = case when p_enrollment_start_date is null then null
               else least(coalesce(start_date, p_enrollment_start_date), p_enrollment_start_date) end,
             end_date   = case when p_enrollment_end_date is null then null
               else greatest(coalesce(end_date, p_enrollment_end_date), p_enrollment_end_date) end
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
-- renew_card_with_deposit: период нового абонемента берём из снимка
-- duration_days старой карты (раньше — хардкод 30/90 по типу); тариф и
-- срок копируются на новую карту.
-- ---------------------------------------------------------------------
create or replace function renew_card_with_deposit(
  p_organization_id uuid,
  p_received_by uuid,
  p_card_id uuid,
  p_price numeric,
  p_discount_pct numeric,
  p_payment_method payment_method,
  p_deposit_amount numeric,
  p_cash_amount numeric,
  p_idempotency_key uuid
) returns table (
  new_card_id uuid,
  applied_discount numeric,
  start_date date,
  end_date date
)
language plpgsql security definer
as $renew_card$
declare
  v_old_card record;
  v_pct_discount numeric;
  v_final_discount numeric;
  v_period_days int;
  v_new_start date;
  v_new_end date;
  v_new_card_id uuid;
begin
  select * into v_old_card from club_cards where id = p_card_id;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;

  v_period_days := coalesce(
    v_old_card.duration_days,
    case v_old_card.type
      when 'quarterly' then 90
      when 'nine_month' then 270
      else 30
    end);

  v_new_start := greatest(current_date, v_old_card.end_date + 1);
  v_new_end := v_new_start + v_period_days - 1;

  v_pct_discount := round((p_price * p_discount_pct) / 100, 2);
  v_final_discount := v_pct_discount;

  insert into club_cards (
    organization_id, child_id, type, total_lessons, freeze_quota,
    price_paid, discount, discount_pct, start_date, end_date,
    status, section_id, plan_id, duration_days
  ) values (
    p_organization_id, v_old_card.child_id, v_old_card.type, v_old_card.total_lessons, v_old_card.freeze_quota,
    p_price, v_final_discount, p_discount_pct, v_new_start, v_new_end,
    'active', v_old_card.section_id, v_old_card.plan_id, v_old_card.duration_days
  ) returning id into v_new_card_id;

  if p_deposit_amount > 0 then
    insert into deposit_transactions (
      organization_id, child_id, amount, type,
      related_card_id, received_by, idempotency_key
    ) values (
      p_organization_id, v_old_card.child_id, -p_deposit_amount, 'card_renewal',
      v_new_card_id, p_received_by, p_idempotency_key
    );
  end if;

  if p_cash_amount > 0 then
    insert into payments (
      organization_id, child_id, club_card_id, amount, method,
      received_by, idempotency_key
    ) values (
      p_organization_id, v_old_card.child_id, v_new_card_id, p_cash_amount, p_payment_method,
      p_received_by, p_idempotency_key
    );
  end if;

  new_card_id := v_new_card_id;
  applied_discount := v_final_discount;
  start_date := v_new_start;
  end_date := v_new_end;
  return next;
end;
$renew_card$;

notify pgrst, 'reload schema';


notify pgrst, 'reload schema';
