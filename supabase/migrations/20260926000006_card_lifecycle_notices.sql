-- =====================================================================
-- Контроль срока абонемента по ТЗ Академии Машрапова §4.5.
--
--   | Событие                    | Действие системы                     |
--   | За 7 дней до окончания     | Push + SMS клиенту, задача менеджеру |
--   | За 3 дня до окончания      | Push + SMS с предложением длинного пакета |
--   | В день окончания           | Push + SMS, задача менеджеру позвонить |
--   | 3 дня после истечения      | Win-back SMS «Специальное предложение — 48 часов» |
--   | Нет посещений 10+ дней     | Флаг «риск оттока», задача менеджеру |
--   | Использована последняя     | Абонемент закрывается, ресепшен получает уведомление |
--
-- Было в движке Uniqum: уведомления родителю за 3 дня, за 1 день и в день
-- окончания. То есть не тот набор интервалов, что в ТЗ, и не было ни
-- win-back, ни флага оттока, ни закрытия по последней тренировке, ни
-- задач менеджеру.
--
-- SMS и Push клиенту отправлять пока нечем — провайдера нет (§13,
-- открытые вопросы 1–3). Поэтому события пишутся в notifications:
-- родителю (его приложение уже читает эту таблицу) и менеджеру. Когда
-- появится провайдер, рассылка будет забирать те же строки — набор
-- событий и дедупликация уже готовы.
--
-- Отдельная функция, а не правка refresh_lifecycle: та отвечает за
-- статусы карт, заморозок и зачислений, её тело трогать рискованно.
-- Блок уведомлений из refresh_lifecycle здесь отключается, чтобы не
-- слать по двум наборам интервалов сразу.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Флаг «риск оттока» на клиенте (§4.5)
-- ---------------------------------------------------------------------
alter table children
  add column if not exists churn_risk_at timestamptz;

comment on column children.churn_risk_at is
  'ТЗ §4.5: когда клиент помечен риском оттока (нет посещений 10+ дней). NULL — риска нет; снимается при первом же посещении.';

create index if not exists children_churn_risk_idx
  on children (organization_id) where churn_risk_at is not null;

-- Порог — в настройки, а не в код.
alter table org_settings
  add column if not exists churn_no_visit_days int not null default 10;

alter table org_settings drop constraint if exists org_settings_churn_days_positive;
alter table org_settings add constraint org_settings_churn_days_positive
  check (churn_no_visit_days > 0);

comment on column org_settings.churn_no_visit_days is
  'ТЗ §4.5: сколько дней без посещений означают риск оттока. По ТЗ — 10.';

-- ---------------------------------------------------------------------
-- 2. refresh_card_notices() — движок событий §4.5
--
-- Идемпотентна: каждое событие дедуплицируется по уже отправленному
-- уведомлению (card_id + вид события), поэтому функцию можно гонять
-- хоть каждый час.
-- ---------------------------------------------------------------------
create or replace function refresh_card_notices() returns void
language plpgsql
security definer
set search_path = public
as $card_notices$
declare
  v_now timestamptz := now();
  v_churn_days int;
begin
  select coalesce(min(churn_no_visit_days), 10) into v_churn_days from org_settings;

  -- ------------------------------------------------------------------
  -- 2.1 За 7 дней, за 3 дня и в день окончания.
  --
  -- Клиенту (родителю) — одно уведомление на каждый рубеж; менеджеру на
  -- тех же рубежах ставится задача. За 3 дня по ТЗ идёт предложение
  -- длинного пакета со скидкой, поэтому вид задачи отличается — офис
  -- должен видеть, с чем звонить.
  -- ------------------------------------------------------------------
  insert into notifications (recipient_id, type, payload)
  select
    f.parent_user_id,
    'card_expiring',
    jsonb_build_object(
      'card_id', cc.id,
      'child_id', cc.child_id,
      'child_name', c.full_name,
      'end_date', cc.end_date,
      'days_left', cc.end_date - current_date,
      -- Подсказка будущей SMS-рассылке, каким текстом слать.
      'offer', case when (cc.end_date - current_date) = 3 then 'long_package' else null end
    )
  from club_cards cc
  join children c on c.id = cc.child_id
  join families f on f.id = c.family_id
  where cc.status in ('active', 'ending')
    and (cc.end_date - current_date) in (7, 3, 0)
    and f.parent_user_id is not null
    and not exists (
      select 1 from notifications n
       where n.recipient_id = f.parent_user_id
         and n.type = 'card_expiring'
         and n.payload->>'card_id' = cc.id::text
         and (n.payload->>'days_left')::int = (cc.end_date - current_date)
    );

  -- Задача менеджеру на тех же рубежах.
  insert into notifications (recipient_id, type, payload)
  select
    m.id,
    'card_renewal_task',
    jsonb_build_object(
      'card_id', cc.id,
      'child_id', cc.child_id,
      'child_name', c.full_name,
      'end_date', cc.end_date,
      'days_left', cc.end_date - current_date,
      'offer', case when (cc.end_date - current_date) = 3 then 'long_package' else null end
    )
  from club_cards cc
  join children c on c.id = cc.child_id
  join profiles m
    on m.organization_id = cc.organization_id
   and m.deleted_at is null
   and (
     m.id = c.responsible_manager_id
     -- Клиент без ответственного менеджера — задача уходит всем, кто
     -- ведёт продления, иначе она просто потеряется.
     or (c.responsible_manager_id is null and m.role in ('manager', 'senior_manager'))
   )
  where cc.status in ('active', 'ending')
    and (cc.end_date - current_date) in (7, 3, 0)
    and not exists (
      select 1 from notifications n
       where n.recipient_id = m.id
         and n.type = 'card_renewal_task'
         and n.payload->>'card_id' = cc.id::text
         and (n.payload->>'days_left')::int = (cc.end_date - current_date)
    );

  -- ------------------------------------------------------------------
  -- 2.2 Win-back через 3 дня после истечения (§4.5).
  -- ------------------------------------------------------------------
  insert into notifications (recipient_id, type, payload)
  select
    f.parent_user_id,
    'card_winback',
    jsonb_build_object(
      'card_id', cc.id,
      'child_id', cc.child_id,
      'child_name', c.full_name,
      'end_date', cc.end_date,
      'offer', 'special_48h'
    )
  from club_cards cc
  join children c on c.id = cc.child_id
  join families f on f.id = c.family_id
  where cc.status = 'expired'
    and (current_date - cc.end_date) = 3
    and f.parent_user_id is not null
    -- Продлился — предложение уже не нужно.
    and not exists (
      select 1 from club_cards n
       where n.child_id = cc.child_id
         and n.id <> cc.id
         and n.start_date > cc.start_date
         and n.status in ('active', 'ending', 'frozen')
    )
    and not exists (
      select 1 from notifications n
       where n.recipient_id = f.parent_user_id
         and n.type = 'card_winback'
         and n.payload->>'card_id' = cc.id::text
    );

  -- ------------------------------------------------------------------
  -- 2.3 Риск оттока: нет посещений churn_no_visit_days дней (§4.5).
  --
  -- Считаем только тех, у кого есть живой абонемент: у клиента без
  -- абонемента «отток» уже случился, это другая история (win-back).
  -- ------------------------------------------------------------------
  with idle as (
    select c.id
      from children c
     where c.deleted_at is null
       and c.churn_risk_at is null
       and exists (
         select 1 from club_cards cc
          where cc.child_id = c.id
            and cc.status in ('active', 'ending')
       )
       and not exists (
         select 1
           from attendance a
           join lessons l on l.id = a.lesson_id
          where a.child_id = c.id
            and a.status in ('present', 'late', 'makeup')
            and l.date > current_date - v_churn_days
       )
       -- Заморозка — это согласованная пауза, а не отток.
       and not exists (
         select 1 from freezes fz
          where fz.child_id = c.id
            and fz.status = 'approved'
            and current_date between fz.start_date and coalesce(fz.end_date, current_date)
       )
  )
  update children set churn_risk_at = v_now
   where id in (select id from idle);

  -- Задача менеджеру по каждому новому флагу.
  insert into notifications (recipient_id, type, payload)
  select
    m.id,
    'churn_risk',
    jsonb_build_object(
      'child_id', c.id,
      'child_name', c.full_name,
      'no_visit_days', v_churn_days
    )
  from children c
  join profiles m
    on m.organization_id = c.organization_id
   and m.deleted_at is null
   and (
     m.id = c.responsible_manager_id
     or (c.responsible_manager_id is null and m.role in ('manager', 'senior_manager'))
   )
  -- Дедуп не нужен: churn_risk_at = v_now только у флагов, поставленных
  -- этим же запуском. Повторное уведомление возможно лишь после того, как
  -- клиент пришёл (флаг снят) и снова пропал — это новый сигнал, а не спам.
  where c.churn_risk_at = v_now;

  -- Пришёл — риск снят.
  update children c
     set churn_risk_at = null
   where c.churn_risk_at is not null
     and exists (
       select 1
         from attendance a
         join lessons l on l.id = a.lesson_id
        where a.child_id = c.id
          and a.status in ('present', 'late', 'makeup')
          and l.date > current_date - v_churn_days
     );

  -- ------------------------------------------------------------------
  -- 2.4 Использована последняя тренировка: абонемент закрывается,
  --     ресепшен получает уведомление (§4.5).
  -- ------------------------------------------------------------------
  insert into notifications (recipient_id, type, payload)
  select
    r.id,
    'card_used_up',
    jsonb_build_object(
      'card_id', b.club_card_id,
      'child_id', b.child_id,
      'child_name', c.full_name,
      'total_lessons', b.total_lessons
    )
  from v_child_card_balance b
  join children c on c.id = b.child_id
  join profiles r
    on r.organization_id = b.organization_id
   and r.deleted_at is null
   and r.role in ('cashier', 'manager', 'senior_manager')
  where b.remaining is not null
    and b.remaining <= 0
    and b.status in ('active', 'ending')
    and not exists (
      select 1 from notifications n
       where n.recipient_id = r.id
         and n.type = 'card_used_up'
         and n.payload->>'card_id' = b.club_card_id::text
    );

  -- Закрываем сам абонемент. Делаем ПОСЛЕ уведомления: смена статуса
  -- выводит карту из выборки выше, и уведомление бы не ушло.
  update club_cards cc
     set status = 'expired'
   where cc.status in ('active', 'ending')
     and exists (
       select 1 from v_child_card_balance b
        where b.club_card_id = cc.id
          and b.remaining is not null
          and b.remaining <= 0
     );
end;
$card_notices$;

comment on function refresh_card_notices() is
  'ТЗ §4.5: события по сроку абонемента — за 7/3/0 дней, win-back через 3 дня, риск оттока при 10+ днях без посещений, закрытие абонемента по последней тренировке. Идемпотентна.';

-- ---------------------------------------------------------------------
-- 3. Старый блок уведомлений в refresh_lifecycle больше не нужен
--
-- Он слал «за 3 / за 1 / в день окончания» — не те интервалы, что в ТЗ.
-- Вырезаем именно его, оставляя всю работу со статусами как была.
-- Тело скопировано из 20260804000003 без блоков уведомлений.
-- ---------------------------------------------------------------------
create or replace function refresh_lifecycle() returns void
language plpgsql
security definer
set search_path = public
as $lifecycle$
begin
  update club_cards
     set status = 'expired'
   where end_date < current_date
     and status in ('active', 'ending');

  update club_cards
     set status = 'ending'
   where end_date >= current_date
     and end_date <= current_date + interval '5 days'
     and status = 'active';

  update freezes
     set status = 'rejected', rejected_at = now()
   where status = 'approved'
     and end_date is not null
     and end_date < current_date;

  update club_cards cc
     set status = (case when cc.end_date < current_date then 'expired'
                        when cc.end_date <= (current_date + 7) then 'ending'
                        else 'active' end)::card_status
   where cc.status = 'frozen'
     and not exists (
       select 1 from freezes f
        where f.club_card_id = cc.id
          and f.status = 'approved'
          and current_date between f.start_date and coalesce(f.end_date, current_date)
     );

  update club_cards cc
     set status = 'frozen'
   where cc.status in ('active', 'ending')
     and exists (
       select 1 from freezes f
        where f.club_card_id = cc.id
          and f.status = 'approved'
          and current_date between f.start_date and coalesce(f.end_date, current_date)
     );

  -- Отложенное отчисление (20260802000002): ребёнок с законченным
  -- абонементом уходит из группы только в конце следующего месяца.
  update enrollments e
     set archived_at = now()
   where e.archived_at is null
     and e.end_date is not null
     and current_date >= (
       date_trunc('month', e.end_date::timestamp + interval '1 month')
         + interval '1 month' - interval '1 day'
     )::date
     and not exists (
       select 1 from club_cards cc
        where cc.child_id = e.child_id
          and (cc.status in ('active', 'ending', 'frozen')
               or cc.end_date >= current_date)
     )
     and not exists (
       select 1 from freezes f
        where f.child_id = e.child_id
          and f.status = 'approved'
          and current_date between f.start_date and coalesce(f.end_date, current_date)
     );

  update groups g
     set is_active = false
   where g.is_active
     and g.ends_on is not null
     and g.ends_on < current_date
     and g.deleted_at is null;

  -- «Абонемент закончился» — уведомление родителю. Остальные события по
  -- сроку абонемента (7/3/0 дней, win-back, отток, последняя тренировка)
  -- переехали в refresh_card_notices() по ТЗ §4.5.
  insert into notifications (recipient_id, type, payload)
  select
    f.parent_user_id,
    'card_expired',
    jsonb_build_object(
      'card_id', cc.id,
      'child_id', cc.child_id,
      'child_name', c.full_name,
      'end_date', cc.end_date
    )
  from club_cards cc
  join children c on c.id = cc.child_id
  join families f on f.id = c.family_id
  where cc.status = 'expired'
    and cc.expiry_notified_at is null
    and f.parent_user_id is not null;

  update club_cards
     set expiry_notified_at = now()
   where status = 'expired'
     and expiry_notified_at is null;
end;
$lifecycle$;

comment on function refresh_lifecycle() is
  'Статусы карт, заморозок, зачислений и групп по календарю + уведомление об истёкшем абонементе. События по сроку абонемента (ТЗ §4.5) — в refresh_card_notices().';

notify pgrst, 'reload schema';
