// Токены MCP и шифрование сессии Supabase.
// Токены, которые получают Claude и ChatGPT, хранятся только хешами (sha256):
// утечка таблицы не даёт войти. Сессию Supabase нужно уметь прочитать,
// поэтому она зашифрована AES-256-GCM ключом из MCP_SECRET.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../lib/env.js";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");

const key = () => {
  if (!env.MCP_SECRET) throw new Error("mcp_disabled");
  return createHash("sha256").update(env.MCP_SECRET).digest();
};

export const encrypt = (plain: string): string => {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
};

export const decrypt = (enc: string): string => {
  const [iv, tag, data] = enc.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !data) throw new Error("bad_ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
};

// PKCE S256: base64url(sha256(verifier)) === challenge
export const pkceOk = (verifier: string, challenge: string) => {
  const a = Buffer.from(sha256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
};
