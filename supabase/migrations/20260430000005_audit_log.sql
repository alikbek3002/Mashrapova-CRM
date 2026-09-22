-- =====================================================================
-- Audit log — track all critical actions
-- =====================================================================

create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id),
  actor_id uuid references profiles(id),
  actor_role user_role,
  action text not null, -- e.g. 'card.sell', 'freeze.approve', 'lesson.cancel'
  entity_type text not null, -- e.g. 'club_card', 'freeze', 'lesson'
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_log_org_created on audit_log (organization_id, created_at desc);
create index audit_log_actor_created on audit_log (actor_id, created_at desc);
create index audit_log_entity on audit_log (entity_type, entity_id);

-- Read-only for staff; only service role can insert.
alter table audit_log enable row level security;

create policy audit_log_staff_read on audit_log for select
using (is_staff() and organization_id = auth_org());

-- =====================================================================
-- Generic trigger for capturing changes on critical tables
-- The trigger writes to audit_log with current_setting('app.actor_id') if set.
-- Backend should set this at the start of each request:
--   SELECT set_config('app.actor_id', :user_id::text, true);
-- =====================================================================
create or replace function audit_trigger_func()
returns trigger as $$
declare
  actor uuid;
  org_id uuid;
  v_action text;
begin
  begin
    actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  exception when others then
    actor := null;
  end;

  if (tg_op = 'INSERT') then
    v_action := tg_table_name || '.insert';
    org_id := (new.organization_id)::uuid;
    insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, after_data)
    values (org_id, actor, v_action, tg_table_name, (new.id)::uuid, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    v_action := tg_table_name || '.update';
    org_id := (new.organization_id)::uuid;
    insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data)
    values (org_id, actor, v_action, tg_table_name, (new.id)::uuid, to_jsonb(old), to_jsonb(new));
    return new;
  elsif (tg_op = 'DELETE') then
    v_action := tg_table_name || '.delete';
    org_id := (old.organization_id)::uuid;
    insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data)
    values (org_id, actor, v_action, tg_table_name, (old.id)::uuid, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

-- Apply audit triggers to financial / critical tables
create trigger audit_club_cards
  after insert or update or delete on club_cards
  for each row execute function audit_trigger_func();

create trigger audit_payments
  after insert or update or delete on payments
  for each row execute function audit_trigger_func();

create trigger audit_freezes
  after insert or update or delete on freezes
  for each row execute function audit_trigger_func();

create trigger audit_lessons
  after update or delete on lessons
  for each row execute function audit_trigger_func();
