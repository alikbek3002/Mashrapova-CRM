// OAuth 2.1 для MCP-коннектора (спецификация MCP Authorization, 2025-06-18).
//
// Claude и ChatGPT подключают CRM одинаково: находят сервер авторизации
// через /.well-known, регистрируются (Dynamic Client Registration),
// открывают человеку нашу страницу входа и меняют код на токен (PKCE S256).
//
// Страница входа — тот же телефон и пароль, что в CRM, плюс код 2FA, если
// он подключён. Пускаем только директора и старшего менеджера (MCP_ROLES).
// После входа держим сессию Supabase этого человека: все запросы
// ассистента идут от его имени, под его правами (RLS и requireRole).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../lib/env.js";
import { normalizeE164KG, phoneToPseudoEmail } from "../lib/phone.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { encrypt, pkceOk, randomToken, sha256 } from "./crypto.js";
import { loginPage, type LoginView } from "./page.js";
import { anonClient, loadStaff, MCP_ROLES, type SbSession } from "./session.js";

const ACCESS_TTL_S = 60 * 60;            // 1 час
const REFRESH_TTL_S = 30 * 24 * 60 * 60; // 30 дней
const CODE_TTL_MS = 5 * 60 * 1000;

export const SCOPE = "crm";

export const baseUrl = (req: FastifyRequest) =>
  env.PUBLIC_API_URL?.replace(/\/$/, "") ?? `${req.protocol}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;

// Одноразовые коды и незавершённые входы (ждут код 2FA) — в памяти:
// живут минуты, а бэкенд один.
type Pending = { profileId: string; sb: SbSession; expires: number };
type Code = Pending & { clientId: string; redirectUri: string; challenge: string };
const codes = new Map<string, Code>();
const mfaWaits = new Map<string, Pending & { factorId: string; params: AuthParams }>();
const sweep = () => {
  const now = Date.now();
  for (const [k, v] of codes) if (v.expires < now) codes.delete(k);
  for (const [k, v] of mfaWaits) if (v.expires < now) mfaWaits.delete(k);
};

type AuthParams = {
  client_id: string;
  redirect_uri: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
  resource?: string;
};

const pickParams = (src: Record<string, unknown>): AuthParams => ({
  client_id: String(src.client_id ?? ""),
  redirect_uri: String(src.redirect_uri ?? ""),
  state: src.state ? String(src.state) : undefined,
  code_challenge: String(src.code_challenge ?? ""),
  code_challenge_method: String(src.code_challenge_method ?? ""),
  scope: src.scope ? String(src.scope) : undefined,
  resource: src.resource ? String(src.resource) : undefined,
});

const findClient = async (id: string) => {
  if (!id) return null;
  const { data } = await supabaseAdmin.from("mcp_clients").select("id, name, redirect_uris").eq("id", id).maybeSingle();
  return data as { id: string; name: string | null; redirect_uris: string[] } | null;
};

// Ошибки до проверки redirect_uri показываем на странице, а не редиректом:
// иначе нашу форму можно превратить в открытый редирект.
const validate = async (p: AuthParams): Promise<{ error?: string; clientName?: string }> => {
  const client = await findClient(p.client_id);
  if (!client) return { error: "Приложение не зарегистрировано. Подключите коннектор заново." };
  if (!client.redirect_uris.includes(p.redirect_uri)) return { error: "Неизвестный адрес возврата приложения." };
  if (p.code_challenge_method !== "S256" || !p.code_challenge) return { error: "Приложение не поддерживает PKCE (S256)." };
  return { clientName: client.name ?? undefined };
};

const redirectWithCode = (reply: FastifyReply, p: AuthParams, pending: Pending) => {
  sweep();
  const code = randomToken();
  codes.set(code, {
    ...pending,
    clientId: p.client_id,
    redirectUri: p.redirect_uri,
    challenge: p.code_challenge,
    expires: Date.now() + CODE_TTL_MS,
  });
  const url = new URL(p.redirect_uri);
  url.searchParams.set("code", code);
  if (p.state) url.searchParams.set("state", p.state);
  return reply.redirect(url.toString(), 302);
};

const render = (reply: FastifyReply, view: LoginView, status = 200) =>
  reply.code(status).header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("x-frame-options", "DENY")
    .send(loginPage(view));

const toSb = (s: { access_token: string; refresh_token: string; expires_at?: number }): SbSession => ({
  access_token: s.access_token,
  refresh_token: s.refresh_token,
  expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
});

const issueTokens = async (profileId: string, clientId: string, sb: SbSession, sessionId?: string) => {
  const access = randomToken();
  const refresh = randomToken();
  const now = Date.now();
  const row = {
    access_hash: sha256(access),
    access_expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString(),
    refresh_hash: sha256(refresh),
    refresh_expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString(),
  };
  if (sessionId) {
    await supabaseAdmin.from("mcp_sessions").update(row).eq("id", sessionId);
  } else {
    const { error } = await supabaseAdmin.from("mcp_sessions").insert({
      ...row,
      profile_id: profileId,
      client_id: clientId,
      sb_session_enc: encrypt(JSON.stringify(sb)),
    });
    if (error) throw error;
  }
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    scope: SCOPE,
  };
};

const tokenError = (reply: FastifyReply, error: string, description: string, code = 400) =>
  reply.code(code).header("cache-control", "no-store").send({ error, error_description: description });

export const mcpOAuthRoutes = async (app: FastifyInstance) => {
  // Формы и /oauth/token приходят как application/x-www-form-urlencoded.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  app.addHook("onRequest", async (_req, reply) => {
    if (!env.MCP_SECRET) return reply.code(503).send({ error: "mcp_disabled" });
  });

  const protectedResource = async (req: FastifyRequest) => ({
    resource: `${baseUrl(req)}/mcp`,
    authorization_servers: [baseUrl(req)],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "CRM Академии Машрапова",
  });
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

  const authServer = async (req: FastifyRequest) => {
    const b = baseUrl(req);
    return {
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
    };
  };
  app.get("/.well-known/oauth-authorization-server", authServer);
  app.get("/.well-known/openid-configuration", authServer);

  // Dynamic Client Registration (RFC 7591). Клиенты публичные: секрет не
  // выдаём, защита — PKCE и точное совпадение redirect_uri.
  app.post("/oauth/register", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = (req.body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
    const okUri = (u: string) => {
      try {
        const url = new URL(u);
        return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
      } catch { return false; }
    };
    if (uris.length === 0 || uris.length > 10 || !uris.every(okUri)) {
      return reply.code(400).send({ error: "invalid_redirect_uri", error_description: "Нужны https-адреса возврата (или localhost)" });
    }
    const id = `mcp_${randomToken(18)}`;
    const name = typeof body.client_name === "string" ? body.client_name.slice(0, 100) : null;
    const { error } = await supabaseAdmin.from("mcp_clients").insert({ id, name, redirect_uris: uris });
    if (error) return reply.code(500).send({ error: "server_error" });
    return reply.code(201).send({
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name ?? undefined,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  app.get("/oauth/authorize", async (req, reply) => {
    const p = pickParams(req.query as Record<string, unknown>);
    const v = await validate(p);
    if (v.error) return render(reply, { step: "error", error: v.error }, 400);
    return render(reply, { step: "login", params: p, clientName: v.clientName });
  });

  app.post("/oauth/authorize", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;

    // Шаг 2: код 2FA к уже проверенному паролю.
    if (body.mfa_nonce) {
      sweep();
      const wait = mfaWaits.get(body.mfa_nonce);
      if (!wait) return render(reply, { step: "error", error: "Время входа истекло. Начните подключение заново." }, 400);
      const sb = anonClient();
      await sb.auth.setSession({ access_token: wait.sb.access_token, refresh_token: wait.sb.refresh_token });
      const { data, error } = await sb.auth.mfa.challengeAndVerify({ factorId: wait.factorId, code: String(body.code ?? "").trim() });
      if (error || !data) {
        return render(reply, { step: "mfa", nonce: body.mfa_nonce, params: wait.params, error: "Код не подошёл. Введите свежий код из приложения." }, 401);
      }
      mfaWaits.delete(body.mfa_nonce);
      return redirectWithCode(reply, wait.params, { profileId: wait.profileId, sb: toSb(data), expires: 0 });
    }

    // Шаг 1: телефон и пароль.
    const p = pickParams(body);
    const v = await validate(p);
    if (v.error) return render(reply, { step: "error", error: v.error }, 400);
    const back = (error: string, status = 401) =>
      render(reply, { step: "login", params: p, clientName: v.clientName, phone: body.phone, error }, status);

    let email: string;
    try {
      normalizeE164KG(body.phone);
      email = phoneToPseudoEmail(body.phone ?? "");
    } catch {
      return back("Телефон в формате +996 XXX XXX XXX", 400);
    }
    const sb = anonClient();
    const { data, error } = await sb.auth.signInWithPassword({ email, password: String(body.password ?? "") });
    if (error || !data.session) return back("Неверный телефон или пароль");

    const staff = await loadStaff(data.user.id);
    if (!staff || !MCP_ROLES.includes(staff.role)) {
      return back("Подключение доступно только директору и старшему менеджеру", 403);
    }

    const { data: factors } = await sb.auth.mfa.listFactors();
    const totp = factors?.totp?.find((f) => f.status === "verified");
    if (totp) {
      sweep();
      const nonce = randomToken();
      mfaWaits.set(nonce, { profileId: staff.id, sb: toSb(data.session), factorId: totp.id, params: p, expires: Date.now() + CODE_TTL_MS });
      return render(reply, { step: "mfa", nonce, params: p, name: staff.full_name });
    }
    return redirectWithCode(reply, p, { profileId: staff.id, sb: toSb(data.session), expires: 0 });
  });

  app.post("/oauth/token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;

    if (b.grant_type === "authorization_code") {
      sweep();
      const c = codes.get(b.code ?? "");
      codes.delete(b.code ?? "");
      if (!c) return tokenError(reply, "invalid_grant", "Код недействителен или уже использован");
      if (c.clientId !== b.client_id || c.redirectUri !== b.redirect_uri) {
        return tokenError(reply, "invalid_grant", "client_id или redirect_uri не совпадают");
      }
      if (!b.code_verifier || !pkceOk(b.code_verifier, c.challenge)) {
        return tokenError(reply, "invalid_grant", "PKCE не прошёл");
      }
      return reply.header("cache-control", "no-store").send(await issueTokens(c.profileId, c.clientId, c.sb));
    }

    if (b.grant_type === "refresh_token") {
      const { data: s } = await supabaseAdmin
        .from("mcp_sessions")
        .select("id, profile_id, client_id, refresh_expires_at, revoked_at")
        .eq("refresh_hash", sha256(b.refresh_token ?? ""))
        .maybeSingle();
      if (!s || s.revoked_at || new Date(s.refresh_expires_at) <= new Date()) {
        return tokenError(reply, "invalid_grant", "Подключение истекло или отозвано, войдите заново");
      }
      if (b.client_id && b.client_id !== s.client_id) return tokenError(reply, "invalid_grant", "Чужой refresh_token");
      const staff = await loadStaff(s.profile_id);
      if (!staff || !MCP_ROLES.includes(staff.role)) {
        await supabaseAdmin.from("mcp_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", s.id);
        return tokenError(reply, "invalid_grant", "Доступ к CRM закрыт");
      }
      // Ротация: старый refresh_token перестаёт работать.
      const out = await issueTokens(s.profile_id, s.client_id, { access_token: "", refresh_token: "", expires_at: 0 }, s.id);
      return reply.header("cache-control", "no-store").send(out);
    }

    return tokenError(reply, "unsupported_grant_type", "Поддерживаются authorization_code и refresh_token");
  });
};
