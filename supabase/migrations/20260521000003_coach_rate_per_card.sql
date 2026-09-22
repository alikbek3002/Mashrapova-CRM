-- =====================================================================
-- Ставка тренера на каждой карте + live-payroll (факт + прогноз).
--
-- Бизнес-правила (со слов клиента):
-- - Ставка задаётся при продаже абонемента (по умолчанию 100 сом).
-- - Тренер получает ставку только за фактически пришедшего ребёнка
--   (attendance.status='present'). Пропуски, trial и cancelled — не платим.
-- - Месячная зарплата = сумма ставок по всем present-отметкам периода.
-- - Прогноз до конца месяца = ставки по будущим scheduled-занятиям ×
--   детям с активной/ending/frozen картой, чьё окно записи покрывает дату.
--
-- Старая таблица coach_rates (рейт на группу) больше не используется
-- в расчётах, но удалять её мы не будем — пусть лежит для аудита.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Колонка ставки на карте.
-- ---------------------------------------------------------------------
alter table club_cards
  add column if not exists coach_rate_per_lesson numeric(10, 2) not null default 100
    check (coach_rate_per_lesson >= 0);

comment on column club_cards.coach_rate_per_lesson is
  'Сколько тренер получает за одно посещённое занятие этого ребёнка. Default 100.';

-- ---------------------------------------------------------------------
-- 2. compute_coach_payroll — переписываем под ставку с карты.
--    Считаем сумму ставок по attendance(present) на тех занятиях,
--    что попали в [from, to], проводились этим тренером и не trial.
-- ---------------------------------------------------------------------
create or replace function compute_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
as $$
  select coalesce(sum(cc.coach_rate_per_lesson), 0)
    from lessons l
    join attendance a
      on a.lesson_id = l.id
     and a.status = 'present'
    join groups g on g.id = l.group_id
    -- Карта ребёнка, активная на дату занятия. Берём ту, у которой
    -- [start_date, end_date] покрывает l.date; section_id — либо null
    -- (legacy), либо совпадает с секцией группы. distinct on защищает
    -- от случая, когда у ребёнка пересекаются две карты (берём свежее).
    join lateral (
      select cc2.coach_rate_per_lesson
        from club_cards cc2
       where cc2.child_id = a.child_id
         and l.date between cc2.start_date and cc2.end_date
         and (cc2.section_id is null or cc2.section_id = g.section_id)
       order by cc2.created_at desc
       limit 1
    ) cc on true
   where l.coach_id = p_coach
     and l.date between p_from and p_to
     and l.type <> 'trial'
     and l.status = 'completed';
$$;

-- ---------------------------------------------------------------------
-- 3. project_coach_payroll — прогноз: будущие scheduled-занятия,
--    активные/ending/frozen карты, покрывающие дату; для каждой пары
--    (lesson × kid) суммируем ставку карты.
-- ---------------------------------------------------------------------
create or replace function project_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
as $$
  select coalesce(sum(cc.coach_rate_per_lesson), 0)
    from lessons l
    join groups g on g.id = l.group_id
    join enrollments e
      on e.group_id = l.group_id
     and e.archived_at is null
     and (e.start_date is null or e.start_date <= l.date)
     and (e.end_date   is null or e.end_date   >= l.date)
    join lateral (
      select cc2.coach_rate_per_lesson
        from club_cards cc2
       where cc2.child_id = e.child_id
         and cc2.status in ('active', 'ending', 'frozen')
         and l.date between cc2.start_date and cc2.end_date
         and (cc2.section_id is null or cc2.section_id = g.section_id)
       order by cc2.created_at desc
       limit 1
    ) cc on true
   where l.coach_id = p_coach
     and l.date between p_from and p_to
     and l.date >= current_date  -- только будущие занятия
     and l.type <> 'trial'
     and l.status = 'scheduled';
$$;

-- ---------------------------------------------------------------------
-- 4. View v_coach_live_payroll — на каждого тренера сводка по
--    текущему месяцу: actual (факт), projected (прогноз), total.
--    Подключается ко всем активным тренерам организации.
-- ---------------------------------------------------------------------
create or replace view v_coach_live_payroll as
  select
    p.id   as coach_id,
    p.organization_id,
    p.full_name,
    date_trunc('month', current_date)::date as period_start,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date as period_end,
    compute_coach_payroll(
      p.id,
      date_trunc('month', current_date)::date,
      current_date
    ) as actual_amount,
    project_coach_payroll(
      p.id,
      current_date,
      (date_trunc('month', current_date) + interval '1 month - 1 day')::date
    ) as projected_amount
    from profiles p
   where p.role = 'coach'
     and p.deleted_at is null;

-- View использует security definer-функции, своих RLS у view нет.
-- Доступ ограничивается на уровне backend-роутов.
grant select on v_coach_live_payroll to authenticated;

-- ---------------------------------------------------------------------
-- 5. sell_card_with_deposit — принимаем p_coach_rate_per_lesson.
--    Сигнатура меняется → дропаем старую версию (как было сделано
--    для enrollment-окна).
-- ---------------------------------------------------------------------
drop function if exists sell_card_with_deposit(
  uuid, uuid, uuid, card_type, int, int, numeric, numeric, date, date,
  uuid, uuid, payment_method, numeric, numeric, uuid, date, date
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
  p_coach_rate_per_lesson numeric default 100
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
    status, section_id, coach_rate_per_lesson
  ) values (
    p_organization_id, p_child_id, p_type, p_total_lessons, p_freeze_quota,
    p_price, v_final_discount, v_final_pct, p_start_date, p_end_date,
    'active', p_section_id, coalesce(p_coach_rate_per_lesson, 100)
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

