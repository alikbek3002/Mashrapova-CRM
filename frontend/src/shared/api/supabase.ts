// Anon-only Supabase client. NEVER place service role key here.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
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
    `[Uniqum] VITE_API_URL указывает на ${rawApiUrl}, но фронт открыт на ${window.location.origin}. ` +
      "Запросы к /v1/* упадут с CORS. Пропиши боевой URL бэкенда в переменные окружения Railway/Vercel и пересобери фронт."
  );
}

export const apiUrl = rawApiUrl || "/api";
