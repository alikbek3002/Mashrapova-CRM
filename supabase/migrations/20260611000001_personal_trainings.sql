-- =====================================================================
-- ERP-модуль «ПЕРСОНАЛЬНЫЕ ТРЕНИРОВКИ» (ПТ для ERP.docx)
-- Номенклатура услуг, пакеты, мини-группы, записи, проведение,
-- отмены/переносы, замены тренеров, зарплата, журнал, уведомления.
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------
create type pt_service_type as enum ('personal', 'mini_group');

-- Статусы пакета (§3): Куплен / Ожидает активации / Активирован+Действующий
-- (объединены в 'active') / Завершен / Истек / Заблокирован / Возвращен / Аннулирован
create type pt_package_status as enum (
  'purchased',            -- куплен (есть долг / не оплачен полностью)
  'awaiting_activation',  -- оплачен полностью, ожидает активации
  'active',               -- активирован / действующий
  'completed',            -- завершен (все тренировки списаны)
  'expired',              -- истек срок действия / срок активации
  'blocked',              -- заблокирован
  'refunded',             -- возвращен
  'annulled'              -- аннулирован
);

create type pt_session_status as enum ('scheduled', 'completed', 'cancelled', 'rescheduled');

-- Статус посещения ребёнка (журнал §14):
--   attended = ✓, missed+charged = С (списано), missed = Н (неявка),
--   cancelled = О, rescheduled = П
create type pt_visit_status as enum ('scheduled', 'attended', 'missed', 'cancelled', 'rescheduled');

-- ---------------------------------------------------------------
-- 2. НОМЕНКЛАТУРА УСЛУГ (§2)
-- ---------------------------------------------------------------
create table pt_services (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  name text not null,
  section_id uuid references sections(id),          -- вид спорта
  type pt_service_type not null default 'personal',
  capacity int not null default 1 check (capacity >= 1),  -- размер мини-группы
  price numeric(12,2) not null check (price >= 0),         -- стоимость пакета (на участника)
  duration_min int not null default 60 check (duration_min > 0),
  lessons_count int not null check (lessons_count > 0),    -- тренировок в пакете
  validity_days int not null default 30 check (validity_days > 0),  -- срок действия пакета
  activation_deadline_days int not null default 30 check (activation_deadline_days > 0), -- срок активации после покупки
  reschedule_limit_hours int not null default 24,  -- правила переноса (минимум часов до начала)
  cancel_limit_hours int not null default 24,      -- правила отмены
  coach_edit_limit_hours int not null default 2,   -- §19: тренер меняет запись до N часов до начала
  mark_deadline_hours int not null default 24,     -- §19: окно отметки проведения после окончания
  freeze_allowed boolean not null default false,   -- правила заморозки
  refundable boolean not null default true,        -- возможность возврата
  blockable boolean not null default true,         -- возможность блокировки
  coach_category text,                             -- категория тренеров
  coach_percent_default numeric(5,2) not null default 50 check (coach_percent_default between 0 and 100),
  comment text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index pt_services_org on pt_services (organization_id) where deleted_at is null;

-- Стоимость / процент по каждому тренеру (§2, §12)
create table pt_service_coach_rates (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  service_id uuid not null references pt_services(id) on delete cascade,
  coach_id uuid not null references profiles(id),
  price numeric(12,2) check (price >= 0),               -- индивидуальная цена тренера (null = базовая)
  percent numeric(5,2) check (percent between 0 and 100), -- процент тренера (null = по умолчанию услуги)
  created_at timestamptz not null default now(),
  unique (service_id, coach_id)
);

create index pt_service_coach_rates_coach on pt_service_coach_rates (coach_id);

-- ---------------------------------------------------------------
-- 3. МИНИ-ГРУППЫ: контейнер совместной продажи (§7, §8)
-- ---------------------------------------------------------------
create table pt_package_groups (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  service_id uuid not null references pt_services(id),
  coach_id uuid not null references profiles(id),
  name text,
  total_price numeric(12,2) not null default 0,
  capacity int not null default 2,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 4. ПАКЕТЫ (§3)
-- ---------------------------------------------------------------
create table pt_packages (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  child_id uuid not null references children(id),
  service_id uuid not null references pt_services(id),
  coach_id uuid not null references profiles(id),       -- закреплённый тренер (§1: можно сменить)
  group_id uuid references pt_package_groups(id),       -- мини-группа
  status pt_package_status not null default 'purchased',
  lessons_total int not null check (lessons_total > 0),
  lessons_used int not null default 0 check (lessons_used >= 0),
  price numeric(12,2) not null check (price >= 0),      -- стоимость для участника
  paid numeric(12,2) not null default 0 check (paid >= 0),
  sold_by uuid references profiles(id),                 -- кто провёл продажу (§1)
  sold_at timestamptz not null default now(),
  sold_in_debt boolean not null default false,          -- §10: продажа в долг
  debt_comment text,
  activation_deadline date,                             -- срок обязательной активации
  activated_at timestamptz,
  activated_by uuid references profiles(id),
  activation_kind text check (activation_kind in ('auto', 'manual')),
  expires_at date,                                      -- срок действия после активации
  blocked_at timestamptz,
  blocked_by uuid references profiles(id),
  block_reason text,
  refunded_at timestamptz,
  refunded_by uuid references profiles(id),
  refund_amount numeric(12,2) not null default 0,
  refund_kind text check (refund_kind in ('partial', 'full')),
  annulled_at timestamptz,
  annulled_by uuid references profiles(id),
  annul_reason text,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- §3: активным может быть только один пакет (по клиенту и услуге)
create unique index pt_packages_one_active
  on pt_packages (child_id, service_id) where status = 'active';

create index pt_packages_child on pt_packages (child_id, created_at desc);
create index pt_packages_coach on pt_packages (coach_id) where status in ('purchased','awaiting_activation','active');
create index pt_packages_group on pt_packages (group_id) where group_id is not null;
create index pt_packages_org_status on pt_packages (organization_id, status);

-- Платежи по ПТ-пакетам идут в общий журнал платежей
alter table payments add column if not exists pt_package_id uuid references pt_packages(id);
create index payments_pt_package on payments (pt_package_id) where pt_package_id is not null;

-- ---------------------------------------------------------------
-- 5. ТРЕНИРОВКИ: сессия (1 строка = 1 тренировка тренера, §7)
--    и посещения по каждому ребёнку (§1, §6)
-- ---------------------------------------------------------------
create table pt_sessions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  service_id uuid not null references pt_services(id),
  coach_id uuid not null references profiles(id),       -- основной тренер
  actual_coach_id uuid references profiles(id),         -- фактически провёл (замена, §15)
  package_group_id uuid references pt_package_groups(id),
  date date not null,
  start_time time not null,
  duration_min int not null default 60,
  status pt_session_status not null default 'scheduled',
  completed_at timestamptz,
  completed_by uuid references profiles(id),
  completed_source text check (completed_source in ('coach', 'admin', 'turnstile')),
  cancelled_at timestamptz,
  cancelled_by uuid references profiles(id),
  cancel_reason text,
  rescheduled_from uuid references pt_sessions(id),     -- §9: история переносов
  rescheduled_at timestamptz,
  rescheduled_by uuid references profiles(id),
  reschedule_reason text,
  substitution_by uuid references profiles(id),         -- §15: кто внёс замену
  substitution_at timestamptz,
  substitution_comment text,
  comment text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pt_sessions_coach_date on pt_sessions (coach_id, date);
create index pt_sessions_org_date on pt_sessions (organization_id, date);
create index pt_sessions_actual_coach on pt_sessions (actual_coach_id) where actual_coach_id is not null;

create table pt_lessons (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  session_id uuid not null references pt_sessions(id) on delete cascade,
  package_id uuid not null references pt_packages(id),
  child_id uuid not null references children(id),
  status pt_visit_status not null default 'scheduled',
  charged boolean not null default false,               -- списано из пакета
  entry_time timestamptz,                               -- §1: время входа (турникет)
  exit_time timestamptz,                                -- §1: время выхода
  marked_by uuid references profiles(id),
  marked_at timestamptz,
  cancelled_by uuid references profiles(id),
  cancel_reason text,
  rescheduled_by uuid references profiles(id),
  reschedule_reason text,
  restored_by uuid references profiles(id),             -- §10: вернуть тренировку
  restored_at timestamptz,
  reminder_sent_at timestamptz,                         -- §17: напоминание за 24 ч
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, child_id)
);

create index pt_lessons_package on pt_lessons (package_id, created_at desc);
create index pt_lessons_child on pt_lessons (child_id, created_at desc);
create index pt_lessons_session on pt_lessons (session_id);

-- ---------------------------------------------------------------
-- 6. КОММЕНТАРИИ ТРЕНЕРА каждые 10 тренировок (§16)
-- ---------------------------------------------------------------
create table pt_coach_comments (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  package_id uuid not null references pt_packages(id) on delete cascade,
  child_id uuid not null references children(id),
  coach_id uuid not null references profiles(id),
  milestone int not null check (milestone > 0),         -- 10, 20, 30…
  text text not null check (length(trim(text)) > 0),
  created_at timestamptz not null default now(),
  unique (package_id, milestone)
);

create index pt_coach_comments_child on pt_coach_comments (child_id, created_at desc);

-- ---------------------------------------------------------------
-- 7. UPDATED_AT + АУДИТ (§11: журнал изменений, удаление запрещено)
-- ---------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select unnest(array['pt_services','pt_packages','pt_sessions','pt_lessons']) loop
    execute format(
      'create trigger set_updated_at before update on %I for each row execute function trigger_set_updated_at();', t);
  end loop;
  for t in select unnest(array[
    'pt_services','pt_service_coach_rates','pt_package_groups',
    'pt_packages','pt_sessions','pt_lessons','pt_coach_comments'
  ]) loop
    execute format(
      'create trigger audit_%I after insert or update or delete on %I for each row execute function audit_trigger_func();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- 8. УВЕДОМЛЕНИЯ КЛИЕНТУ (§17)
-- ---------------------------------------------------------------
create or replace function pt_notify_payload(p_lesson pt_lessons)
returns jsonb
language sql stable security definer
as $$
  select jsonb_build_object(
    'pt_lesson_id', p_lesson.id,
    'pt_session_id', p_lesson.session_id,
    'pt_package_id', p_lesson.package_id,
    'child_id', p_lesson.child_id,
    'child_name', (select c.full_name from children c where c.id = p_lesson.child_id),
    'coach_name', (
      select pr.full_name from pt_sessions s
      join profiles pr on pr.id = coalesce(s.actual_coach_id, s.coach_id)
      where s.id = p_lesson.session_id
    ),
    'service_name', (
      select sv.name from pt_sessions s
      join pt_services sv on sv.id = s.service_id
      where s.id = p_lesson.session_id
    ),
    'date', (select s.date from pt_sessions s where s.id = p_lesson.session_id),
    'start_time', (select s.start_time from pt_sessions s where s.id = p_lesson.session_id),
    'lessons_used', (select p.lessons_used from pt_packages p where p.id = p_lesson.package_id),
    'lessons_total', (select p.lessons_total from pt_packages p where p.id = p_lesson.package_id)
  );
$$;

create or replace function pt_notify_parent(p_child uuid, p_type text, p_payload jsonb)
returns void
language plpgsql security definer
as $$
declare
  v_parent uuid;
begin
  select f.parent_user_id into v_parent
    from children c join families f on f.id = c.family_id
   where c.id = p_child;
  if v_parent is not null then
    insert into notifications (recipient_id, type, payload) values (v_parent, p_type, p_payload);
  end if;
end;
$$;

create or replace function trg_pt_lesson_notify()
returns trigger
language plpgsql security definer
as $$
begin
  if tg_op = 'INSERT' and new.status = 'scheduled' then
    -- «Вы записаны на тренировку к тренеру X, Y числа в Z время»
    perform pt_notify_parent(new.child_id, 'pt_booked', pt_notify_payload(new));
  elsif tg_op = 'UPDATE' then
    if new.status = 'attended' and old.status is distinct from 'attended' then
      -- «Тренировка состоялась»
      perform pt_notify_parent(new.child_id, 'pt_completed', pt_notify_payload(new));
    elsif new.status = 'missed' and new.charged and not old.charged then
      -- «Ваша тренировка списана, так как вы заранее не уведомили тренера»
      perform pt_notify_parent(new.child_id, 'pt_charged_no_show', pt_notify_payload(new));
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_pt_lessons_notify
  after insert or update on pt_lessons
  for each row execute function trg_pt_lesson_notify();

-- Напоминание за 24 часа (вызывается ежечасным тиком backend)
create or replace function pt_send_reminders()
returns int
language plpgsql security definer
as $$
declare
  v_lesson pt_lessons%rowtype;
  v_count int := 0;
begin
  for v_lesson in
    select l.*
      from pt_lessons l
      join pt_sessions s on s.id = l.session_id
     where l.status = 'scheduled'
       and s.status = 'scheduled'
       and l.reminder_sent_at is null
       and (s.date + s.start_time) > now()
       and (s.date + s.start_time) <= now() + interval '24 hours'
  loop
    perform pt_notify_parent(v_lesson.child_id, 'pt_reminder', pt_notify_payload(v_lesson));
    update pt_lessons set reminder_sent_at = now() where id = v_lesson.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------
-- 9. ЖИЗНЕННЫЙ ЦИКЛ ПАКЕТОВ (§3: сроки активации и действия)
-- ---------------------------------------------------------------
create or replace function pt_refresh_lifecycle()
returns void
language plpgsql security definer
as $$
begin
  -- не активирован в срок → истёк
  update pt_packages
     set status = 'expired'
   where status in ('purchased', 'awaiting_activation')
     and activation_deadline is not null
     and activation_deadline < current_date;

  -- действующий с истёкшим сроком → истёк
  update pt_packages
     set status = 'expired'
   where status = 'active'
     and expires_at is not null
     and expires_at < current_date;
end;
$$;

-- ---------------------------------------------------------------
-- 10. ВНУТРЕННИЕ ХЕЛПЕРЫ
-- ---------------------------------------------------------------
-- Активация пакета (§3: автоматически при первом посещении / вручную)
create or replace function pt_activate_package_internal(
  p_package_id uuid, p_on_date date, p_by uuid, p_kind text
) returns void
language plpgsql security definer
as $$
declare
  v_pkg pt_packages%rowtype;
  v_validity int;
begin
  select * into v_pkg from pt_packages where id = p_package_id for update;
  if not found then
    raise exception 'pt_package_not_found' using errcode = 'P0002';
  end if;
  if v_pkg.status not in ('purchased', 'awaiting_activation') then
    return; -- уже активирован / финальный статус
  end if;
  select validity_days into v_validity from pt_services where id = v_pkg.service_id;
  update pt_packages
     set status = 'active',
         activated_at = now(),
         activated_by = p_by,
         activation_kind = p_kind,
         expires_at = coalesce(expires_at, p_on_date + (coalesce(v_validity, 30) || ' days')::interval)::date
   where id = p_package_id;
end;
$$;

-- Изменение статуса посещения с пересчётом списаний (§10: ручные корректировки)
create or replace function pt_set_lesson_status(
  p_lesson_id uuid,
  p_new_status pt_visit_status,
  p_charge boolean,
  p_actor uuid,
  p_reason text default null
) returns void
language plpgsql security definer
as $$
declare
  v_lesson pt_lessons%rowtype;
  v_pkg pt_packages%rowtype;
  v_delta int;
  v_date date;
begin
  select * into v_lesson from pt_lessons where id = p_lesson_id for update;
  if not found then
    raise exception 'pt_lesson_not_found' using errcode = 'P0002';
  end if;
  select * into v_pkg from pt_packages where id = v_lesson.package_id for update;

  v_delta := (case when p_charge then 1 else 0 end) - (case when v_lesson.charged then 1 else 0 end);

  if v_delta > 0 then
    if v_pkg.lessons_used + v_delta > v_pkg.lessons_total then
      raise exception 'pt_package_exhausted' using errcode = 'P0001';
    end if;
    select s.date into v_date from pt_sessions s where s.id = v_lesson.session_id;
    perform pt_activate_package_internal(v_pkg.id, coalesce(v_date, current_date), p_actor, 'auto');
  end if;

  -- сначала пакет, затем посещение: триггер уведомления на pt_lessons
  -- читает уже актуальный остаток пакета
  if v_delta <> 0 then
    update pt_packages
       set lessons_used = lessons_used + v_delta,
           status = case
             when lessons_used + v_delta >= lessons_total and status = 'active' then 'completed'
             when lessons_used + v_delta < lessons_total and status = 'completed' then 'active'
             else status
           end
     where id = v_pkg.id;
  end if;

  update pt_lessons
     set status = p_new_status,
         charged = p_charge,
         marked_by = p_actor,
         marked_at = now(),
         cancel_reason = case when p_new_status = 'cancelled' then coalesce(p_reason, cancel_reason) else cancel_reason end,
         cancelled_by = case when p_new_status = 'cancelled' then p_actor else cancelled_by end,
         restored_by = case when v_delta < 0 then p_actor else restored_by end,
         restored_at = case when v_delta < 0 then now() else restored_at end,
         comment = coalesce(p_reason, comment)
   where id = p_lesson_id;
end;
$$;

-- ---------------------------------------------------------------
-- 11. RPC: ПРОДАЖА ПАКЕТОВ (§2, §3, §8, §10 — долг с комментарием)
-- items: [{child_id, price, pay_cash, pay_deposit, in_debt, debt_comment}]
-- ---------------------------------------------------------------
create or replace function pt_sell_packages(
  p_organization_id uuid,
  p_sold_by uuid,
  p_service_id uuid,
  p_coach_id uuid,
  p_items jsonb,
  p_payment_method payment_method,
  p_group_name text default null,
  p_idempotency_key uuid default null
) returns table (group_id uuid, package_ids uuid[])
language plpgsql security definer
as $pt_sell$
declare
  v_svc pt_services%rowtype;
  v_item jsonb;
  v_n int;
  v_group_id uuid := null;
  v_pkg_id uuid;
  v_ids uuid[] := '{}';
  v_child uuid;
  v_price numeric;
  v_cash numeric;
  v_dep numeric;
  v_in_debt boolean;
  v_debt_comment text;
  v_paid numeric;
  v_status pt_package_status;
  v_total numeric := 0;
begin
  select * into v_svc from pt_services
   where id = p_service_id and organization_id = p_organization_id and deleted_at is null;
  if not found then
    raise exception 'pt_service_not_found' using errcode = 'P0002';
  end if;
  if not v_svc.is_active then
    raise exception 'pt_service_inactive' using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(p_items);
  if v_n is null or v_n < 1 then
    raise exception 'pt_no_items' using errcode = 'P0001';
  end if;
  if v_svc.type = 'personal' and v_n <> 1 then
    raise exception 'pt_personal_one_child' using errcode = 'P0001';
  end if;
  if v_svc.type = 'mini_group' and v_n > v_svc.capacity then
    raise exception 'pt_over_capacity' using errcode = 'P0001';
  end if;

  if v_svc.type = 'mini_group' then
    insert into pt_package_groups (organization_id, service_id, coach_id, name, total_price, capacity, created_by)
    values (p_organization_id, p_service_id, p_coach_id, p_group_name, 0, v_svc.capacity, p_sold_by)
    returning id into v_group_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_child := (v_item->>'child_id')::uuid;
    v_price := coalesce((v_item->>'price')::numeric, v_svc.price);
    v_cash := coalesce((v_item->>'pay_cash')::numeric, 0);
    v_dep := coalesce((v_item->>'pay_deposit')::numeric, 0);
    v_in_debt := coalesce((v_item->>'in_debt')::boolean, false);
    v_debt_comment := nullif(trim(coalesce(v_item->>'debt_comment', '')), '');
    v_paid := v_cash + v_dep;

    if v_paid > v_price then
      raise exception 'pt_overpayment' using errcode = 'P0001';
    end if;
    -- §10: продажа в долг — только с обязательным комментарием
    if v_paid < v_price then
      if not v_in_debt or v_debt_comment is null then
        raise exception 'pt_debt_comment_required' using errcode = 'P0001';
      end if;
    end if;

    v_status := case when v_paid >= v_price then 'awaiting_activation'::pt_package_status
                     else 'purchased'::pt_package_status end;

    insert into pt_packages (
      organization_id, child_id, service_id, coach_id, group_id,
      status, lessons_total, price, paid,
      sold_by, sold_in_debt, debt_comment, activation_deadline
    ) values (
      p_organization_id, v_child, p_service_id, p_coach_id, v_group_id,
      v_status, v_svc.lessons_count, v_price, v_paid,
      p_sold_by, v_in_debt and v_paid < v_price, v_debt_comment,
      current_date + (v_svc.activation_deadline_days || ' days')::interval
    ) returning id into v_pkg_id;

    v_ids := array_append(v_ids, v_pkg_id);
    v_total := v_total + v_price;

    if v_cash > 0 then
      insert into payments (organization_id, child_id, pt_package_id, amount, method, received_by, comment, idempotency_key)
      values (p_organization_id, v_child, v_pkg_id, v_cash, p_payment_method, p_sold_by,
              'ПТ: ' || v_svc.name,
              case when v_n = 1 then p_idempotency_key else null end);
    end if;
    if v_dep > 0 then
      insert into deposit_transactions (organization_id, child_id, amount, type, received_by, comment)
      values (p_organization_id, v_child, -v_dep, 'service_charge', p_sold_by, 'ПТ: ' || v_svc.name);
    end if;
  end loop;

  if v_group_id is not null then
    update pt_package_groups set total_price = v_total where id = v_group_id;
  end if;

  group_id := v_group_id;
  package_ids := v_ids;
  return next;
end;
$pt_sell$;

-- Доплата по пакету (§8: оплата каждого участника, задолженность)
create or replace function pt_record_payment(
  p_organization_id uuid,
  p_package_id uuid,
  p_received_by uuid,
  p_amount numeric,
  p_use_deposit numeric,
  p_method payment_method,
  p_comment text default null,
  p_idempotency_key uuid default null
) returns void
language plpgsql security definer
as $pt_pay$
declare
  v_pkg pt_packages%rowtype;
  v_total numeric;
begin
  select * into v_pkg from pt_packages where id = p_package_id for update;
  if not found then
    raise exception 'pt_package_not_found' using errcode = 'P0002';
  end if;
  if v_pkg.status in ('refunded', 'annulled') then
    raise exception 'pt_package_closed' using errcode = 'P0001';
  end if;
  v_total := coalesce(p_amount, 0) + coalesce(p_use_deposit, 0);
  if v_total <= 0 then
    raise exception 'pt_zero_payment' using errcode = 'P0001';
  end if;
  if v_pkg.paid + v_total > v_pkg.price then
    raise exception 'pt_overpayment' using errcode = 'P0001';
  end if;

  if coalesce(p_amount, 0) > 0 then
    insert into payments (organization_id, child_id, pt_package_id, amount, method, received_by, comment, idempotency_key)
    values (p_organization_id, v_pkg.child_id, p_package_id, p_amount, p_method, p_received_by, p_comment, p_idempotency_key);
  end if;
  if coalesce(p_use_deposit, 0) > 0 then
    insert into deposit_transactions (organization_id, child_id, amount, type, received_by, comment)
    values (p_organization_id, v_pkg.child_id, -p_use_deposit, 'service_charge', p_received_by, coalesce(p_comment, 'Оплата ПТ'));
  end if;

  update pt_packages
     set paid = paid + v_total,
         status = case when status = 'purchased' and paid + v_total >= price
                       then 'awaiting_activation'::pt_package_status else status end
   where id = p_package_id;
end;
$pt_pay$;

-- §8: запрет добавления участника в мини-группу после начала тренировок
create or replace function pt_add_group_participant(
  p_organization_id uuid,
  p_group_id uuid,
  p_sold_by uuid,
  p_child_id uuid,
  p_price numeric,
  p_pay_cash numeric,
  p_pay_deposit numeric,
  p_in_debt boolean,
  p_debt_comment text,
  p_payment_method payment_method
) returns uuid
language plpgsql security definer
as $pt_addp$
declare
  v_grp pt_package_groups%rowtype;
  v_started boolean;
  v_count int;
  v_ids uuid[];
begin
  select * into v_grp from pt_package_groups where id = p_group_id;
  if not found then
    raise exception 'pt_group_not_found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from pt_lessons l join pt_packages p on p.id = l.package_id
     where p.group_id = p_group_id and l.charged
  ) into v_started;
  if v_started then
    raise exception 'pt_group_already_started' using errcode = 'P0001';
  end if;

  select count(*) into v_count from pt_packages
   where group_id = p_group_id and status not in ('refunded', 'annulled');
  if v_count >= v_grp.capacity then
    raise exception 'pt_over_capacity' using errcode = 'P0001';
  end if;

  select package_ids into v_ids from pt_sell_packages(
    p_organization_id, p_sold_by, v_grp.service_id, v_grp.coach_id,
    jsonb_build_array(jsonb_build_object(
      'child_id', p_child_id, 'price', p_price, 'pay_cash', p_pay_cash,
      'pay_deposit', p_pay_deposit, 'in_debt', p_in_debt, 'debt_comment', p_debt_comment
    )),
    p_payment_method, null, null
  );

  -- привязываем к существующей группе вместо новой
  update pt_packages set group_id = p_group_id where id = v_ids[1];
  update pt_package_groups set total_price = total_price + p_price where id = p_group_id;
  return v_ids[1];
end;
$pt_addp$;

-- ---------------------------------------------------------------
-- 12. RPC: ЗАПИСЬ НА ТРЕНИРОВКУ (§5, §18, §19)
-- ---------------------------------------------------------------
create or replace function pt_book_session(
  p_organization_id uuid,
  p_created_by uuid,
  p_actor_is_coach boolean,
  p_service_id uuid,
  p_coach_id uuid,
  p_date date,
  p_start_time time,
  p_duration_min int,
  p_package_ids uuid[],
  p_comment text default null
) returns uuid
language plpgsql security definer
as $pt_book$
declare
  v_svc pt_services%rowtype;
  v_pkg pt_packages%rowtype;
  v_session_id uuid;
  v_pid uuid;
  v_group uuid := null;
  v_first boolean := true;
  v_scheduled int;
  v_active_other uuid;
  v_dur int;
begin
  select * into v_svc from pt_services where id = p_service_id and deleted_at is null;
  if not found then
    raise exception 'pt_service_not_found' using errcode = 'P0002';
  end if;
  v_dur := coalesce(p_duration_min, v_svc.duration_min);

  if array_length(p_package_ids, 1) is null then
    raise exception 'pt_no_items' using errcode = 'P0001';
  end if;

  -- конфликт по тренеру
  if exists (
    select 1 from pt_sessions s
     where s.coach_id = p_coach_id and s.date = p_date and s.status = 'scheduled'
       and s.start_time < p_start_time + (v_dur || ' minutes')::interval
       and p_start_time < s.start_time + (s.duration_min || ' minutes')::interval
  ) then
    raise exception 'pt_coach_busy' using errcode = 'P0001';
  end if;

  foreach v_pid in array p_package_ids loop
    select * into v_pkg from pt_packages where id = v_pid for update;
    if not found or v_pkg.organization_id <> p_organization_id then
      raise exception 'pt_package_not_found' using errcode = 'P0002';
    end if;
    if v_pkg.service_id <> p_service_id then
      raise exception 'pt_package_wrong_service' using errcode = 'P0001';
    end if;

    -- §19: тренер записывает только при полной оплате
    if p_actor_is_coach and v_pkg.paid < v_pkg.price then
      raise exception 'pt_not_fully_paid' using errcode = 'P0001';
    end if;
    if v_pkg.status not in ('purchased', 'awaiting_activation', 'active') then
      raise exception 'pt_package_not_bookable' using errcode = 'P0001';
    end if;
    if p_actor_is_coach and v_pkg.status = 'purchased' then
      raise exception 'pt_not_fully_paid' using errcode = 'P0001';
    end if;

    -- §3: следующий пакет нельзя использовать до завершения предыдущего
    select id into v_active_other from pt_packages
     where child_id = v_pkg.child_id and service_id = v_pkg.service_id
       and status = 'active' and id <> v_pkg.id
     limit 1;
    if v_active_other is not null then
      raise exception 'pt_previous_package_active' using errcode = 'P0001';
    end if;

    -- остаток с учётом уже запланированных
    select count(*) into v_scheduled from pt_lessons
     where package_id = v_pkg.id and status = 'scheduled';
    if v_pkg.lessons_used + v_scheduled >= v_pkg.lessons_total then
      raise exception 'pt_package_exhausted' using errcode = 'P0001';
    end if;

    -- срок действия
    if v_pkg.expires_at is not null and p_date > v_pkg.expires_at then
      raise exception 'pt_package_expires_before_date' using errcode = 'P0001';
    end if;

    -- мини-группа: все участники из одной группы (§8)
    if v_svc.type = 'mini_group' then
      if v_first then
        v_group := v_pkg.group_id;
      elsif v_group is distinct from v_pkg.group_id then
        raise exception 'pt_mixed_groups' using errcode = 'P0001';
      end if;
    end if;
    v_first := false;
  end loop;

  insert into pt_sessions (
    organization_id, service_id, coach_id, package_group_id,
    date, start_time, duration_min, comment, created_by
  ) values (
    p_organization_id, p_service_id, p_coach_id, v_group,
    p_date, p_start_time, v_dur, p_comment, p_created_by
  ) returning id into v_session_id;

  foreach v_pid in array p_package_ids loop
    insert into pt_lessons (organization_id, session_id, package_id, child_id)
    select p_organization_id, v_session_id, p.id, p.child_id
      from pt_packages p where p.id = v_pid;
  end loop;

  return v_session_id;
end;
$pt_book$;

-- ---------------------------------------------------------------
-- 13. RPC: ПРОВЕДЕНИЕ (§6, §7, §15)
-- attendance: [{lesson_id, status: 'attended'|'missed', charge, entry_time, exit_time}]
-- ---------------------------------------------------------------
create or replace function pt_complete_session(
  p_session_id uuid,
  p_completed_by uuid,
  p_source text,
  p_attendance jsonb,
  p_actual_coach_id uuid default null,
  p_substitution_comment text default null
) returns void
language plpgsql security definer
as $pt_complete$
declare
  v_session pt_sessions%rowtype;
  v_item jsonb;
  v_lesson_id uuid;
  v_status text;
  v_charge boolean;
begin
  select * into v_session from pt_sessions where id = p_session_id for update;
  if not found then
    raise exception 'pt_session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'pt_session_not_scheduled' using errcode = 'P0001';
  end if;

  update pt_sessions
     set status = 'completed',
         completed_at = now(),
         completed_by = p_completed_by,
         completed_source = p_source,
         actual_coach_id = case when p_actual_coach_id is not null and p_actual_coach_id <> coach_id
                                then p_actual_coach_id else actual_coach_id end,
         substitution_by = case when p_actual_coach_id is not null and p_actual_coach_id <> coach_id
                                then p_completed_by else substitution_by end,
         substitution_at = case when p_actual_coach_id is not null and p_actual_coach_id <> coach_id
                                then now() else substitution_at end,
         substitution_comment = coalesce(p_substitution_comment, substitution_comment)
   where id = p_session_id;

  for v_item in select * from jsonb_array_elements(p_attendance) loop
    v_lesson_id := (v_item->>'lesson_id')::uuid;
    v_status := coalesce(v_item->>'status', 'attended');
    v_charge := coalesce((v_item->>'charge')::boolean, true);
    if v_status not in ('attended', 'missed') then
      raise exception 'pt_bad_attendance_status' using errcode = 'P0001';
    end if;
    if v_status = 'attended' then
      v_charge := true; -- посещение всегда списывается
    end if;
    perform pt_set_lesson_status(v_lesson_id, v_status::pt_visit_status, v_charge, p_completed_by, null);
    update pt_lessons
       set entry_time = coalesce((v_item->>'entry_time')::timestamptz, entry_time),
           exit_time  = coalesce((v_item->>'exit_time')::timestamptz, exit_time)
     where id = v_lesson_id;
  end loop;
end;
$pt_complete$;

-- ---------------------------------------------------------------
-- 14. RPC: ОТМЕНА И ПЕРЕНОС (§9)
-- ---------------------------------------------------------------
create or replace function pt_cancel_session(
  p_session_id uuid,
  p_cancelled_by uuid,
  p_reason text,
  p_charge boolean default false
) returns void
language plpgsql security definer
as $pt_cancel$
declare
  v_session pt_sessions%rowtype;
  r record;
begin
  select * into v_session from pt_sessions where id = p_session_id for update;
  if not found then
    raise exception 'pt_session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'pt_session_not_scheduled' using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'pt_reason_required' using errcode = 'P0003';
  end if;

  update pt_sessions
     set status = 'cancelled', cancelled_at = now(),
         cancelled_by = p_cancelled_by, cancel_reason = p_reason
   where id = p_session_id;

  for r in select id from pt_lessons where session_id = p_session_id and status = 'scheduled' loop
    if p_charge then
      perform pt_set_lesson_status(r.id, 'missed', true, p_cancelled_by, p_reason);
    else
      perform pt_set_lesson_status(r.id, 'cancelled', false, p_cancelled_by, p_reason);
    end if;
  end loop;
end;
$pt_cancel$;

create or replace function pt_reschedule_session(
  p_session_id uuid,
  p_by uuid,
  p_new_date date,
  p_new_time time,
  p_reason text
) returns uuid
language plpgsql security definer
as $pt_resch$
declare
  v_session pt_sessions%rowtype;
  v_new_id uuid;
  r record;
begin
  select * into v_session from pt_sessions where id = p_session_id for update;
  if not found then
    raise exception 'pt_session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'pt_session_not_scheduled' using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'pt_reason_required' using errcode = 'P0003';
  end if;

  update pt_sessions
     set status = 'rescheduled', rescheduled_at = now(),
         rescheduled_by = p_by, reschedule_reason = p_reason
   where id = p_session_id;

  update pt_lessons
     set status = 'rescheduled', rescheduled_by = p_by, reschedule_reason = p_reason
   where session_id = p_session_id and status = 'scheduled';

  insert into pt_sessions (
    organization_id, service_id, coach_id, package_group_id,
    date, start_time, duration_min, comment, created_by, rescheduled_from
  ) values (
    v_session.organization_id, v_session.service_id, v_session.coach_id, v_session.package_group_id,
    p_new_date, p_new_time, v_session.duration_min, v_session.comment, p_by, p_session_id
  ) returning id into v_new_id;

  for r in select * from pt_lessons where session_id = p_session_id loop
    insert into pt_lessons (organization_id, session_id, package_id, child_id)
    values (r.organization_id, v_new_id, r.package_id, r.child_id);
  end loop;

  return v_new_id;
end;
$pt_resch$;

-- ---------------------------------------------------------------
-- 15. RPC: ЗАМЕНА ТРЕНЕРА (§15) — в т.ч. постфактум
-- ---------------------------------------------------------------
create or replace function pt_set_substitution(
  p_session_id uuid,
  p_actual_coach_id uuid,
  p_by uuid,
  p_comment text default null
) returns void
language plpgsql security definer
as $pt_sub$
declare
  v_session pt_sessions%rowtype;
begin
  select * into v_session from pt_sessions where id = p_session_id for update;
  if not found then
    raise exception 'pt_session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status not in ('scheduled', 'completed') then
    raise exception 'pt_session_not_substitutable' using errcode = 'P0001';
  end if;
  update pt_sessions
     set actual_coach_id = case when p_actual_coach_id = coach_id then null else p_actual_coach_id end,
         substitution_by = p_by,
         substitution_at = now(),
         substitution_comment = p_comment
   where id = p_session_id;
end;
$pt_sub$;

-- ---------------------------------------------------------------
-- 16. RPC: ВОЗВРАТ / БЛОКИРОВКА (§21)
-- ---------------------------------------------------------------
create or replace function pt_refund_package(
  p_package_id uuid,
  p_by uuid,
  p_kind text,             -- 'partial' | 'full'
  p_amount numeric,
  p_reason text,
  p_to_deposit boolean,
  p_method payment_method,
  p_idempotency_key uuid default null
) returns void
language plpgsql security definer
as $pt_refund$
declare
  v_pkg pt_packages%rowtype;
  v_refundable boolean;
begin
  select * into v_pkg from pt_packages where id = p_package_id for update;
  if not found then
    raise exception 'pt_package_not_found' using errcode = 'P0002';
  end if;
  select refundable into v_refundable from pt_services where id = v_pkg.service_id;
  if not coalesce(v_refundable, true) then
    raise exception 'pt_not_refundable' using errcode = 'P0001';
  end if;
  if p_kind not in ('partial', 'full') then
    raise exception 'pt_bad_refund_kind' using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'pt_reason_required' using errcode = 'P0003';
  end if;
  if p_amount <= 0 or p_amount > v_pkg.paid - v_pkg.refund_amount then
    raise exception 'pt_refund_amount_invalid' using errcode = 'P0001';
  end if;

  insert into payments (organization_id, child_id, pt_package_id, amount, method, received_by, comment, idempotency_key)
  values (v_pkg.organization_id, v_pkg.child_id, p_package_id, -p_amount, p_method, p_by,
          'Возврат ПТ: ' || p_reason, p_idempotency_key);

  if p_to_deposit then
    insert into deposit_transactions (organization_id, child_id, amount, type, received_by, comment)
    values (v_pkg.organization_id, v_pkg.child_id, p_amount, 'refund_in', p_by, 'Возврат ПТ: ' || p_reason);
  end if;

  update pt_packages
     set refund_amount = refund_amount + p_amount,
         refund_kind = p_kind,
         refunded_at = now(),
         refunded_by = p_by,
         status = case when p_kind = 'full' then 'refunded'::pt_package_status else status end,
         comment = coalesce(comment || E'\n', '') || 'Возврат: ' || p_reason
   where id = p_package_id;
end;
$pt_refund$;

-- ---------------------------------------------------------------
-- 17. ЗАРПЛАТА И РЕЕСТР ЗАМЕН (§12, §20)
-- ---------------------------------------------------------------
-- Процент тренера по услуге
create or replace function pt_coach_percent(p_service uuid, p_coach uuid)
returns numeric
language sql stable security definer
as $$
  select coalesce(
    (select r.percent from pt_service_coach_rates r
      where r.service_id = p_service and r.coach_id = p_coach and r.percent is not null),
    (select s.coach_percent_default from pt_services s where s.id = p_service),
    50
  );
$$;

-- Реестр замен (§20): начисление заменяющему тренеру
create or replace view v_pt_substitutions as
select
  s.id as session_id,
  s.organization_id,
  s.date,
  s.start_time,
  s.status,
  s.service_id,
  sv.name as service_name,
  s.coach_id as main_coach_id,
  mc.full_name as main_coach_name,
  s.actual_coach_id as sub_coach_id,
  sc.full_name as sub_coach_name,
  s.substitution_by,
  sb.full_name as substitution_by_name,
  s.substitution_at,
  s.substitution_comment,
  (select string_agg(c.full_name, ', ')
     from pt_lessons l join children c on c.id = l.child_id
    where l.session_id = s.id) as client_names,
  (select coalesce(sum(p.price / p.lessons_total), 0)
     from pt_lessons l join pt_packages p on p.id = l.package_id
    where l.session_id = s.id and l.charged) as lesson_value,
  pt_coach_percent(s.service_id, s.actual_coach_id) as coach_percent,
  round((select coalesce(sum(p.price / p.lessons_total), 0)
     from pt_lessons l join pt_packages p on p.id = l.package_id
    where l.session_id = s.id and l.charged)
    * pt_coach_percent(s.service_id, s.actual_coach_id) / 100, 2) as accrual
from pt_sessions s
join pt_services sv on sv.id = s.service_id
join profiles mc on mc.id = s.coach_id
join profiles sc on sc.id = s.actual_coach_id
left join profiles sb on sb.id = s.substitution_by
where s.actual_coach_id is not null
  and s.actual_coach_id <> s.coach_id;

grant select on v_pt_substitutions to authenticated;

-- Зарплата тренера по ПТ за период: свои + замены (§20: формула)
create or replace function compute_pt_coach_payroll(p_coach uuid, p_from date, p_to date)
returns table (
  own_sessions int,
  own_amount numeric,
  sub_sessions int,
  sub_amount numeric,
  total_sessions int,
  total_amount numeric
)
language sql stable security definer
as $$
  with eff as (
    select
      s.id,
      coalesce(s.actual_coach_id, s.coach_id) as eff_coach,
      (coalesce(s.actual_coach_id, s.coach_id) <> s.coach_id) as is_sub,
      (select coalesce(sum(p.price / p.lessons_total), 0)
         from pt_lessons l join pt_packages p on p.id = l.package_id
        where l.session_id = s.id and l.charged) as value,
      pt_coach_percent(s.service_id, coalesce(s.actual_coach_id, s.coach_id)) as pct
    from pt_sessions s
    where s.status = 'completed'
      and s.date between p_from and p_to
      and coalesce(s.actual_coach_id, s.coach_id) = p_coach
  )
  select
    count(*) filter (where not is_sub)::int,
    round(coalesce(sum(value * pct / 100) filter (where not is_sub), 0), 2),
    count(*) filter (where is_sub)::int,
    round(coalesce(sum(value * pct / 100) filter (where is_sub), 0), 2),
    count(*)::int,
    round(coalesce(sum(value * pct / 100), 0), 2)
  from eff;
$$;

-- ---------------------------------------------------------------
-- 18. RLS (§19: права доступа)
-- ---------------------------------------------------------------
alter table pt_services enable row level security;
alter table pt_service_coach_rates enable row level security;
alter table pt_package_groups enable row level security;
alter table pt_packages enable row level security;
alter table pt_sessions enable row level security;
alter table pt_lessons enable row level security;
alter table pt_coach_comments enable row level security;

-- услуги: видят все сотрудники и тренеры организации
create policy pt_services_org_select on pt_services for select
using ((is_staff() or is_coach()) and organization_id = auth_org());

create policy pt_service_coach_rates_select on pt_service_coach_rates for select
using ((is_staff() or is_coach()) and organization_id = auth_org());

create policy pt_package_groups_staff_select on pt_package_groups for select
using (is_staff() and organization_id = auth_org());

create policy pt_package_groups_coach_select on pt_package_groups for select
using (is_coach() and coach_id = auth.uid());

-- пакеты: staff — все; тренер — свои; родитель — своих детей
create policy pt_packages_staff_select on pt_packages for select
using (is_staff() and organization_id = auth_org());

create policy pt_packages_coach_select on pt_packages for select
using (is_coach() and coach_id = auth.uid());

create policy pt_packages_parent_select on pt_packages for select
using (
  is_parent() and child_id in (
    select c.id from children c join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

-- сессии
create policy pt_sessions_staff_select on pt_sessions for select
using (is_staff() and organization_id = auth_org());

create policy pt_sessions_coach_select on pt_sessions for select
using (is_coach() and (coach_id = auth.uid() or actual_coach_id = auth.uid()));

create policy pt_sessions_parent_select on pt_sessions for select
using (
  is_parent() and id in (
    select l.session_id from pt_lessons l
    join children c on c.id = l.child_id
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

-- посещения
create policy pt_lessons_staff_select on pt_lessons for select
using (is_staff() and organization_id = auth_org());

create policy pt_lessons_coach_select on pt_lessons for select
using (
  is_coach() and session_id in (
    select s.id from pt_sessions s
    where s.coach_id = auth.uid() or s.actual_coach_id = auth.uid()
  )
);

create policy pt_lessons_parent_select on pt_lessons for select
using (
  is_parent() and child_id in (
    select c.id from children c join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

-- комментарии тренера: staff + тренер
create policy pt_coach_comments_staff_select on pt_coach_comments for select
using (is_staff() and organization_id = auth_org());

create policy pt_coach_comments_coach_select on pt_coach_comments for select
using (is_coach() and coach_id = auth.uid());

-- родитель видит профиль ПТ-тренера своего ребёнка (имя в PWA),
-- по аналогии с profiles_parent_read_coaches для групповых тренеров
drop policy if exists profiles_parent_read_pt_coaches on profiles;
create policy profiles_parent_read_pt_coaches on profiles
  for select
  using (
    is_parent()
    and (
      exists (
        select 1
          from pt_packages p
          join children c on c.id = p.child_id
          join families f on f.id = c.family_id
         where p.coach_id = profiles.id
           and f.parent_user_id = auth.uid()
      )
      or exists (
        select 1
          from pt_sessions s
          join pt_lessons l on l.session_id = s.id
          join children c on c.id = l.child_id
          join families f on f.id = c.family_id
         where (s.coach_id = profiles.id or s.actual_coach_id = profiles.id)
           and f.parent_user_id = auth.uid()
      )
    )
  );
