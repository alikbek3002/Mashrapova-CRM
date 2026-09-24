-- =====================================================================
-- Заморозка абонемента по ТЗ Академии Машрапова §4.3.
--
--   1. Ставит менеджер ИЛИ ТРЕНЕР (через приложение тренера).
--   2. Если поставил тренер — менеджер получает уведомление в системе.
--   3. Число заморозок ограничено типом абонемента (§4.1).
--   4. Срок абонемента продлевается на число дней заморозки.
--
-- Состояние до этой миграции:
--   1. НЕТ — тренеру запретили в 20260804000003 по решению прежнего
--      клиента (Uniqum). Машрапову заморозка тренером нужна по ТЗ.
--   2. Работает: заявка тренера создаётся в статусе pending, бэкенд
--      рассылает freeze.pending старшим ролям и ответственному менеджеру.
--   3. НЕТ — club_cards.freeze_quota только хранится и показывается,
--      но нигде не проверяется. Заморозок можно было поставить сколько
--      угодно, включая месячные абонементы, где по §4.1 их «Нет».
--   4. Работает: триггер fn_apply_freeze_to_card (20260522000005).
--
-- Здесь закрываются пункты 1 и 3.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Тренер снова может подать заявку на заморозку (§4.3)
--
-- Только pending и только своим детям: одобряет по-прежнему офис.
-- Политика повторяет снятую в 20260804000003 версию из 20260430000007.
-- ---------------------------------------------------------------------
drop policy if exists freezes_coach_insert on freezes;

create policy freezes_coach_insert on freezes for insert
with check (
  is_coach()
  and status = 'pending'
  and initiator_role = 'coach'
  and initiated_by = (select auth.uid())
  and child_id in (select coach_child_ids())
);

comment on policy freezes_coach_insert on freezes is
  'ТЗ §4.3: тренер ставит заморозку из своего приложения — заявкой (pending), только своим детям. Одобряет офис.';

-- ---------------------------------------------------------------------
-- 2. Лимит заморозок по тарифу (§4.3 п.3, §4.1)
--
-- По §4.1 у месячных абонементов заморозок нет вовсе (freeze_quota = 0),
-- у пакетов 3/6/12 месяцев — 1/2/3.
--
-- Что считать использованной квотой — не так очевидно, как кажется:
-- refresh_lifecycle помечает ЗАВЕРШЁННУЮ заморозку статусом 'rejected'
-- (20260804000003), то есть по статусу отличить «офис отказал» от
-- «заморозка отгуляна» нельзя. Поэтому считаем по approved_at: он
-- проставляется только при одобрении и остаётся после завершения.
--   квота потрачена = ожидает решения (pending) ИЛИ была одобрена;
--   отказ офиса (approved_at пустой) квоту не тратит — иначе отказ
--   наказывал бы клиента.
--
-- Проверка триггером, а не в бэкенде: заморозку создают три разных пути
-- (офис через API, тренер напрямую через RLS, будущее приложение
-- родителя), и правило должно быть одно на всех.
-- ---------------------------------------------------------------------
create or replace function fn_check_freeze_quota() returns trigger
language plpgsql
security definer
set search_path = public
as $freeze_quota$
declare
  v_quota int;
  v_used  int;
begin
  -- Проверяем только появление живой заявки. Переход в rejected квоту не
  -- занимает и проверяться не должен: refresh_lifecycle этим же статусом
  -- закрывает ОТГУЛЯННЫЕ заморозки, и проверка здесь роняла бы её.
  if new.status not in ('pending', 'approved') then
    return new;
  end if;

  select coalesce(freeze_quota, 0) into v_quota
    from club_cards where id = new.club_card_id;

  if v_quota is null then
    return new;
  end if;

  select count(*) into v_used
    from freezes f
   where f.club_card_id = new.club_card_id
     and (f.status = 'pending' or f.approved_at is not null)
     and f.id is distinct from new.id;

  if v_used >= v_quota then
    raise exception
      'freeze_quota_exceeded: по этому абонементу доступно заморозок — %, уже использовано — %',
      v_quota, v_used
      using errcode = 'P0001';
  end if;

  return new;
end;
$freeze_quota$;

comment on function fn_check_freeze_quota() is
  'ТЗ §4.3: число заморозок ограничено типом абонемента (club_cards.freeze_quota). Потраченной считается заявка в статусе pending или когда-либо одобренная (approved_at заполнен) — завершённые заморозки refresh_lifecycle переводит в rejected, по статусу их не отличить от отказа. Отказ офиса квоту не тратит.';

drop trigger if exists check_freeze_quota on freezes;
create trigger check_freeze_quota
  before insert or update of status on freezes
  for each row execute function fn_check_freeze_quota();

notify pgrst, 'reload schema';
