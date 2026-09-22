-- =====================================================================
-- Каталог абонементов (тарифы) + детали на группе.
--
-- Запрос клиента:
--  1) Секция — общее название направления; детали (возраст, уровень)
--     вносятся при создании группы.
--  2) Виды абонементов на 1/3/9 месяцев с названиями: при продаже менеджер
--     выбирает тариф из списка, а не заполняет цифры руками.
--
-- card_plans — справочник тарифов. Проданная карта хранит снимок
-- (price_paid, total_lessons, duration_days) + ссылку plan_id: изменение
-- тарифа в каталоге не трогает уже проданные абонементы.
-- =====================================================================

create table card_plans (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  name_ru text not null,
  name_ky text not null,
  type card_type not null default 'monthly',
  -- Срок действия карты в днях (30 / 90 / 270 …).
  duration_days int not null check (duration_days > 0),
  -- Кол-во занятий; null = без лимита (personal).
  lessons_count int check (lessons_count > 0),
  price numeric(12, 2) not null check (price >= 0),
  -- Сколько заморозок положено на этот тариф (3 для квартального и т.п.).
  freeze_quota int not null default 0 check (freeze_quota >= 0),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table card_plans is
  'Каталог тарифов абонементов: при продаже менеджер выбирает тариф, поля карты заполняются из него.';

create index idx_card_plans_org on card_plans (organization_id, is_active, sort_order);

create trigger set_updated_at before update on card_plans
  for each row execute function trigger_set_updated_at();

-- ---------------------------------------------------------------------
-- RLS: staff читает (селект тарифа в форме продажи), пишет директор.
-- ---------------------------------------------------------------------
alter table card_plans enable row level security;

create policy card_plans_staff_read on card_plans for select
  using (is_staff() and organization_id = auth_org());

create policy card_plans_director_insert on card_plans for insert
  with check (is_director() and organization_id = auth_org());

create policy card_plans_director_update on card_plans for update
  using (is_director() and organization_id = auth_org())
  with check (is_director() and organization_id = auth_org());

-- ---------------------------------------------------------------------
-- Снимок тарифа на проданной карте.
-- ---------------------------------------------------------------------
alter table club_cards
  add column if not exists plan_id uuid references card_plans(id),
  add column if not exists duration_days int check (duration_days is null or duration_days > 0);

comment on column club_cards.plan_id is
  'Тариф, по которому продана карта (null — цена/срок введены вручную).';
comment on column club_cards.duration_days is
  'Снимок срока тарифа на момент продажи; используется при продлении.';

-- ---------------------------------------------------------------------
-- Детали на группе: секция остаётся общим названием, конкретика — здесь.
-- ---------------------------------------------------------------------
alter table groups
  add column if not exists age_min int check (age_min is null or age_min >= 0),
  add column if not exists age_max int check (age_max is null or age_max >= 0),
  add column if not exists level text;

alter table groups drop constraint if exists groups_age_range_valid;
alter table groups add constraint groups_age_range_valid
  check (age_min is null or age_max is null or age_min <= age_max);

comment on column groups.level is
  'Уровень/примечание группы: «старшая», «ОФП», «начинающие» и т.п.';

-- ---------------------------------------------------------------------
-- Наведение порядка в направлениях секций: раньше фронт определял
-- направление хардкод-словарём по названию (admin/Sections.tsx), потому
-- что секции, созданные через UI, могли иметь category='special'.
-- Теперь направление = category; чиним данные по известным названиям.
-- ---------------------------------------------------------------------
update sections set category = 'therapy'
 where name_ru in ('Здоровая спина и стопы', 'Коррекция осанки', 'Коррекция таза, вальгуса, плоскостопия')
   and category is distinct from 'therapy';

update sections set category = 'developmental'
 where name_ru = 'Развивающая гимнастика'
   and category is distinct from 'developmental';

-- ---------------------------------------------------------------------
-- sell_card_with_deposit: + p_plan_id, p_duration_days (снимок на карту).
-- Сигнатура меняется → дропаем старую версию (паттерн 20260521000003).
-- ---------------------------------------------------------------------
drop function if exists sell_card_with_deposit(
  uuid, uuid, uuid, card_type, int, int, numeric, numeric, date, date,
  uuid, uuid, payment_method, numeric, numeric, uuid, date, date, numeric
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
