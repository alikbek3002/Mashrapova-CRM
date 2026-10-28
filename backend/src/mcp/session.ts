// Сессия MCP → живой JWT Supabase от имени человека.
// Ассистент присылает наш непрозрачный токен; по хешу находим сессию,
// расшифровываем сессию Supabase и, если её access_token истекает,
// обновляем по refresh_token. Refresh-токены Supabase одноразовые, поэтому
// обновление одной сессии идёт строго по очереди (мьютекс в процессе:
// бэкенд работает в одном экземпляре, см. SCHEDULER_ENABLED).
import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.js";
import { supabaseAdmin } from "../lib/supabase.js";
import type { AppRole } from "../middleware/auth.js";
import { decrypt, encrypt, sha256 } from "./crypto.js";

// Кому открыт MCP. Решение заказчика 2026-10-28: директор и старший менеджер.
export const MCP_ROLES: AppRole[] = ["director", "senior_manager"];

export type SbSession = { access_token: string; refresh_token: string; expires_at: number };

export type McpUser = {
  sessionId: string;
  id: string;
  role: AppRole;
  full_name: string;
  organization_id: string;
  jwt: string;
};

export const anonClient = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const locks = new Map<string, Promise<unknown>>();
const withLock = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(id, next);
  try {
    return await next;
  } finally {
    if (locks.get(id) === next) locks.delete(id);
  }
};

export const loadStaff = async (userId: string) => {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, role, full_name, organization_id, is_active, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (!data || !data.is_active || data.deleted_at) return null;
  return data as { id: string; role: AppRole; full_name: string; organization_id: string };
};

// null — токена нет, он истёк, отозван, или человек больше не директор/РОП.
export const resolveBearer = async (token: string): Promise<McpUser | null> => {
  const { data: s } = await supabaseAdmin
    .from("mcp_sessions")
    .select("id, profile_id, access_expires_at, revoked_at")
    .eq("access_hash", sha256(token))
    .maybeSingle();
  if (!s || s.revoked_at || new Date(s.access_expires_at) <= new Date()) return null;

  const profile = await loadStaff(s.profile_id);
  if (!profile || !MCP_ROLES.includes(profile.role)) return null;

  const jwt = await withLock(s.id, async () => {
    const { data: row } = await supabaseAdmin
      .from("mcp_sessions").select("sb_session_enc").eq("id", s.id).single();
    const sb = JSON.parse(decrypt(row!.sb_session_enc)) as SbSession;
    if (sb.expires_at - 60 > Date.now() / 1000) return sb.access_token;

    const { data, error } = await anonClient().auth.refreshSession({ refresh_token: sb.refresh_token });
    if (error || !data.session) return null;
    const fresh: SbSession = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    };
    await supabaseAdmin
      .from("mcp_sessions")
      .update({ sb_session_enc: encrypt(JSON.stringify(fresh)) })
      .eq("id", s.id);
    return fresh.access_token;
  });
  if (!jwt) return null;

  void supabaseAdmin.from("mcp_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
  return {
    sessionId: s.id,
    id: profile.id,
    role: profile.role,
    full_name: profile.full_name,
    organization_id: profile.organization_id,
    jwt,
  };
};
