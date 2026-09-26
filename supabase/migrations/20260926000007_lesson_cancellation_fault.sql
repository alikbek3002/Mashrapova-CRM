-- =====================================================================
-- Отмена и перенос тренировки по ТЗ Академии Машрапова §5.3.
--
--   1. Менеджер вносит изменение и указывает причину.        — было
--   2. Система отправляет Push + SMS всем родителям группы.   — НЕ было
--   3. Клиентам начисляется +1 занятие к абонементу.          — было, но
--      через заморозки (см. ниже).
--   4. Если отмена по вине тренера, занятие ему не оплачивается.
--
-- Здесь добавляется поле причины по существу (пункт 4). Пункты 2 и 3
-- делаются в бэкенде (POST /v1/lessons/:id/cancel).
--
-- Про пункт 3. В движке Uniqum «+1 занятие» начислялось ВСТАВКОЙ
-- approved-заморозки каждому ребёнку группы: заморозка продлевает
-- end_date на день, и это выдавали за компенсацию. Два изъяна:
--   * это +1 ДЕНЬ срока, а не +1 ЗАНЯТИЕ — а остаток абонемента и
--     формула возврата (§7.3) считаются по total_lessons;
--   * компенсация за вину клуба тратила заморозки КЛИЕНТА, лимит
--     которых ограничен типом абонемента (§4.3, §4.1).
-- После появления лимита заморозок (20260926000005) второй изъян стал
-- прямой ошибкой: на месячном абонементе (квота 0) отмена занятия
-- вообще перестала бы проходить. Поэтому бэкенд переведён на
-- total_lessons += 1 — тот же механизм, что у «Добавить занятия».
-- =====================================================================

-- ---------------------------------------------------------------------
-- Кто виноват в отмене (§5.3 п.4, §10.1)
--
-- Отдельное поле, а не разбор текста cancellation_reason: от него
-- зависят деньги тренера и отчётность, парсить свободный текст нельзя.
-- ---------------------------------------------------------------------
alter table lessons
  add column if not exists cancellation_fault text;

alter table lessons drop constraint if exists lessons_cancellation_fault_valid;
alter table lessons add constraint lessons_cancellation_fault_valid
  check (cancellation_fault is null or cancellation_fault in
    ('coach', 'club', 'force_majeure', 'client', 'other'));

comment on column lessons.cancellation_fault is
  'ТЗ §5.3: причина отмены по существу — coach (вина тренера, занятие ему не оплачивается), club (вина клуба), force_majeure (свет, погода, болезнь тренера — клиенту +1 занятие), client, other. Свободный текст остаётся в cancellation_reason.';

create index if not exists lessons_cancellation_fault_idx
  on lessons (organization_id, cancellation_fault)
  where cancellation_fault is not null;

-- Разметка уже отменённых занятий: у форс-мажора статус говорит сам за
-- себя, остальные отмены оставляем неразмеченными — угадывать причину
-- задним числом нельзя.
update lessons
   set cancellation_fault = 'force_majeure'
 where status = 'force_majeure'
   and cancellation_fault is null;

-- ---------------------------------------------------------------------
-- Зарплата: вина тренера означает «не оплачивается» явно
--
-- Сейчас из расчёта выпадают ВСЕ отменённые занятия (cancelled и
-- force_majeure), так что по вине тренера тренер и так не получает
-- ничего. Условие добавляем именно потому, что ТЗ §6.2 формулирует
-- правило через вину: если Академия ответит, что отмена НЕ по вине
-- тренера оплачивается (открытый вопрос 10), менять останется одну
-- строку — а смысл расчёта уже будет виден из текста.
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
    select
      greatest(cc.price_paid - cc.discount, 0)     as net_price,
      coalesce(cc.total_lessons, cp.lessons_count) as lessons_count
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
    and l.status not in ('cancelled', 'force_majeure')
    -- ТЗ §5.3 п.4 / §6.2: занятие, отменённое по вине тренера, не оплачивается.
    and l.cancellation_fault is distinct from 'coach';

comment on view v_payroll_attendance is
  'ТЗ §10.1: по строке на каждую оплачиваемую отметку «пришёл» с суммой тренеру. Занятия отменённые, пробные и отменённые по вине тренера (§5.3) исключены. Единый источник расчёта для SQL-функций и бэкенда.';

revoke all on v_payroll_attendance from anon, authenticated;
grant select on v_payroll_attendance to service_role;

notify pgrst, 'reload schema';
