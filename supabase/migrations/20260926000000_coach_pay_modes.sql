-- =====================================================================
-- Оплата тренеров по ТЗ Академии Машрапова §6.2 и §10.1.
--
-- Было (движок Uniqum): тренер получает ФИКСИРОВАННУЮ ставку
-- groups.coach_rate_per_child за каждого пришедшего ребёнка.
-- Стало (ТЗ §10.1): три модели на выбор в карточке тренера —
--
--   percent    — 40% от выручки занятия: доля абонемента, приходящаяся
--                на одно занятие, × процент тренера, за каждого
--                фактически пришедшего (единоборства, основной режим);
--   fixed      — фиксированный оклад в месяц, посещения не влияют
--                (дежурный тренер фитнес-зоны, 30–40 тыс сом/мес);
--   per_child  — прежняя ставка за ребёнка (режим движка, оставлен,
--                чтобы не ломать уже настроенные группы).
--
-- Доля абонемента на одно занятие = (price_paid − discount) / занятий.
-- Числитель — та же «чистая» цена, что показывает отчёт по выручке
-- (frontend/src/shared/api/queries.ts:2384), знаменатель — снимок
-- club_cards.total_lessons, а если его нет — lessons_count тарифа.
--
-- Единый источник правды — view v_payroll_attendance: одна строка на
-- каждую оплачиваемую отметку «пришёл» со своей суммой. Из него читают
-- и compute_coach_*, и бэкенд (разбивка по группам в payroll.ts).
-- Раньше формула жила в двух местах — SQL и TypeScript — и разъезжалась
-- (жалоба офиса 2026-09-02, миграция 20260902000003).
--
-- Персональные тренировки уже считаются по ТЗ: compute_pt_coach_payroll
-- берёт pt_services.coach_percent_default = 50% (§10.1). Не трогаем.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Модель оплаты в карточке тренера (ТЗ §6.1)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'coach_pay_mode') then
    create type coach_pay_mode as enum ('percent', 'fixed', 'per_child');
  end if;
end $$;

alter table coaches
  add column if not exists pay_mode coach_pay_mode not null default 'percent',
  add column if not exists percent_rate numeric(5, 2) not null default 40,
  add column if not exists fixed_monthly numeric(12, 2) not null default 0;

alter table coaches drop constraint if exists coaches_percent_rate_range;
alter table coaches add constraint coaches_percent_rate_range
  check (percent_rate >= 0 and percent_rate <= 100);

alter table coaches drop constraint if exists coaches_fixed_monthly_positive;
alter table coaches add constraint coaches_fixed_monthly_positive
  check (fixed_monthly >= 0);

comment on column coaches.pay_mode is
  'ТЗ §10.1: percent — % от выручки занятия за каждого пришедшего; fixed — оклад в месяц (дежурный тренер фитнес-зоны); per_child — ставка за ребёнка (режим движка Uniqum).';
comment on column coaches.percent_rate is
  'Процент тренера от выручки занятия при pay_mode = percent. По ТЗ §6.2 — 40.';
comment on column coaches.fixed_monthly is
  'Оклад в месяц при pay_mode = fixed. По ТЗ §6.2 — 30 000–40 000 сом.';

-- ---------------------------------------------------------------------
-- 2. v_payroll_attendance — одна строка на оплачиваемую отметку
--
-- Оплачивается отметка «пришёл» (present/late/makeup — та же тройка, по
-- которой списывается остаток абонемента) на не-пробном и не отменённом
-- занятии. Статус занятия 'completed' не требуется: тренер отмечает
-- посещаемость сам, и занятие какое-то время остаётся 'scheduled'
-- (см. 20260902000003).
--
-- rate_source объясняет, откуда взялась сумма, — чтобы «почему столько»
-- можно было ответить не залезая в SQL:
--   percent            — доля абонемента × процент тренера;
--   per_child          — ставка группы (режим тренера per_child);
--   fixed              — 0, у тренера оклад (начисляется отдельно);
--   fallback_per_child — режим percent, но в абонементе не указано число
--                        занятий, поэтому взята ставка группы.
-- ---------------------------------------------------------------------
drop view if exists v_payroll_attendance;
create view v_payroll_attendance as
  select
    a.id                as attendance_id,
    l.id                as lesson_id,
    l.organization_id,
    l.coach_id,
    l.group_id,
    l.date,
    a.child_id,
    co.pay_mode,
    src.rate_source,
    src.amount
  from attendance a
  join lessons l  on l.id = a.lesson_id
  join groups  g  on g.id = l.group_id
  join coaches co on co.id = l.coach_id
  left join lateral (
    -- Абонемент, покрывающий дату занятия. Приоритет: карта именно этой
    -- секции → карта без секции → любая. Тот же подбор, что и в прежней
    -- compute_coach_payroll (20260521000004).
    select
      greatest(cc.price_paid - cc.discount, 0)              as net_price,
      coalesce(cc.total_lessons, cp.lessons_count)          as lessons_count
    from club_cards cc
    left join card_plans cp on cp.id = cc.plan_id
    where cc.child_id = a.child_id
      and l.date between cc.start_date and cc.end_date
      and (cc.section_id is null or cc.section_id = g.section_id)
    order by
      case
        when cc.section_id = g.section_id then 0
        when cc.section_id is null        then 1
        else 2
      end,
      cc.created_at desc
    limit 1
  ) card on true
  cross join lateral (
    select
      case
        when co.pay_mode = 'fixed'     then 0::numeric
        when co.pay_mode = 'per_child' then g.coach_rate_per_child
        when coalesce(card.lessons_count, 0) > 0
          then round(card.net_price / card.lessons_count * co.percent_rate / 100, 2)
        else g.coach_rate_per_child
      end as amount,
      case
        when co.pay_mode = 'fixed'     then 'fixed'
        when co.pay_mode = 'per_child' then 'per_child'
        when coalesce(card.lessons_count, 0) > 0 then 'percent'
        else 'fallback_per_child'
      end as rate_source
  ) src
  where a.status in ('present', 'late', 'makeup')
    and l.type <> 'trial'
    and l.status not in ('cancelled', 'force_majeure');

comment on view v_payroll_attendance is
  'ТЗ §10.1: по строке на каждую оплачиваемую отметку «пришёл» с суммой тренеру. Единый источник расчёта зарплаты для SQL-функций и бэкенда.';

-- View читает таблицы правами владельца, то есть в обход RLS, поэтому
-- доступ к нему закрываем явно: зарплатные строки видят только расчётные
-- функции (security definer) и бэкенд под service_role. Revoke нужен
-- именно явный — в Supabase на схему public стоят default privileges,
-- которые иначе раздали бы select всем ролям, включая authenticated.
-- Тренер видит свои суммы через v_coach_live_payroll и /v1/payroll/me/live.
revoke all on v_payroll_attendance from anon, authenticated;
grant select on v_payroll_attendance to service_role;

-- ---------------------------------------------------------------------
-- 3. Оклад за период (pay_mode = fixed)
--
-- Оклад месячный, а считать приходится и куски месяца: аванс 20-го — это
-- «заработанное с 1-го по 20-е» (ТЗ §10.2). Поэтому оклад делится
-- пропорционально дням запрошенного периода внутри его месяца.
-- Полный месяц → полный оклад; 1–20 апреля → 20/30 оклада.
-- ---------------------------------------------------------------------
create or replace function coach_fixed_salary(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
set search_path = public
as $$
  select case
    when co.pay_mode <> 'fixed' or p_to < p_from then 0
    else round(
      co.fixed_monthly
        * (p_to - p_from + 1)
        / extract(day from (date_trunc('month', p_from) + interval '1 month - 1 day'))::numeric,
      2)
  end
  from coaches co
  where co.id = p_coach;
$$;

comment on function coach_fixed_salary(uuid, date, date) is
  'ТЗ §10.2: оклад тренера за период, пропорционально дням внутри месяца (нужно для аванса за 1–20 число).';

-- ---------------------------------------------------------------------
-- 4. Расчётные функции поверх view
-- ---------------------------------------------------------------------

-- Факт: что тренер заработал за период.
create or replace function compute_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select sum(pa.amount)
      from v_payroll_attendance pa
     where pa.coach_id = p_coach
       and pa.date between p_from and p_to
  ), 0) + coach_fixed_salary(p_coach, p_from, p_to);
$$;

comment on function compute_coach_payroll(uuid, date, date) is
  'ТЗ §10.1: факт зарплаты тренера — сумма по отметкам «пришёл» (v_payroll_attendance) плюс оклад за период, если тренер на окладе.';

-- Потолок: каждый зачисленный ребёнок пришёл бы на все занятия периода.
-- Цена берётся из карты ребёнка, как в факте; без фильтра по attendance.
create or replace function compute_coach_max_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select sum(
      case
        when co.pay_mode = 'fixed'     then 0::numeric
        when co.pay_mode = 'per_child' then g.coach_rate_per_child
        when coalesce(card.lessons_count, 0) > 0
          then round(card.net_price / card.lessons_count * co.percent_rate / 100, 2)
        else g.coach_rate_per_child
      end)
      from lessons l
      join groups  g  on g.id = l.group_id
      join coaches co on co.id = l.coach_id
      join enrollments e
        on e.group_id = l.group_id
       and e.archived_at is null
       and (e.start_date is null or e.start_date <= l.date)
       and (e.end_date   is null or e.end_date   >= l.date)
      left join lateral (
        select
          greatest(cc.price_paid - cc.discount, 0)     as net_price,
          coalesce(cc.total_lessons, cp.lessons_count) as lessons_count
        from club_cards cc
        left join card_plans cp on cp.id = cc.plan_id
        where cc.child_id = e.child_id
          and cc.status in ('active', 'ending', 'frozen', 'expired')
          and l.date between cc.start_date and cc.end_date
          and (cc.section_id is null or cc.section_id = g.section_id)
        order by
          case
            when cc.section_id = g.section_id then 0
            when cc.section_id is null        then 1
            else 2
          end,
          cc.created_at desc
        limit 1
      ) card on true
     where l.coach_id = p_coach
       and l.date between p_from and p_to
       and l.type <> 'trial'
       and l.status not in ('cancelled', 'force_majeure')
  ), 0) + coach_fixed_salary(p_coach, p_from, p_to);
$$;

comment on function compute_coach_max_payroll(uuid, date, date) is
  'Потолок зарплаты за период: все зачисленные дети приходят на все занятия. Та же цена занятия, что и в факте.';

-- Прогноз: только будущие занятия периода.
create or replace function project_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
set search_path = public
as $$
  select compute_coach_max_payroll(
    p_coach,
    greatest(p_from, current_date),
    p_to
  );
$$;

comment on function project_coach_payroll(uuid, date, date) is
  'Прогноз до конца периода: потолок, посчитанный от сегодняшнего дня.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 5. Аванс 20-го числа (ТЗ §10.2)
--
-- «20-е число: аванс = 50% от заработанного с 1-го по 20-е». Раньше
-- статус advance_paid просто переключался, а сумма аванса нигде не
-- хранилась — директор не видел, сколько именно выдано на руки.
-- ---------------------------------------------------------------------
alter table payroll_periods
  add column if not exists advance_amount numeric(12, 2),
  add column if not exists advance_paid_at timestamptz,
  add column if not exists advance_paid_by uuid references profiles(id);

comment on column payroll_periods.advance_amount is
  'ТЗ §10.2: сумма аванса — 50% от заработанного с 1-го по 20-е число периода.';

-- Доля аванса вынесена в настройки: ТЗ фиксирует 50%, но менять её
-- не должно требовать миграции.
alter table org_settings
  add column if not exists advance_share_pct numeric(5, 2) not null default 50;

alter table org_settings drop constraint if exists org_settings_advance_share_range;
alter table org_settings add constraint org_settings_advance_share_range
  check (advance_share_pct >= 0 and advance_share_pct <= 100);

alter table org_settings
  add column if not exists advance_day int not null default 20;

alter table org_settings drop constraint if exists org_settings_advance_day_range;
alter table org_settings add constraint org_settings_advance_day_range
  check (advance_day between 1 and 28);

comment on column org_settings.advance_share_pct is
  'ТЗ §10.2: какую долю заработанного за первую половину месяца выдают авансом. По ТЗ — 50%.';
comment on column org_settings.advance_day is
  'ТЗ §10.2: по какое число считается аванс (включительно). По ТЗ — 20-е.';

-- Сумма аванса за период: заработанное с начала периода по день аванса
-- × доля. Считает через compute_coach_payroll, поэтому оклад у тренера
-- на fixed попадает в аванс пропорционально дням — как и должно.
create or replace function compute_coach_advance(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
set search_path = public
as $$
  select round(
    compute_coach_payroll(
      p_coach,
      p_from,
      least(p_to, date_trunc('month', p_from)::date + (coalesce(s.advance_day, 20) - 1))
    ) * coalesce(s.advance_share_pct, 50) / 100,
    2)
  from profiles p
  left join org_settings s on s.organization_id = p.organization_id
  where p.id = p_coach;
$$;

comment on function compute_coach_advance(uuid, date, date) is
  'ТЗ §10.2: аванс тренера — доля (по умолчанию 50%) от заработанного с начала периода по день аванса (по умолчанию 20-е).';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 6. Кто правит ставки тренера (ТЗ §2.2)
--
-- По матрице прав §2.2 «Установка ставок тренеров» — только директор и
-- управляющий. Но карточку тренера (био, достижения, опыт) правит и
-- старший менеджер: он же заводит тренеров, и rbac.ts даёт ему
-- manage_coaches. Поэтому политику строки не сужаем — иначе сломается
-- редактирование карточки, — а закрываем именно денежные поля.
--
-- Колоночный GRANT здесь не подходит: в базе все сотрудники сидят под
-- одной ролью authenticated, а различаются ролью приложения из JWT.
-- Поэтому проверка — триггером.
-- ---------------------------------------------------------------------
create or replace function forbid_coach_pay_change() returns trigger
language plpgsql
security definer
set search_path = public
as $forbid_pay$
begin
  if (new.pay_mode, new.percent_rate, new.fixed_monthly)
     is distinct from (old.pay_mode, old.percent_rate, old.fixed_monthly)
     and not can_manage_coaches() then
    raise exception 'coach_pay_forbidden: ставки тренера меняет только директор или управляющий'
      using errcode = 'P0001';
  end if;
  return new;
end;
$forbid_pay$;

comment on function forbid_coach_pay_change() is
  'ТЗ §2.2: установка ставок тренеров доступна только директору и управляющему; остальные поля карточки правит и старший менеджер.';

drop trigger if exists forbid_coach_pay_change on coaches;
create trigger forbid_coach_pay_change
  before update on coaches
  for each row execute function forbid_coach_pay_change();

notify pgrst, 'reload schema';
