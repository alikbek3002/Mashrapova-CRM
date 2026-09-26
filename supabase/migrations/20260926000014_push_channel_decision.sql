-- =====================================================================
-- Канал Push: решение по открытому вопросу 7 (ТЗ §9.1 против §15).
--
-- Решение владельца: приложение родителя формально остаётся версией 2.0,
-- но канал Push в матрице §9.1 включён.
--
-- Что это значит на практике
-- --------------------------
-- «Push» в матрице распадается на две разные вещи, и раньше они были
-- смешаны:
--
--   1. Уведомление В ПРИЛОЖЕНИИ родителя. Работает с самого начала:
--      приложение читает таблицу notifications (ParentScreen), события
--      туда пишут функции жизненного цикла, воронка и отмены занятий.
--      Именно это и включено решением.
--
--   2. Настоящий Web Push — системное уведомление на телефон при
--      ЗАКРЫТОМ приложении. Требует обработчика push в service worker,
--      ключей VAPID и хранения подписок. Этого нет ни строчки.
--
-- Из-за смешения канал push ставился в outbound_messages, где отправить
-- его было нечем: dispatchOutbound помечал такие строки skipped с
-- пояснением «Push не настроен». Очередь копила мусор, а в отчёте о
-- рассылке половина записей выглядела пропущенной.
--
-- Поэтому: push больше не попадает в очередь исходящих. Матрица
-- сохраняет галочку push — она означает «событие показывается родителю
-- в приложении». Очередь остаётся только для SMS, то есть для того, что
-- действительно уходит наружу через провайдера.
--
-- Когда понадобится настоящий Web Push — это отдельная работа, и она
-- добавит в очередь свой канал (например web_push) с подписками.
-- =====================================================================

comment on table notification_matrix is
  'ТЗ §9.1: какие каналы включены для каждого события. push — событие показывается родителю в приложении (таблица notifications); sms — уходит наружу через провайдера, ставится в outbound_messages. Настоящего Web Push (системное уведомление при закрытом приложении) пока нет.';

-- ---------------------------------------------------------------------
-- Мост из notifications в очередь: только SMS
--
-- Уведомление родителю само по себе и есть доставка в приложение, то
-- есть канал push. Дублировать его строкой в очереди незачем.
-- ---------------------------------------------------------------------
create or replace function fn_notification_to_outbound() returns trigger
language plpgsql
security definer
set search_path = public
as $notif_bridge$
declare
  v_org uuid;
  v_role user_role;
  v_phone text;
  v_child_name text;
begin
  select p.organization_id, p.role into v_org, v_role
    from profiles p where p.id = new.recipient_id;
  if v_org is null then
    return new;
  end if;

  -- Клиентские каналы — только для родителя. Сотруднику сообщение в
  -- системе уже доставлено самой строкой notifications.
  if v_role is distinct from 'parent' then
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

comment on function fn_notification_to_outbound() is
  'ТЗ §9.1: из уведомления родителю ставит в очередь SMS согласно матрице. Канал push доставляется самой таблицей notifications — приложение родителя читает её напрямую, дублировать в очереди незачем.';

-- ---------------------------------------------------------------------
-- То же для лидов: у лида нет приложения, ему доступен только SMS.
--
-- Раньше push для лида ставился в очередь и всегда пропускался: лид —
-- ещё не клиент, приложения у него нет по определению.
-- ---------------------------------------------------------------------
create or replace function fn_lead_outbound() returns trigger
language plpgsql
security definer
set search_path = public
as $lead_outbound$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'lead_id', new.id,
    'child_name', coalesce(new.child_name, new.parent_name, ''),
    'trial_at', coalesce(to_char(new.trial_at at time zone 'Asia/Bishkek', 'DD.MM HH24:MI'), '')
  );

  -- Подтверждение записи на пробную.
  if new.stage = 'trial_booked' and new.trial_at is not null
     and (old.stage is distinct from new.stage or old.trial_at is distinct from new.trial_at) then
    perform enqueue_outbound(new.organization_id, 'lead_trial_booked', 'sms',
      new.phone, null, v_payload, 'lead_trial_booked:sms:' || new.id::text || ':' || new.trial_at::text);
  end if;

  -- Напоминание за 24 часа.
  if new.reminder_24h_at is not null and old.reminder_24h_at is null then
    perform enqueue_outbound(new.organization_id, 'lead_trial_reminder_24h', 'sms',
      new.phone, null, v_payload, 'lead_reminder_24h:sms:' || new.id::text);
  end if;

  -- Напоминание за 2 часа по матрице §9.1 идёт только каналом push, а у
  -- лида приложения нет. Поэтому здесь ничего: менеджер видит задачу в
  -- воронке (refresh_lead_sla, ТЗ §8.3).

  return new;
end;
$lead_outbound$;

comment on function fn_lead_outbound() is
  'ТЗ §9.1: подтверждение записи на пробную и напоминание за 24ч — SMS на телефон лида. Push лиду недоступен: приложения у него нет, он ещё не клиент.';

-- Чистим мусор, накопленный прежней логикой.
update outbound_messages
   set status = 'skipped',
       last_error = 'Канал push доставляется приложением родителя напрямую (решение по вопросу 7); в очереди не нужен.'
 where channel = 'push'
   and status = 'queued';

notify pgrst, 'reload schema';
