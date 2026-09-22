-- =====================================================================
-- 1. Заморозки создают только офис-роли (директор / фитнес-директор /
--    старший менеджер / менеджер). Родитель и тренер больше не могут:
--    политики на insert удаляем, бэкенд-роут сужает requireRole.
--    Просмотр (parent_read / coach_read) остаётся — историю видно.
--
-- 2. refresh_lifecycle: возвращаем уведомления родителям — блок
--    «card_expired» потерялся при переписывании функции в 20260802000002.
--    Плюс новые «card_expiring» за 3 дня, за 1 день и в день окончания.
--    Функция гоняется бэкендом каждый час (см. backend/src/server.ts),
--    дедуп: по card_id+days_left в notifications / expiry_notified_at.
--
-- 3. Заметка о прогрессе (progress_notes, is_public) теперь пушит
--    уведомление родителю — как это уже делают заметки с занятия
--    (trg_lesson_note_notify в 20260514000002).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Только офис создаёт заморозки
-- ---------------------------------------------------------------------
drop policy if exists freezes_parent_insert on freezes;
drop policy if exists freezes_coach_insert on freezes;

-- ---------------------------------------------------------------------
-- 2. refresh_lifecycle: тело из 20260802000002 + уведомления
-- ---------------------------------------------------------------------
create or replace function refresh_lifecycle() returns void
language plpgsql security definer as $$
declare
  r record;
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

  -- Отложенное отчисление (см. 20260802000002): ребёнок с законченным
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

  -- «Абонемент скоро закончится»: за 3 дня, за 1 день и в день окончания.
  -- Дедуп по (card_id, days_left) в уже отправленных уведомлениях.
  for r in
    select cc.id as card_id, cc.child_id, cc.end_date,
           (cc.end_date - current_date) as days_left,
           f.parent_user_id as pid, c.full_name as child_name
      from club_cards cc
      join children c on c.id = cc.child_id
      join families f on f.id = c.family_id
     where cc.status in ('active', 'ending')
       and (cc.end_date - current_date) in (3, 1, 0)
       and f.parent_user_id is not null
       and not exists (
         select 1 from notifications n
          where n.recipient_id = f.parent_user_id
            and n.type = 'card_expiring'
            and n.payload->>'card_id' = cc.id::text
            and (n.payload->>'days_left')::int = (cc.end_date - current_date)
       )
  loop
    insert into notifications (recipient_id, type, payload)
    values (
      r.pid,
      'card_expiring',
      jsonb_build_object(
        'card_id', r.card_id,
        'child_id', r.child_id,
        'child_name', r.child_name,
        'end_date', r.end_date,
        'days_left', r.days_left
      )
    );
  end loop;

  -- «Абонемент закончился» — восстановлено из 20260521000002.
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
-- 3. Уведомление родителю о новой заметке прогресса
-- ---------------------------------------------------------------------
create or replace function notify_parents_on_progress_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.is_public is distinct from true then
    return new;
  end if;
  for r in
    select f.parent_user_id as pid, c.full_name as child_name
      from children c
      join families f on f.id = c.family_id
     where c.id = new.child_id
       and f.parent_user_id is not null
  loop
    insert into notifications (recipient_id, type, payload)
    values (
      r.pid,
      'progress_note',
      jsonb_build_object(
        'progress_note_id', new.id,
        'child_id', new.child_id,
        'child_name', r.child_name,
        'coach_id', new.coach_id,
        'text', left(new.text, 300)
      )
    );
  end loop;
  return new;
end
$$;

drop trigger if exists trg_progress_note_notify on progress_notes;
create trigger trg_progress_note_notify
  after insert on progress_notes
  for each row execute function notify_parents_on_progress_note();

notify pgrst, 'reload schema';
