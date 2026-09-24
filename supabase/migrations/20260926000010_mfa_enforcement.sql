-- =====================================================================
-- Двухфакторная аутентификация по ТЗ Академии Машрапова §12.3.
--
-- «Двухфакторная аутентификация для директора и управляющего.»
--
-- Способ — TOTP (приложение-аутентификатор), а не SMS-код: SMS упирается
-- в провайдера, которого у Академии пока нет (§13, открытые вопросы
-- 1–2), а TOTP работает без внешних сервисов. Механику даёт Supabase
-- Auth MFA, свою криптографию не пишем.
--
-- Колонка profiles.mfa_required существует с первой миграции, но не
-- использовалась ни одной строкой кода. Теперь она — источник правды
-- о том, кому второй фактор обязателен.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Кому второй фактор обязателен (§12.3)
--
-- По ТЗ — директору и управляющему (fitness_director после переименования
-- ролей). Держим в синхроне с ролью: сменили роль — требование поехало
-- за ней, иначе разжалованный директор остался бы с обязательным 2FA,
-- а новый — без него.
-- ---------------------------------------------------------------------
create or replace function fn_sync_mfa_required() returns trigger
language plpgsql
as $sync_mfa$
begin
  new.mfa_required := new.role in ('director', 'fitness_director');
  return new;
end;
$sync_mfa$;

comment on function fn_sync_mfa_required() is
  'ТЗ §12.3: второй фактор обязателен директору и управляющему; требование следует за ролью.';

drop trigger if exists sync_mfa_required on profiles;
create trigger sync_mfa_required
  before insert or update of role on profiles
  for each row execute function fn_sync_mfa_required();

-- Разметка уже заведённых пользователей.
update profiles
   set mfa_required = (role in ('director', 'fitness_director'))
 where mfa_required is distinct from (role in ('director', 'fitness_director'));

-- ---------------------------------------------------------------------
-- 2. Проверка второго фактора для RLS
--
-- Правило из документации Supabase: если у пользователя есть
-- ПОДТВЕРЖДЁННЫЙ фактор, требуем aal2; если факторов нет — пропускаем.
-- Так включение 2FA никого не запирает: пока директор не завёл фактор,
-- он работает как раньше, а как завёл — обязан им пользоваться.
--
-- Проверять «роль требует 2FA, а фактора нет → запретить» на уровне RLS
-- нельзя: такой директор просто не смог бы войти и завести фактор.
-- Это правило живёт в интерфейсе — экран обязательной настройки.
-- ---------------------------------------------------------------------
create or replace function mfa_satisfied() returns boolean
language sql
stable
security definer
set search_path = public, auth
as $mfa_satisfied$
  select case
    when exists (
      select 1 from auth.mfa_factors f
       where f.user_id = (select auth.uid())
         and f.status = 'verified'
    )
    then coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    else true
  end;
$mfa_satisfied$;

comment on function mfa_satisfied() is
  'ТЗ §12.3: второй фактор пройден. Если у пользователя есть подтверждённый MFA-фактор — требуется aal2; если факторов нет — true (иначе невозможно было бы войти и настроить 2FA).';

-- ---------------------------------------------------------------------
-- 3. Где именно требуем второй фактор
--
-- Политика RESTRICTIVE — она складывается с существующими через AND,
-- то есть ничего не разрешает дополнительно, только запрещает без aal2.
-- Ставим на денежные и настроечные таблицы: это то, ради чего §12.3
-- вообще требует 2FA. Вешать на всё подряд смысла нет — тренер с
-- заведённым фактором не должен терять доступ к журналу посещаемости
-- из-за севшего телефона.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'payments', 'refunds', 'payroll_periods', 'coach_rates',
    'deposit_transactions', 'org_settings', 'card_plans', 'audit_log'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists mfa_required on %I', t);
      -- with check обязателен: для INSERT политика без него не работает
      -- вовсе, и запись в обход второго фактора проходила бы свободно.
      execute format(
        'create policy mfa_required on %I as restrictive to authenticated '
        'using (mfa_satisfied()) with check (mfa_satisfied())', t
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
