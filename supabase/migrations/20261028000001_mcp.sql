-- =====================================================================
-- MCP: доступ к CRM из Claude и ChatGPT (2026-10-28)
-- =====================================================================
-- Директор и старший менеджер подключают CRM как «коннектор» в Claude или
-- ChatGPT. Вход — OAuth 2.1 на бэкенде (backend/src/mcp/oauth.ts): человек
-- вводит тот же телефон и пароль, что в CRM, и ассистент получает свой
-- токен. Дальше каждый запрос ассистента идёт от имени этого человека:
-- чтение — под его RLS, запись — через те же маршруты /v1/*, что у
-- интерфейса.
--
-- Таблицы читает и пишет только бэкенд (service_role): RLS включён,
-- политик нет. Токены хранятся только хешами, сессия Supabase —
-- зашифрованной (AES-256-GCM, ключ MCP_SECRET).

create table if not exists mcp_clients (
  id            text primary key,              -- client_id, выдаётся при регистрации
  name          text,
  redirect_uris text[] not null,
  created_at    timestamptz not null default now()
);

create table if not exists mcp_sessions (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references profiles(id),
  client_id           text not null references mcp_clients(id),
  access_hash         text not null unique,
  access_expires_at   timestamptz not null,
  refresh_hash        text not null unique,
  refresh_expires_at  timestamptz not null,
  sb_session_enc      text not null,           -- сессия Supabase (access + refresh), зашифрована
  revoked_at          timestamptz,
  last_used_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists mcp_sessions_profile_idx on mcp_sessions(profile_id);

-- Журнал вызовов: что ассистент читал и менял, от чьего имени.
create table if not exists mcp_audit (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references profiles(id),
  session_id  uuid references mcp_sessions(id),
  tool        text not null,
  args        jsonb,
  ok          boolean not null,
  error       text,
  ms          integer,
  created_at  timestamptz not null default now()
);
create index if not exists mcp_audit_profile_idx on mcp_audit(profile_id, created_at desc);

alter table mcp_clients  enable row level security;
alter table mcp_sessions enable row level security;
alter table mcp_audit    enable row level security;

-- Журнал не удаляется, как и остальной учёт. Сессии отзываются через revoked_at.
drop trigger if exists forbid_delete on mcp_audit;
create trigger forbid_delete before delete on mcp_audit
  for each row execute function forbid_delete();
drop trigger if exists forbid_delete on mcp_sessions;
create trigger forbid_delete before delete on mcp_sessions
  for each row execute function forbid_delete();

comment on table mcp_sessions is
  'Подключения Claude/ChatGPT к CRM (MCP). Отозвать — проставить revoked_at.';
comment on table mcp_audit is
  'Журнал вызовов инструментов MCP: кто, что, с какими аргументами, успешно ли.';
