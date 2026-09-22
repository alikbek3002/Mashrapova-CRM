// Wrapper for protected backend mutations (Railway).
// Adds the Supabase JWT and an Idempotency-Key automatically.

import { supabase, apiUrl } from "./supabase";

const newKey = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // RFC4122 v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const apiGet = async <T>(path: string): Promise<T> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const res = await fetch(`${apiUrl}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`API ${res.status}: ${JSON.stringify(detail)}`);
  }
  return res.json() as Promise<T>;
};

export const apiPost = async <T>(
  path: string,
  body: unknown,
  opts: { idempotent?: boolean } = {}
): Promise<T> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (opts.idempotent) headers["Idempotency-Key"] = newKey();

  const res = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`API ${res.status}: ${JSON.stringify(detail)}`);
  }

  return res.json() as Promise<T>;
};

export const apiPatch = async <T>(path: string, body: unknown): Promise<T> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const res = await fetch(`${apiUrl}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`API ${res.status}: ${JSON.stringify(detail)}`);
  }
  return res.json() as Promise<T>;
};

export const apiPut = async <T>(path: string, body: unknown): Promise<T> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const res = await fetch(`${apiUrl}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`API ${res.status}: ${JSON.stringify(detail)}`);
  }
  return res.json() as Promise<T>;
};

export const apiDelete = async <T>(path: string): Promise<T> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const res = await fetch(`${apiUrl}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`API ${res.status}: ${JSON.stringify(detail)}`);
  }
  return res.json() as Promise<T>;
};
