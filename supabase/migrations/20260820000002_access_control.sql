-- =====================================================================
-- Турникеты Hikvision (Face ID): реестр терминалов + журнал проходов.
-- Турникет НЕ ставит посещаемость — только журнал присутствия (подсказка
-- тренеру) и автозаполнение entry/exit в ПТ (позже). См. docs/Интеграция_Турникеты_FaceID.md
-- =====================================================================

create table access_devices (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  serial text not null unique,                     -- серийник/имя устройства из события
  name text not null,                              -- «Вход», «Выход» (редактируется админом)
  ip text,
  direction text not null default 'in' check (direction in ('in','out','both')),
  last_seen_at timestamptz,                        -- heartbeat: жив ли терминал/канал
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table access_events (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  child_id uuid references children(id),           -- null = лицо не сопоставлено с ребёнком
  person_no text,                                  -- employeeNo с терминала (до/без сопоставления)
  device_serial text not null,
  event_serial bigint not null,                    -- порядковый № события на устройстве
  event_type text not null check (event_type in ('face_ok','face_fail','card_ok','other')),
  direction text not null default 'unknown' check (direction in ('in','out','unknown')),
  occurred_at timestamptz not null,
  raw jsonb,                                       -- исходное событие (отладка пилота)
  created_at timestamptz not null default now(),
  unique (device_serial, event_serial)             -- идемпотентность: терминал может переслать повторно
);

create index access_events_child_time on access_events (child_id, occurred_at desc);
create index access_events_org_time on access_events (organization_id, occurred_at desc);

-- Связка ребёнок ↔ терминал (employeeNo на всех терминалах) + фото для проходной
alter table children add column access_person_no text unique;
alter table children add column face_photo_path text;
alter table children add column face_enrolled_at timestamptz;

-- RLS: читает персонал/тренеры своей организации; пишет только service role (backend)
alter table access_devices enable row level security;
alter table access_events enable row level security;

create policy access_devices_staff_select on access_devices for select
using (is_staff() and organization_id = auth_org());

create policy access_events_org_select on access_events for select
using ((is_staff() or is_coach()) and organization_id = auth_org());
