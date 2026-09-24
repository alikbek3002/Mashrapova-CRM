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

export const supabase = createClient(url || "http://127.0.0.1:54321", anonKey || "demo-anon-key", {
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
