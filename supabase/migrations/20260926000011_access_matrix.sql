-- =====================================================================
-- Матрица прав доступа по ТЗ Академии Машрапова §2.2.
--
-- RLS-хелперы (20260510000002) матрице уже соответствуют:
--   can_manage_coaches()       → директор, управляющий   (ставки тренеров)
--   can_manage_schedule()      → + старший менеджер       (расписание)
--   can_view_finance_reports() → + старший менеджер       (финотчёты)
--   can_cancel_30pct()         → + старший менеджер       (возврат без 30%)
--   is_director()              → директор                 (настройки)
--
-- Расхождение нашлось в одном месте — и оно серьёзное.
--
-- v_coach_live_payroll выдан роли authenticated БЕЗ какого-либо фильтра
-- (20260521000008). View читает таблицы правами владельца, то есть в
-- обход RLS, поэтому зарплаты ВСЕХ тренеров мог прочитать любой, кто
-- вошёл в систему: родитель, другой тренер, ресепшен. По §2.2
-- финансовые данные доступны от старшего менеджера и выше.
--
-- Чиним двумя средствами сразу:
--   1. security_invoker — view читает profiles правами вызывающего, и
--      начинает работать политика profiles_self_read (свой профиль или
--      весь офис, если ты сотрудник);
--   2. явный фильтр в самом view — иначе менеджер и ресепшен, будучи
--      «сотрудниками», всё ещё видели бы чужие зарплаты.
-- Тренер по-прежнему видит СВОЮ строку: на ней держится виджет
-- заработка в его приложении.
-- =====================================================================

drop view if exists v_coach_live_payroll;

create view v_coach_live_payroll with (security_invoker = true) as
  select
    p.id as coach_id,
    p.organization_id,
    p.full_name,
    date_trunc('month', current_date)::date as period_start,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date as period_end,
    compute_coach_payroll(
      p.id,
      date_trunc('month', current_date)::date,
      current_date
    ) as actual_amount,
    compute_coach_max_payroll(
      p.id,
      date_trunc('month', current_date)::date,
      (date_trunc('month', current_date) + interval '1 month - 1 day')::date
    ) as max_amount,
    -- Прогноз = потолок минус факт: «сколько ещё может прийти», без
    -- двойного счёта (20260521000008).
    greatest(
      0,
      compute_coach_max_payroll(
        p.id,
        date_trunc('month', current_date)::date,
        (date_trunc('month', current_date) + interval '1 month - 1 day')::date
      ) - compute_coach_payroll(
        p.id,
        date_trunc('month', current_date)::date,
        current_date
      )
    ) as projected_amount
  from profiles p
  where p.role = 'coach'
    and p.deleted_at is null
    -- ТЗ §2.2: финансовые отчёты — от старшего менеджера. Тренеру
    -- оставляем собственную строку, без неё сломается виджет заработка
    -- в приложении тренера.
    --
    -- service_role пропускаем отдельно: бэкенд читает этот view своим
    -- ключом, где auth.uid() пуст и auth_role() ничего не вернёт, —
    -- без этой ветки endpoint /v1/payroll/live отдавал бы пустоту.
    -- Права там проверяет requireRole на входе в маршрут.
    and (
      can_view_finance_reports()
      or p.id = (select auth.uid())
      or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    );

comment on view v_coach_live_payroll is
  'Живая зарплата тренера за текущий месяц. ТЗ §2.2: видна от старшего менеджера и выше; тренер видит только свою строку.';

revoke all on v_coach_live_payroll from anon;
grant select on v_coach_live_payroll to authenticated, service_role;

notify pgrst, 'reload schema';
