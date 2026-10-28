// Общее для инструментов MCP: от чьего имени работаем, как читать и как
// писать. Чтение — клиентом Supabase с JWT человека (действует RLS).
// Запись — внутренним вызовом тех же маршрутов /v1/*, что у интерфейса
// (app.inject): те же requireRole, zod-схемы, идемпотентность и RPC.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { supabaseFromToken } from "../lib/supabase.js";
import type { McpUser } from "./session.js";

export type Ctx = {
  user: McpUser;
  db: SupabaseClient;
  api: <T = unknown>(method: "POST" | "PATCH", url: string, body: unknown, opts?: { idempotent?: boolean }) => Promise<T>;
};

export class ToolError extends Error {}

export const makeCtx = (app: FastifyInstance, user: McpUser): Ctx => ({
  user,
  db: supabaseFromToken(user.jwt),
  api: async (method, url, body, opts) => {
    const res = await app.inject({
      method,
      url,
      payload: body as object,
      headers: {
        authorization: `Bearer ${user.jwt}`,
        "content-type": "application/json",
        ...(opts?.idempotent ? { "idempotency-key": randomUUID() } : {}),
      },
    });
    const json = res.body ? JSON.parse(res.body) : null;
    if (res.statusCode >= 400) {
      const msg = json?.message ?? json?.error ?? `HTTP ${res.statusCode}`;
      const extra = json?.details ?? json?.issues;
      const details = extra ? ` (${JSON.stringify(extra)})` : "";
      throw new ToolError(`${msg}${details}`);
    }
    return json;
  },
});

// Ответ инструмента: короткое резюме для человека + данные JSON.
export const ok = (summary: string, data?: unknown): CallToolResult => ({
  content: [
    { type: "text", text: data === undefined ? summary : `${summary}\n\n${JSON.stringify(data, null, 1)}` },
  ],
});

export const fail = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});

// Ошибка PostgREST → понятное сообщение.
export const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new ToolError(r.error.message);
  return r.data as T;
};

export const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bishkek" });
export const monthStart = () => `${today().slice(0, 8)}01`;

export const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

export const addMonthsIso = (iso: string, n: number): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
};

export const addDaysIso = (iso: string, n: number): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const dow = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

// Первая дата с занятием по расписанию, начиная с from (включительно).
export const firstLessonOnOrAfter = (from: string, schedule: { day_of_week: number }[]): string | null => {
  if (schedule.length === 0) return null;
  let cur = from;
  for (let i = 0; i < 14; i++) {
    if (schedule.some((s) => s.day_of_week === dow(cur))) return cur;
    cur = addDaysIso(cur, 1);
  }
  return null;
};

// Дата N-го занятия от start (как frontend/src/shared/lib/enrollmentWindow.ts).
export const nthLessonDate = (start: string, count: number, schedule: { day_of_week: number }[]): string | null => {
  if (count <= 0 || schedule.length === 0) return null;
  let seen = 0;
  let cur = start;
  for (let i = 0; i < 732; i++) {
    seen += schedule.filter((s) => s.day_of_week === dow(cur)).length;
    if (seen >= count) return cur;
    cur = addDaysIso(cur, 1);
  }
  return null;
};
