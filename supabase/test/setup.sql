-- Заглушки окружения Supabase: локальный Postgres их не содержит.
-- Это НЕ имитация поведения Supabase, а минимум, чтобы миграции
-- выполнились и можно было поймать ошибки SQL.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;

-- В Supabase это настоящие таблицы GoTrue.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  status text
);

-- Текущий пользователь и JWT. В тесте подставляются через set_config.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Supabase Storage: миграции создают бакеты и политики на storage.objects.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

-- storage.foldername() — хелпер Supabase, разбивает путь объекта на части.
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/')
$$;
