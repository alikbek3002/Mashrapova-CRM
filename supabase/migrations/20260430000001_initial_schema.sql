-- =====================================================================
-- Uniqum Sport ERP — initial schema (Phase 1)
-- All money fields: numeric(12,2). All entities: organization_id + soft delete.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;
create extension if not exists citext;

-- =====================================================================
-- Enums
-- =====================================================================
create type user_role as enum ('admin', 'manager', 'cashier', 'coach', 'parent');
create type child_status as enum ('active', 'frozen', 'expired', 'debtor', 'archived');
create type section_category as enum ('gymnastics', 'martial_arts', 'special');
create type lesson_type as enum ('regular', 'trial', 'single');
create type lesson_status as enum ('scheduled', 'completed', 'cancelled', 'force_majeure');
create type card_type as enum ('monthly', 'quarterly', 'personal', 'single', 'trial');
create type card_status as enum ('active', 'ending', 'frozen', 'expired', 'debt', 'archived');
create type attendance_status as enum ('present', 'absent', 'excused', 'late', 'makeup');
create type freeze_status as enum ('pending', 'approved', 'rejected');
create type freeze_initiator_role as enum ('coach', 'manager');
create type payment_method as enum ('cash', 'terminal');
create type lead_stage as enum ('new', 'trial', 'waiting');

-- =====================================================================
-- Organizations
-- =====================================================================
create table organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  timezone text not null default 'Asia/Bishkek',
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Profiles (extends auth.users)
-- =====================================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  role user_role not null,
  full_name text not null,
  phone text,
  email citext,
  avatar_url text,
  is_active boolean not null default true,
  mfa_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- =====================================================================
-- Families
-- =====================================================================
create table families (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  parent_user_id uuid references profiles(id), -- account for parent app
  father_name text,
  father_phone text,
  mother_name text,
  mother_phone text,
  responsible_manager_id uuid references profiles(id),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- =====================================================================
-- Children
-- =====================================================================
create table children (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  family_id uuid not null references families(id),
  full_name text not null,
  birth_date date not null,
  photo_path text, -- path in private storage bucket
  card_number text unique,
  status child_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- =====================================================================
-- Coaches (extension of profiles for coach role)
-- =====================================================================
create table coaches (
  id uuid primary key references profiles(id) on delete cascade,
  bio text,
  achievements text,
  experience_years int default 0
);

-- =====================================================================
-- Sections
-- =====================================================================
create table sections (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  name_ru text not null,
  name_ky text not null,
  category section_category not null,
  subscription_price numeric(12,2) not null,
  trial_price numeric(12,2) not null default 0,
  color text, -- hex for UI
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- m2m: section ↔ coach
create table section_coaches (
  section_id uuid references sections(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  primary key (section_id, coach_id)
);

-- =====================================================================
-- Groups
-- =====================================================================
create table groups (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  section_id uuid not null references sections(id),
  coach_id uuid not null references coaches(id),
  name text not null,
  max_capacity int not null default 12,
  hard_limit_override boolean not null default false,
  duration_min int not null default 60,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Regular weekly schedule template
create table group_schedule (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  duration_min int not null
);

-- =====================================================================
-- Lessons (concrete instances)
-- =====================================================================
create table lessons (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  group_id uuid not null references groups(id),
  coach_id uuid not null references coaches(id), -- may differ from groups.coach_id (substitution)
  date date not null,
  start_time time not null,
  duration_min int not null,
  type lesson_type not null default 'regular',
  capacity_limit int,
  status lesson_status not null default 'scheduled',
  cancellation_reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- Enrollments (child → group)
-- =====================================================================
create table enrollments (
  id uuid primary key default uuid_generate_v4(),
  child_id uuid not null references children(id),
  group_id uuid not null references groups(id),
  enrolled_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (child_id, group_id, archived_at)
);

-- =====================================================================
-- Club cards (subscriptions)
-- =====================================================================
create table club_cards (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  child_id uuid not null references children(id),
  type card_type not null,
  total_lessons int, -- 12 / 36 / 1 / null for personal
  freeze_quota int not null default 0, -- 3 for quarterly
  price_paid numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  start_date date not null,
  end_date date not null,
  status card_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- Attendance
-- =====================================================================
create table attendance (
  id uuid primary key default uuid_generate_v4(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  child_id uuid not null references children(id),
  status attendance_status not null,
  marked_by uuid references profiles(id),
  marked_at timestamptz not null default now(),
  unique (lesson_id, child_id)
);

-- =====================================================================
-- Freezes
-- =====================================================================
create table freezes (
  id uuid primary key default uuid_generate_v4(),
  child_id uuid not null references children(id),
  club_card_id uuid not null references club_cards(id),
  initiated_by uuid not null references profiles(id),
  initiator_role freeze_initiator_role not null,
  reason text,
  status freeze_status not null default 'pending',
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Payments
-- =====================================================================
create table payments (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  child_id uuid not null references children(id),
  club_card_id uuid references club_cards(id),
  amount numeric(12,2) not null,
  currency text not null default 'KGS',
  method payment_method not null,
  received_by uuid references profiles(id),
  paid_at timestamptz not null default now(),
  comment text,
  idempotency_key uuid unique
);

-- =====================================================================
-- Progress notes
-- =====================================================================
create table progress_notes (
  id uuid primary key default uuid_generate_v4(),
  child_id uuid not null references children(id),
  coach_id uuid not null references coaches(id),
  text text not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Notifications
-- =====================================================================
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references profiles(id),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Leads (placeholder for AMO Phase 3)
-- =====================================================================
create table leads (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  parent_name text,
  phone text,
  child_name text,
  child_age int,
  section_interest_id uuid references sections(id),
  stage lead_stage not null default 'new',
  responsible_manager_id uuid references profiles(id),
  source text,
  comment text,
  created_at timestamptz not null default now(),
  converted_at timestamptz
);

-- =====================================================================
-- Idempotency keys (for backend mutations)
-- =====================================================================
create table idempotency_keys (
  key uuid primary key,
  endpoint text not null,
  user_id uuid references profiles(id),
  response jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Helper function for updated_at trigger
-- =====================================================================
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply updated_at trigger to relevant tables
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'profiles','families','children','sections','groups','lessons','club_cards'
  ]) loop
    execute format(
      'create trigger set_updated_at before update on %I for each row execute function trigger_set_updated_at();',
      t
    );
  end loop;
end $$;
