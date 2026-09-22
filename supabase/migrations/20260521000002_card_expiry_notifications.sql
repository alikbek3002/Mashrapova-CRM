-- =====================================================================
-- Уведомления родителю об окончании абонемента + бэкфилл окна записи.
--
-- 1. `club_cards.expiry_notified_at` — чтобы не дублировать пуш-нотификацию,
--    когда refresh_lifecycle гоняется каждый день.
-- 2. `refresh_lifecycle()` теперь:
--      a) при переводе карты в `expired` отправляет уведомление
--         родителю(ям) семьи (type='card_expired'),
--      b) ставит `expiry_notified_at` на карте,
--      c) архивирует enrollments детей, у которых не осталось
--         активных/ending/frozen карт (а не только по window).
-- 3. Бэкфилл существующих enrollments: где окно NULL/NULL и у ребёнка
--    есть активная карта в той же секции — копируем даты карты.
--    Нужно, чтобы legacy-записи перестали болтаться в табеле бесконечно.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Колонка-флаг отправленного уведомления.
-- ---------------------------------------------------------------------
alter table club_cards
  add column if not exists expiry_notified_at timestamptz;

comment on column club_cards.expiry_notified_at is
  'Когда родителям ушло уведомление об окончании абонемента. NULL = ещё не уведомлены.';

-- Глушим уведомления для УЖЕ истёкших карт — это исторические данные,
-- родителю не нужно получать пачку сообщений о картах за прошлый сезон.
-- Только новые expirations (статус flip в текущем refresh_lifecycle) пушатся.
update club_cards
   set expiry_notified_at = now()
 where status = 'expired'
   and expiry_notified_at is null;

-- ---------------------------------------------------------------------
-- 2. refresh_lifecycle — дополняем уведомлениями и более жёсткой
--    архивацией enrollments по факту отсутствия активных карт.
-- ---------------------------------------------------------------------
create or replace function refresh_lifecycle() returns void
language plpgsql security definer as $$
declare
  r record;
begin
  -- expired: end_date already passed
  update club_cards
     set status = 'expired'
   where end_date < current_date
     and status in ('active', 'ending');

  -- ending: 5 days or less remaining
  update club_cards
     set status = 'ending'
   where end_date >= current_date
     and end_date <= current_date + interval '5 days'
     and status = 'active';

  -- thaw: approved freeze whose end_date passed → close it,
  --       and bring its card back to 'active'
  update freezes
     set status = 'rejected', rejected_at = now()
   where status = 'approved'
     and end_date is not null
     and end_date < current_date;

  update club_cards cc
     set status = 'active'
   where cc.status = 'frozen'
     and not exists (
       select 1 from freezes f
        where f.club_card_id = cc.id
          and f.status = 'approved'
          and (f.end_date is null or f.end_date >= current_date)
     );

  -- archive enrollments whose window has fully elapsed (auto-выход из группы).
  -- Стоп-гард: пропускаем детей с замороженной картой.
  update enrollments e
     set archived_at = now()
   where e.archived_at is null
     and e.end_date is not null
     and e.end_date < current_date
     and not exists (
       select 1 from club_cards cc
        where cc.child_id = e.child_id and cc.status = 'frozen'
     );

  -- Дополнительно: если у ребёнка не осталось НИ ОДНОЙ карты со статусом
  -- active/ending/frozen в секции его группы — архивируем enrollment.
  -- Это покрывает кейс «legacy NULL-окно + истёкший абонемент»,
  -- ради которого мы и переписываем эту функцию.
  update enrollments e
     set archived_at = now()
    from groups g
   where e.group_id = g.id
     and e.archived_at is null
     and not exists (
       select 1
         from club_cards cc
        where cc.child_id = e.child_id
          and cc.status in ('active', 'ending', 'frozen')
          and (cc.section_id is null or cc.section_id = g.section_id)
     );

  -- Уведомления родителям об истёкших абонементах: одно уведомление
  -- на карту, маркируем expiry_notified_at чтобы не дублировать.
  for r in
    select cc.id as card_id, cc.child_id, cc.end_date,
           f.parent_user_id as pid, c.full_name as child_name
      from club_cards cc
      join children c on c.id = cc.child_id
      join families f on f.id = c.family_id
     where cc.status = 'expired'
       and cc.expiry_notified_at is null
       and f.parent_user_id is not null
  loop
    insert into notifications (recipient_id, type, payload)
    values (
      r.pid,
      'card_expired',
      jsonb_build_object(
        'card_id', r.card_id,
        'child_id', r.child_id,
        'child_name', r.child_name,
        'end_date', r.end_date
      )
    );
  end loop;

  update club_cards
     set expiry_notified_at = now()
   where status = 'expired'
     and expiry_notified_at is null;
end $$;

-- ---------------------------------------------------------------------
-- 3. Бэкфилл существующих enrollments окном текущей активной карты.
--    Делается один раз на этой миграции; новые записи окно получают
--    из sell_card_with_deposit.
--    Берём самую свежую активную/ending карту в секции группы.
-- ---------------------------------------------------------------------
update enrollments e
   set start_date = sub.start_date,
       end_date   = sub.end_date
  from (
    select distinct on (e2.id)
           e2.id as enrollment_id,
           cc.start_date,
           cc.end_date
      from enrollments e2
      join groups g on g.id = e2.group_id
      join club_cards cc on cc.child_id = e2.child_id
       and (cc.section_id is null or cc.section_id = g.section_id)
     where e2.archived_at is null
       and e2.start_date is null
       and e2.end_date is null
       and cc.status in ('active', 'ending', 'frozen', 'expired')
     order by e2.id, cc.created_at desc
  ) sub
 where e.id = sub.enrollment_id;

-- Прогон лайфсайкла, чтобы legacy-карты с истёкшим end_date пометились
-- expired и улетели уведомления + архивы.
select refresh_lifecycle();
