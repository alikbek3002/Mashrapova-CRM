-- =====================================================================
-- org_settings — настройки клуба, читаемые backend'ом при продаже карт.
-- Сейчас вынесено только: вкл/выкл и сумма скидки для 2-го ребёнка в семье.
-- Раньше было хардкодом 500 KGS в backend/src/routes/v1/cards.ts.
-- =====================================================================

create table org_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  sibling_discount_enabled boolean not null default true,
  sibling_discount_amount numeric(12, 2) not null default 500 check (sibling_discount_amount >= 0),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

comment on table org_settings is
  'Настройки клуба. Сейчас содержит только настройки скидок (для 2-го ребёнка в семье).';

-- Seed: для каждой существующей организации создать дефолты
insert into org_settings (organization_id)
  select id from organizations
  on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table org_settings enable row level security;

-- staff читает (нужно для UI: SellCardModal предварительно показывает скидку)
create policy org_settings_staff_read on org_settings for select
  using (is_staff() and organization_id = auth_org());

-- write — только директор
create policy org_settings_director_write on org_settings for update
  using (is_director() and organization_id = auth_org())
  with check (is_director() and organization_id = auth_org());

create policy org_settings_director_insert on org_settings for insert
  with check (is_director() and organization_id = auth_org());
