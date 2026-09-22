-- Журнал команд управления турникетом (открыть разово / свободный проход /
-- обычный режим / закрыт) — «кто и когда включил». Команды шлёт backend
-- через ISUP-сервис; последняя alwaysOpen/alwaysClose определяет текущий
-- режим терминала в UI.

create table access_door_commands (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  device_serial text not null,
  cmd text not null check (cmd in ('open', 'alwaysOpen', 'alwaysClose', 'resume')),
  actor uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index access_door_commands_device_time
  on access_door_commands (device_serial, created_at desc);

alter table access_door_commands enable row level security;

create policy access_door_commands_staff_select on access_door_commands for select
using (is_staff() and organization_id = auth_org());
