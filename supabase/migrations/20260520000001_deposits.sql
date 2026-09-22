-- =====================================================================
-- Депозитная подсистема (per child).
--
-- Модель: денормализованный кэш баланса в child_deposits + append-only
-- журнал движений в deposit_transactions. CHECK (balance >= 0) гарантирует,
-- что баланс не уйдёт в минус — это инвариант на уровне СУБД.
--
-- Триггер trg_deposit_tx_apply делает три вещи в одной транзакции:
--   1) лочит строку child_deposits (FOR UPDATE) — гонки исключены
--   2) обновляет balance += new.amount; кидает ошибку если < 0
--   3) заполняет new.balance_after
--
-- payments.method остаётся ('cash','terminal') — depozit-списания учитываются
-- ТОЛЬКО в deposit_transactions, не дублируются в payments.
-- =====================================================================

create type deposit_tx_type as enum (
  'top_up',
  'withdraw',
  'card_purchase',
  'card_renewal',
  'refund_in',
  'service_charge',
  'adjustment'
);

create table child_deposits (
  child_id uuid primary key references children(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  balance numeric(12, 2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create index child_deposits_org_idx on child_deposits(organization_id);

comment on table child_deposits is
  'Кэш текущего баланса депозита ребёнка. Источник истины — deposit_transactions, обновляется триггером.';

create table deposit_transactions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  child_id uuid not null references children(id),
  amount numeric(12, 2) not null,
  type deposit_tx_type not null,
  balance_after numeric(12, 2) not null,
  related_card_id uuid references club_cards(id),
  related_payment_id uuid references payments(id),
  related_refund_id uuid references refunds(id),
  received_by uuid not null references profiles(id),
  paid_at timestamptz not null default now(),
  comment text,
  idempotency_key uuid unique,
  created_at timestamptz not null default now()
);
create index dep_tx_child_idx on deposit_transactions(child_id, paid_at desc);
create index dep_tx_org_idx on deposit_transactions(organization_id, paid_at desc);

comment on table deposit_transactions is
  'Журнал движений по депозитам. Append-only: UPDATE/DELETE запрещены, коррекции — type=adjustment.';

create or replace function fn_apply_deposit_tx() returns trigger
language plpgsql security definer
as $apply_deposit$
declare
  v_current numeric(12, 2);
  v_new numeric(12, 2);
begin
  insert into child_deposits (child_id, organization_id, balance)
    values (new.child_id, new.organization_id, 0)
    on conflict (child_id) do nothing;

  select balance into v_current
    from child_deposits where child_id = new.child_id
    for update;

  v_new := v_current + new.amount;
  if v_new < 0 then
    raise exception 'deposit_insufficient: have %, need %', v_current, -new.amount
      using errcode = 'check_violation';
  end if;

  update child_deposits
     set balance = v_new, updated_at = now()
   where child_id = new.child_id;

  new.balance_after := v_new;
  return new;
end;
$apply_deposit$;

create trigger trg_deposit_tx_apply
  before insert on deposit_transactions
  for each row execute function fn_apply_deposit_tx();

alter table child_deposits enable row level security;
alter table deposit_transactions enable row level security;

create policy child_deposits_staff_read on child_deposits for select
  using (is_staff() and organization_id = auth_org());

create policy child_deposits_parent_read on child_deposits for select
  using (is_parent() and child_id in (select parent_child_ids()));

create policy dep_tx_staff_read on deposit_transactions for select
  using (is_staff() and organization_id = auth_org());

create policy dep_tx_parent_read on deposit_transactions for select
  using (is_parent() and child_id in (select parent_child_ids()));
