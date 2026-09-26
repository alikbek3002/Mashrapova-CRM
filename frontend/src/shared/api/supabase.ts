// Anon-only Supabase client. NEVER place service role key here.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Без ключей не падаем белым экраном: приложение стартует в демо-режиме
// (вход по роли без пароля, данные пустые). Запросы уходят на заглушку и
// завершаются ошибкой, которую экраны показывают как «нет данных».
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.warn(
    "[Mashrapov] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY не заданы — демо-режим без базы. " +
      "Скопируй frontend/.env.example в frontend/.env и заполни ключи."
  );
}

// Демо-режим: вместо сети отвечаем «пустой базой», чтобы экраны показывали
// «нет данных», а не ошибки соединения. Одиночная запись → null, список → [].
const demoFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  const accept = headers.get("Accept") ?? "";
  const reqUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const isObject = accept.includes("vnd.pgrst.object");
  // Имитация сети (~0,4 с), чтобы в демо было видно состояния загрузки.
  if (!reqUrl.includes("/auth/v1/")) await new Promise((r) => setTimeout(r, 400));
  const body = init?.method === "HEAD" ? null : isObject ? "null" : "[]";
  return new Response(body, {
    status: reqUrl.includes("/auth/v1/") ? 401 : 200,
    headers: { "Content-Type": "application/json", "Content-Range": "*/0" },
  });
};

export const supabase = createClient(url || "http://demo.invalid", anonKey || "demo-anon-key", {
  global: isSupabaseConfigured ? undefined : { fetch: demoFetch },
  auth: {
    persistSession: isSupabaseConfigured,
    autoRefreshToken: isSupabaseConfigured,
    detectSessionInUrl: true,
  },
});

const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

// Если фронт деплоится не на localhost, а API всё ещё указывает на localhost —
// это сборка без правильного VITE_API_URL (нужно прописать прод-URL в env Railway/Vercel).
if (
  typeof window !== "undefined" &&
  !/^localhost(:|$)|^127\.0\.0\.1(:|$)/.test(window.location.host) &&
  /localhost|127\.0\.0\.1/.test(rawApiUrl)
) {
  console.error(
    `[Mashrapov] VITE_API_URL указывает на ${rawApiUrl}, но фронт открыт на ${window.location.origin}. ` +
      "Запросы к /v1/* упадут с CORS. Пропиши боевой URL бэкенда в переменные окружения Railway/Vercel и пересобери фронт."
  );
}

export const apiUrl = rawApiUrl || "/api";
