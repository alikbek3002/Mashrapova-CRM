-- =====================================================================
-- Outreach log — weekly call/whatsapp tracking per child
-- (КП ТЗ_01: дашборд "Надо позвонить" с чекбоксами)
-- =====================================================================

create table outreach_log (
  id uuid primary key default uuid_generate_v4(),
  child_id uuid not null references children(id) on delete cascade,
  week_start date not null,
  service_call_done boolean not null default false,
  whatsapp_sent boolean not null default false,
  actor_id uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (child_id, week_start)
);

create index outreach_log_week_idx on outreach_log(week_start desc);
create index outreach_log_child_idx on outreach_log(child_id);

alter table outreach_log enable row level security;

-- Staff only (admin/manager/cashier) — all access in their org via children FK
create policy outreach_staff_all on outreach_log for all
using (
  is_staff() and exists (
    select 1 from children c where c.id = outreach_log.child_id and c.organization_id = auth_org()
  )
)
with check (
  is_staff() and exists (
    select 1 from children c where c.id = outreach_log.child_id and c.organization_id = auth_org()
  )
);
