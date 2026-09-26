-- =====================================================================
-- Скидки по ТЗ Академии Машрапова §3.3.
--
--   | Скидка              | Размер   | Условие                          |
--   | Второй ребёнок      | −500 сом | фиксированная            — БЫЛО  |
--   | «Приведи друга»     | −300 сом | с абонемента того, кто привёл    |
--   | Индивидуальная      | вручную  | менеджер обязательно указывает причину |
--
-- Скидка на 2-го ребёнка уже работала (org_settings + sell_card_with_deposit).
-- Здесь добавляются две оставшиеся строки таблицы.
--
-- Реферальная программа ведётся ЖУРНАЛОМ (таблица referrals), а не просто
-- разовой скидкой: ТЗ §3.3 требует «геймификацию реферальной программы
-- (карточка со штампами) — версия 2.0, в архитектуре закладывается сразу».
-- Штамп в v2.0 — это строка журнала; считать их по факту будет нечего,
-- если фиксировать только сумму скидки на карте.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Кто кого привёл
-- ---------------------------------------------------------------------
alter table children
  add column if not exists referred_by_child_id uuid references children(id);

comment on column children.referred_by_child_id is
  'ТЗ §3.3: действующий ученик, который привёл этого клиента. Основание для бонуса «Приведи друга».';

create index if not exists children_referred_by_idx
  on children (referred_by_child_id) where referred_by_child_id is not null;

-- Ребёнок не может привести сам себя.
alter table children drop constraint if exists children_referral_not_self;
alter table children add constraint children_referral_not_self
  check (referred_by_child_id is null or referred_by_child_id <> id);

-- ---------------------------------------------------------------------
-- 2. Журнал реферальных бонусов
--
-- Жизненный цикл:
--   pending → приведённый заведён, но абонемент ещё не купил;
--   earned  → приведённый купил абонемент, бонус у реферера доступен;
--   used    → бонус применён к конкретному абонементу реферера;
--   cancelled → бонус аннулирован вручную.
--
-- ТЗ не говорит, в какой момент бонус считается заработанным. Берём
-- покупку абонемента приведённым: иначе −300 можно получить, просто
-- назвав любое имя. Это решение, а не буква ТЗ — вынесено в вопросы
-- к Академии.
-- ---------------------------------------------------------------------
create table if not exists referrals (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  referrer_child_id uuid not null references children(id),
  referred_child_id uuid not null references children(id),
  status text not null default 'pending'
    check (status in ('pending', 'earned', 'used', 'cancelled')),
  reward_amount numeric(12, 2) not null default 300 check (reward_amount >= 0),
  earned_at timestamptz,
  used_card_id uuid references club_cards(id),
  used_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Одного человека приводят один раз.
  unique (referred_child_id)
);

comment on table referrals is
  'ТЗ §3.3: журнал программы «Приведи друга». Строка = один приведённый клиент; в версии 2.0 из этих строк собирается карточка со штампами.';

create index if not exists referrals_referrer_idx
  on referrals (referrer_child_id, status);

create trigger set_updated_at before update on referrals
  for each row execute function trigger_set_updated_at();

alter table referrals enable row level security;

create policy referrals_staff_all on referrals for all
  using (is_staff() and organization_id = auth_org())
  with check (is_staff() and organization_id = auth_org());

-- Родитель видит свои бонусы: пригодится приложению родителя в v2.0.
create policy referrals_parent_read on referrals for select
  using (is_parent() and referrer_child_id in (select parent_child_ids()));

-- Удалять нельзя — только помечать cancelled (ТЗ §2.2).
drop trigger if exists forbid_delete on referrals;
create trigger forbid_delete before delete on referrals
  for each row execute function forbid_delete();

-- ---------------------------------------------------------------------
-- 3. Размер бонуса — в настройках, как и скидка на 2-го ребёнка
-- ---------------------------------------------------------------------
alter table org_settings
  add column if not exists referral_enabled boolean not null default true,
  add column if not exists referral_bonus_amount numeric(12, 2) not null default 300;

alter table org_settings drop constraint if exists org_settings_referral_bonus_positive;
alter table org_settings add constraint org_settings_referral_bonus_positive
  check (referral_bonus_amount >= 0);

comment on column org_settings.referral_bonus_amount is
  'ТЗ §3.3: размер бонуса «Приведи друга», списывается с абонемента того, кто привёл. По ТЗ — 300 сом.';

-- ---------------------------------------------------------------------
-- 4. Причина скидки хранится на карте
--
-- Была только в comment платежа, и то лишь для авто-скидки. По ТЗ §3.3
-- менеджер ОБЯЗАН указать причину индивидуальной скидки — значит она
-- должна быть полем, которое видно в карточке и в отчёте.
-- ---------------------------------------------------------------------
alter table club_cards
  add column if not exists discount_reason text;

comment on column club_cards.discount_reason is
  'ТЗ §3.3: причина скидки. auto_2nd_child / referral — проставляет система; для ручной скидки менеджер обязан указать текст.';

-- ---------------------------------------------------------------------
-- 5. Продажа абонемента: реферальный бонус + обязательная причина
--
-- Сигнатура меняется (+ p_discount_reason), поэтому старую версию
-- дропаем — иначе останутся две перегрузки и вызов станет неоднозначным
-- (паттерн из 20260807000003).
-- ---------------------------------------------------------------------
drop function if exists sell_card_with_deposit(
  uuid, uuid, uuid, card_type, int, int, numeric, numeric, date, date,
  uuid, uuid, payment_method, numeric, numeric, uuid, date, date, numeric,
  uuid, int
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
  p_duration_days int default null,
  p_discount_reason text default null
) returns table (
  card_id uuid,
  applied_discount numeric,
  applied_discount_pct numeric,
  discount_reason text,
  enrollment_id uuid
)
language plpgsql security definer
set search_path = public
as $sell_card$
declare
  v_existing_active uuid;
  v_settings_enabled boolean;
  v_settings_amount numeric;
  v_referral_enabled boolean;
  v_referral_amount numeric;
  v_family_id uuid;
  v_pct_discount numeric;
  v_final_discount numeric;
  v_final_pct numeric;
  v_discount_reason text;
  v_referral_id uuid;
  v_referrer uuid;
  v_card_id uuid;
  v_existing_enrollment uuid;
  v_enrollment_id uuid;
begin
  -- Блокируем только пересекающуюся карту ТОЙ ЖЕ секции (20260827000001):
  -- другая секция — параллельные абонементы разрешены; та же секция со
  -- стартом после конца — «будущее продление».
  select id into v_existing_active
    from club_cards
    where child_id = p_child_id and status in ('active', 'ending')
      and (p_section_id is null or section_id is null or section_id = p_section_id)
      and end_date >= p_start_date
    limit 1;
  if v_existing_active is not null then
    raise exception 'active_card_exists' using errcode = 'P0001';
  end if;

  -- ТЗ §3.3: индивидуальная скидка — только с причиной.
  if coalesce(p_discount_pct, 0) > 0 and coalesce(btrim(p_discount_reason), '') = '' then
    raise exception 'discount_reason_required' using errcode = 'P0001';
  end if;

  v_pct_discount := round((p_price * coalesce(p_discount_pct, 0)) / 100, 2);
  v_final_discount := v_pct_discount;
  v_final_pct := coalesce(p_discount_pct, 0);
  v_discount_reason := nullif(btrim(p_discount_reason), '');

  select sibling_discount_enabled, sibling_discount_amount,
         referral_enabled, referral_bonus_amount
    into v_settings_enabled, v_settings_amount,
         v_referral_enabled, v_referral_amount
    from org_settings where organization_id = p_organization_id;

  -- --- Скидка на 2-го ребёнка (как было: берём большую, не суммируем) ---
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
          else v_final_pct end;
        v_discount_reason := 'auto_2nd_child';
      end if;
    end if;
  end if;

  -- --- «Приведи друга»: бонус СУММИРУЕТСЯ ---
  -- Это заработанная награда за конкретное действие, а не тариф, поэтому
  -- она складывается с ценовой скидкой, а не конкурирует с ней. Берём
  -- один самый ранний доступный бонус на продажу. Скидка не может
  -- превысить цену абонемента.
  if coalesce(v_referral_enabled, true) and coalesce(v_referral_amount, 0) > 0 then
    select id into v_referral_id
      from referrals
     where referrer_child_id = p_child_id
       and status = 'earned'
     order by earned_at nulls last, created_at
     limit 1
     for update skip locked;

    if v_referral_id is not null then
      v_final_discount := least(v_final_discount + v_referral_amount, p_price);
      v_final_pct := case when p_price > 0
        then round((v_final_discount / p_price) * 100, 2) else v_final_pct end;
      v_discount_reason := trim(both ' +' from
        coalesce(v_discount_reason, '') || ' +referral');
    end if;
  end if;

  insert into club_cards (
    organization_id, child_id, type, total_lessons, freeze_quota,
    price_paid, discount, discount_pct, discount_reason, start_date, end_date,
    status, section_id, coach_rate_per_lesson,
    plan_id, duration_days
  ) values (
    p_organization_id, p_child_id, p_type, p_total_lessons, p_freeze_quota,
    p_price, v_final_discount, v_final_pct, v_discount_reason, p_start_date, p_end_date,
    'active', p_section_id, coalesce(p_coach_rate_per_lesson, 100),
    p_plan_id, p_duration_days
  ) returning id into v_card_id;

  -- Бонус погашен — помечаем, на каком именно абонементе.
  if v_referral_id is not null then
    update referrals
       set status = 'used', used_card_id = v_card_id, used_at = now()
     where id = v_referral_id;
  end if;

  -- --- Приведённый купил абонемент → бонус реферера становится доступен ---
  select referred_by_child_id into v_referrer from children where id = p_child_id;
  if v_referrer is not null then
    insert into referrals (
      organization_id, referrer_child_id, referred_child_id,
      status, reward_amount, earned_at, created_by
    ) values (
      p_organization_id, v_referrer, p_child_id,
      'earned', coalesce(v_referral_amount, 300), now(), p_received_by
    )
    on conflict (referred_child_id) do update
      set status = case when referrals.status = 'pending' then 'earned' else referrals.status end,
          earned_at = coalesce(referrals.earned_at, now());
  end if;

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
      -- Окно записи расширяем, а не перезаписываем (20260827000001).
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

comment on function sell_card_with_deposit is
  'Продажа абонемента. ТЗ §3.3: авто-скидка на 2-го ребёнка, бонус «Приведи друга» (суммируется), обязательная причина индивидуальной скидки.';

-- ---------------------------------------------------------------------
-- 6. Отметка «привёл друга» при заведении клиента
--
-- Если ребёнку проставили referred_by_child_id, а приведённый ещё ничего
-- не купил — заводим строку в журнале со статусом pending. Так реферал
-- виден сразу, ещё до продажи, и не теряется.
-- ---------------------------------------------------------------------
create or replace function fn_referral_track() returns trigger
language plpgsql
security definer
set search_path = public
as $referral_track$
declare
  v_changed boolean;
begin
  -- OLD трогаем только в ветке UPDATE: в INSERT-триггере PL/pgSQL
  -- считает OLD неназначенной записью и падает, а короткое замыкание
  -- OR в PostgreSQL не гарантировано.
  if tg_op = 'INSERT' then
    v_changed := new.referred_by_child_id is not null;
  else
    v_changed := new.referred_by_child_id is not null
      and new.referred_by_child_id is distinct from old.referred_by_child_id;
  end if;

  if v_changed then
    insert into referrals (
      organization_id, referrer_child_id, referred_child_id, status, reward_amount
    )
    select
      new.organization_id, new.referred_by_child_id, new.id, 'pending',
      coalesce((select referral_bonus_amount from org_settings
                 where organization_id = new.organization_id), 300)
    on conflict (referred_child_id) do nothing;
  end if;
  return new;
end;
$referral_track$;

drop trigger if exists referral_track on children;
create trigger referral_track
  after insert or update of referred_by_child_id on children
  for each row execute function fn_referral_track();

comment on function fn_referral_track() is
  'ТЗ §3.3: при указании «кто привёл» заводит строку журнала referrals со статусом pending.';

notify pgrst, 'reload schema';
