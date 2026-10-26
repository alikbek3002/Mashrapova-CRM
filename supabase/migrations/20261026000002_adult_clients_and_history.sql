-- =====================================================================
-- Взрослые клиенты в приложении и загрузка истории абонементов из Excel
--
-- 1. Роль client (взрослый, который занимается сам) получает те же права,
--    что родитель: is_parent() — единая точка, через неё идут все политики
--    RLS семьи, ребёнка, абонементов, посещений, заморозок и платежей.
-- 2. SMS клиенту — на телефон его входа: у взрослого в семье может не быть
--    ни «отца», ни «матери».
-- 3. Дата рождения необязательна: в отчётах Академии её нет, а ставить
--    выдуманную дату значит врать в возрасте и в фильтрах групп по возрасту.
-- 4. Риск оттока (§4.5) считается только по группам, где ведётся журнал.
-- =====================================================================

create or replace function is_parent() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(auth_role() in ('parent', 'client'), false)
$$;

alter table children alter column birth_date drop not null;

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
       -- Живой абонемент, начатый не позже окна: клиент, купивший
       -- абонемент вчера, «не ходит 10 дней» ещё не может.
       and exists (
         select 1 from club_cards cc
          where cc.child_id = c.id
            and cc.status in ('active', 'ending')
            and cc.start_date <= current_date - v_churn_days
       )
       -- Журнал его группы за окно вёлся: было занятие, где отмечена хотя
       -- бы половина текущего состава. Без этого «нет посещений» значит
       -- «тренер не отмечает», а не «клиент пропал»: после загрузки истории
       -- из Excel флаг встал бы на всех клиентах разом, а пара пробных
       -- отметок в группе на 30 человек помечала бы остальных.
       and exists (
         select 1
           from enrollments e
           join lessons l on l.group_id = e.group_id
          where e.child_id = c.id
            and e.archived_at is null
            and l.date > current_date - v_churn_days
            and l.date <= current_date
            and (select count(*) from attendance a2 where a2.lesson_id = l.id) * 2
                >= (select count(*) from enrollments e2
                     where e2.group_id = l.group_id and e2.archived_at is null)
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

create or replace function fn_notification_to_outbound() returns trigger
language plpgsql
security definer
set search_path = public
as $notif_bridge$
declare
  v_org uuid;
  v_role user_role;
  v_own_phone text;
  v_phone text;
  v_child_name text;
begin
  select p.organization_id, p.role, p.phone into v_org, v_role, v_own_phone
    from profiles p where p.id = new.recipient_id;
  if v_org is null then
    return new;
  end if;

  -- Клиентские каналы — только для родителя и взрослого клиента.
  -- Сотруднику сообщение в системе уже доставлено самой строкой notifications.
  if v_role is null or v_role not in ('parent', 'client') then
    return new;
  end if;

  -- Телефон берём у семьи ребёнка из события; если ребёнка в payload
  -- нет — у первой семьи этого родителя.
  select coalesce(f.father_phone, f.mother_phone), c.full_name
    into v_phone, v_child_name
    from families f
    left join children c on c.family_id = f.id
      and c.id = nullif(new.payload ->> 'child_id', '')::uuid
   where f.parent_user_id = new.recipient_id
   limit 1;

  -- Взрослому клиенту — на его собственный номер (логин): отца и матери
  -- у него в семье обычно нет.
  if v_role = 'client' then
    v_phone := coalesce(v_own_phone, v_phone);
  end if;

  -- Только SMS. Канал push этой строкой уже доставлен: приложение
  -- родителя читает notifications напрямую.
  perform enqueue_outbound(
    v_org, new.type, 'sms', v_phone, new.recipient_id,
    new.payload || jsonb_build_object('child_name', coalesce(new.payload ->> 'child_name', v_child_name, '')),
    new.type || ':sms:' || new.id::text
  );

  return new;
end;
$notif_bridge$;
