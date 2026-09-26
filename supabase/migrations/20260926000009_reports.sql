-- =====================================================================
-- Отчёты по ТЗ Академии Машрапова §11.2 и §11.3.
--
-- §11.2 Продажи — было: итоги за период, средний чек, разрезы по
--   менеджеру и типу абонемента. Не хватало разреза по ДИСЦИПЛИНЕ;
--   конверсию «пробная → продажа» и продления берём из manager_kpi.
--
-- §11.3 Посещаемость — было: процент посещаемости по секциям за 30 дней.
--   Не хватало разреза ПО ГРУППАМ (посещения и пропуски за период),
--   истории и частоты ПО КЛИЕНТАМ и заполненности секций
--   (последняя уже есть — v_section_load, 20260926000008).
--
-- Считаем в SQL, а не на клиенте: отчёт по посещаемости на клиенте
-- означает выгрузку таблицы attendance целиком. Нынешний
-- useAttendanceBySection уже упирается в .limit(5000) и потому врёт на
-- больших периодах.
--
-- Права — invoker: работают RLS-политики attendance/lessons/club_cards,
-- каждый видит свою организацию. Доступ к отчётам ограничивает страница
-- (право view_finance_reports, §2.2).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Продажи по дисциплинам (§11.2)
--
-- Считаем по проданным в периоде абонементам: выручка — чистая цена
-- (price_paid − discount), как в отчёте по выручке и в расчёте зарплаты.
-- ---------------------------------------------------------------------
create or replace function sales_by_section(p_from date, p_to date)
returns table (
  section_id   uuid,
  name_ru      text,
  name_ky      text,
  cards_sold   bigint,
  revenue      numeric,
  avg_check    numeric
)
language sql
stable
as $sales_by_section$
  select
    s.id,
    s.name_ru,
    s.name_ky,
    count(cc.id),
    coalesce(sum(greatest(cc.price_paid - cc.discount, 0)), 0),
    case
      when count(cc.id) > 0
        then round(coalesce(sum(greatest(cc.price_paid - cc.discount, 0)), 0) / count(cc.id), 2)
      else 0
    end
  from club_cards cc
  join sections s on s.id = cc.section_id
  where cc.created_at::date between p_from and p_to
  group by s.id, s.name_ru, s.name_ky
  order by 5 desc;
$sales_by_section$;

comment on function sales_by_section(date, date) is
  'ТЗ §11.2: продажи в разрезе дисциплин — сколько абонементов и на какую чистую сумму продано за период.';

-- ---------------------------------------------------------------------
-- 2. Посещаемость по группам (§11.3)
--
-- «Посещения и пропуски за месяц». Пришёл = present/late/makeup — та же
-- тройка, по которой списывается абонемент и начисляется зарплата.
-- Пробные и отменённые занятия в статистику групп не идут.
-- ---------------------------------------------------------------------
create or replace function attendance_by_group(p_from date, p_to date)
returns table (
  group_id      uuid,
  group_name    text,
  section_name  text,
  coach_name    text,
  lessons_held  bigint,
  visits        bigint,
  misses        bigint,
  attendance_pct numeric
)
language sql
stable
as $attendance_by_group$
  select
    g.id,
    g.name,
    s.name_ru,
    p.full_name,
    count(distinct l.id),
    count(*) filter (where a.status in ('present', 'late', 'makeup')),
    count(*) filter (where a.status in ('absent', 'excused')),
    case
      when count(a.id) > 0
        then round(
          count(*) filter (where a.status in ('present', 'late', 'makeup'))::numeric
            * 100 / count(a.id), 0)
      else null
    end
  from lessons l
  join groups g   on g.id = l.group_id
  join sections s on s.id = g.section_id
  left join profiles p on p.id = g.coach_id
  left join attendance a on a.lesson_id = l.id
  where l.date between p_from and p_to
    and l.type <> 'trial'
    and l.status not in ('cancelled', 'force_majeure')
  group by g.id, g.name, s.name_ru, p.full_name
  order by 8 desc nulls last;
$attendance_by_group$;

comment on function attendance_by_group(date, date) is
  'ТЗ §11.3: посещения и пропуски по каждой группе за период, с процентом посещаемости.';

-- ---------------------------------------------------------------------
-- 3. Посещаемость по клиентам (§11.3)
--
-- «История и частота посещений». Частота = посещений в неделю за период:
-- голое число визитов несравнимо между периодами разной длины.
-- ---------------------------------------------------------------------
create or replace function attendance_by_child(p_from date, p_to date)
returns table (
  child_id       uuid,
  full_name      text,
  visits         bigint,
  misses         bigint,
  last_visit     date,
  per_week       numeric,
  attendance_pct numeric
)
language sql
stable
as $attendance_by_child$
  select
    c.id,
    c.full_name,
    count(*) filter (where a.status in ('present', 'late', 'makeup')),
    count(*) filter (where a.status in ('absent', 'excused')),
    max(l.date) filter (where a.status in ('present', 'late', 'makeup')),
    round(
      count(*) filter (where a.status in ('present', 'late', 'makeup'))::numeric
        * 7 / greatest(p_to - p_from + 1, 1), 1),
    case
      when count(a.id) > 0
        then round(
          count(*) filter (where a.status in ('present', 'late', 'makeup'))::numeric
            * 100 / count(a.id), 0)
      else null
    end
  from children c
  join attendance a on a.child_id = c.id
  join lessons l    on l.id = a.lesson_id
  where c.deleted_at is null
    and l.date between p_from and p_to
    and l.type <> 'trial'
    and l.status not in ('cancelled', 'force_majeure')
  group by c.id, c.full_name
  order by 3 desc;
$attendance_by_child$;

comment on function attendance_by_child(date, date) is
  'ТЗ §11.3: история и частота посещений по клиентам — визиты, пропуски, последнее посещение и среднее число визитов в неделю.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 4. Детализация зарплаты по занятиям и группам (§11.4)
--
-- «Начисления каждому тренеру за период» и «Статус» в отчёте уже были,
-- не хватало детализации. Источник — тот же v_payroll_attendance, по
-- которому считает compute_coach_payroll: отчёт и начисление не должны
-- расходиться.
--
-- Строка = занятие. Группировка по группам делается на экране: так
-- одним запросом закрываются оба разреза, которых требует ТЗ.
-- ---------------------------------------------------------------------
create or replace function payroll_detail(p_coach uuid, p_from date, p_to date)
returns table (
  lesson_id     uuid,
  lesson_date   date,
  group_id      uuid,
  group_name    text,
  section_name  text,
  visits        bigint,
  amount        numeric,
  rate_source   text
)
language sql
stable
security definer
set search_path = public
as $payroll_detail$
  select
    pa.lesson_id,
    pa.date,
    pa.group_id,
    g.name,
    s.name_ru,
    count(*),
    sum(pa.amount),
    -- Внутри одного занятия источник ставки одинаков для всех отметок,
    -- кроме случая, когда у части детей в тарифе не указано число
    -- занятий, — тогда показываем, что расчёт смешанный.
    case when count(distinct pa.rate_source) = 1
      then min(pa.rate_source) else 'mixed' end
  from v_payroll_attendance pa
  join groups g   on g.id = pa.group_id
  join sections s on s.id = g.section_id
  where pa.coach_id = p_coach
    and pa.date between p_from and p_to
    -- Функция security definer (v_payroll_attendance закрыт от
    -- authenticated), поэтому доступ проверяем здесь: сотрудник видит
    -- свою организацию, тренер — только собственные начисления.
    -- Посторонний получает пустой результат, а не чужие деньги.
    and (
      (is_staff() and pa.organization_id = auth_org())
      or p_coach = (select auth.uid())
    )
  group by pa.lesson_id, pa.date, pa.group_id, g.name, s.name_ru
  order by pa.date desc, g.name;
$payroll_detail$;

comment on function payroll_detail(uuid, date, date) is
  'ТЗ §11.4: детализация зарплаты тренера по занятиям и группам за период. Считает по v_payroll_attendance — тому же источнику, что и начисление.';

notify pgrst, 'reload schema';
