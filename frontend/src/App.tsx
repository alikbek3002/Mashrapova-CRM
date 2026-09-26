import { useEffect, useState, lazy, Suspense } from "react";
import type { ComponentType } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { I18N, BrandLogo } from "./data";
import type { Lang } from "./data";
import { AuthProvider, useAuth } from "./shared/auth/AuthProvider";
import { Login } from "./shared/auth/Login";
import { MfaGate } from "./shared/auth/MfaGate";
// Офлайн-режим (ТЗ §12.4): очередь отложенных операций и её индикатор.
import { startOutbox } from "./shared/offline/outbox";
import { registerOutboxHandlers } from "./shared/offline/ops";
import { OfflineBar } from "./shared/offline/OfflineBar";
import { ToastHost } from "./shared/ui/toast";
import { Sk, SkeletonPage } from "./shared/ui/Skeleton";

// Code-splitting по роли: каждый persona-экран — отдельный чанк. Тренер/родитель
// на телефоне не грузят весь админский код (формы, отчёты, payroll и т.д.).
//
// Все lazy-чанки оборачиваем в retry: при первом фейле (например, после
// деплоя у старого SW не оказалось нового чанка) делаем повторный import,
// если опять фейл — кидаем ошибку дальше, её ловит main.tsx и форсит
// hard reload с очисткой кэшей.
const lazyWithRetry = <T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
) => lazy(() =>
  loader().catch(async (err) => {
    await new Promise((r) => setTimeout(r, 400));
    return loader().catch((e2) => {
      // Если retry тоже упал — выкидываем, main.tsx подхватит и
      // перезагрузит страницу.
      throw e2 ?? err;
    });
  }),
);

const AdminDashboard = lazyWithRetry(() =>
  import("./AdminDashboard").then((m) => ({ default: m.AdminDashboard }))
);
const CoachScreen = lazyWithRetry(() =>
  import("./CoachScreen").then((m) => ({ default: m.CoachScreen }))
);
const ParentScreen = lazyWithRetry(() =>
  import("./ParentScreen").then((m) => ({ default: m.ParentScreen }))
);

// Сетевой бэк (Supabase) сидит в Sydney; пользователи — в Бишкеке.
// RTT ~250–400мс, и каждый пустой re-fetch стоит этих миллисекунд.
// Решение: персистим кэш React Query в localStorage. На втором заходе
// (рефреш, переоткрытие PWA) экран рисуется мгновенно из stale-кэша,
// а свежие данные тихо подтягиваются фоном.
//
// Если меняешь форму данных в queries.ts (типы, ключи), бамп BUSTER —
// иначе пользователи прочитают «древний» кэш и упадут на runtime.
const QUERY_CACHE_BUSTER = "v1";
const QUERY_CACHE_MAX_AGE = 24 * 60 * 60_000; // 24h

// JSON.stringify теряет Map/Set. У нас табели (coach_tabel, group_tabel)
// и balance-map возвращают Map<…> — без поддержки они после рестора
// были бы `{}`, и компоненты падали на `.get()`. Поэтому кастомный
// сериализатор с маркером типа.
const serialize = (data: unknown) =>
  JSON.stringify(data, (_k, v) => {
    if (v instanceof Map) return { __t: "Map", v: Array.from(v.entries()) };
    if (v instanceof Set) return { __t: "Set", v: Array.from(v.values()) };
    return v;
  });
const deserialize = (s: string) =>
  JSON.parse(s, (_k, v) => {
    if (v && typeof v === "object" && (v as any).__t === "Map") return new Map((v as any).v);
    if (v && typeof v === "object" && (v as any).__t === "Set") return new Set((v as any).v);
    return v;
  });

const persister = createAsyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: "uq-query-cache",
  throttleTime: 1000,
  serialize,
  deserialize,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Поднято с 30с до 60с: переключение вкладок внутри роли больше
      // не триггерит новый round-trip, если данные ещё «свежие».
      staleTime: 60_000,
      // 24h — чтобы persister успевал сохранять. По дефолту 5 мин,
      // и кэш бы GC'нулся раньше, чем мы успеем его записать.
      gcTime: QUERY_CACHE_MAX_AGE,
    },
  },
});

const readLang = (): Lang => {
  try {
    const v = localStorage.getItem("uq_lang");
    return v === "ky" ? "ky" : "ru";
  } catch {
    return "ru";
  }
};

const Shell = () => {
  const { user, loading, profileError, signOut } = useAuth();
  const [lang, setLang] = useState<Lang>(readLang);

  useEffect(() => {
    try {
      localStorage.setItem("uq_lang", lang);
    } catch {}
  }, [lang]);
  // Язык документа читают общие компоненты (календарь DateInput) — ставим
  // до отрисовки детей, чтобы при переключении не было кадра со старым языком.
  if (typeof document !== "undefined" && document.documentElement.lang !== lang) {
    document.documentElement.lang = lang;
  }

  // Офлайн-очередь (ТЗ §12.4): регистрируем обработчики и запускаем
  // автоотправку. Должно случиться один раз и до любых early-return —
  // иначе число хуков меняется между рендерами (React error #310).
  useEffect(() => {
    registerOutboxHandlers();
    startOutbox();
  }, []);

  // Ставим класс на body для CSS-правил «PWA-режим» (тренер/родитель).
  // ВАЖНО: useEffect должен быть до любых early-return — иначе число
  // хуков меняется между рендерами и React падает с error #310.
  const isPwaRole = user?.role === "coach" || user?.role === "parent";
  useEffect(() => {
    document.body.classList.toggle("is-pwa-role", isPwaRole);
    return () => { document.body.classList.remove("is-pwa-role"); };
  }, [isPwaRole]);

  // Префетч горячих запросов сразу после логина — пока React раскручивает
  // lazy-чанк роли, мы параллельно дёргаем критичную для первого экрана
  // выдачу. К моменту монтажа компонента данные уже в кэше.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("./shared/api/supabase");
        if (cancelled) return;
        if (user.role === "parent") {
          // ParentScreen стартует с useMyChildren. queryFn простой —
          // дублируем, чтобы дёрнуть параллельно с lazy-чанком.
          queryClient.prefetchQuery({
            queryKey: ["my_children", user.id],
            queryFn: async () => {
              const { data, error } = await supabase
                .from("children")
                .select("id, full_name, birth_date, status, responsible_manager_id, family_id")
                .is("deleted_at", null);
              if (error) throw error;
              return data ?? [];
            },
          });
        }
        // Для coach/admin queryFn'ы тяжёлые (табель, агрегации) — не дублируем
        // их сюда. Персист-кэш отдаст stale-данные мгновенно при втором заходе,
        // а первый заход всё равно требует round-trip — оптимизация не нужна.
      } catch {
        // молча — префетч не должен ронять логин
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  // Проверка сессии: скелетон интерфейса вместо надписи «Загрузка…».
  if (loading) {
    return (
      <div className="cards-bordered">
        <div className="app-chrome">
          <div className="app-chrome__inner">
            <div className="crm-logo">
              <img className="crm-logo__img" src="/logo.png" alt="Академия Машрапова" />
            </div>
            <Sk w={180} h={36} r={999} style={{ opacity: 0.15 }} />
          </div>
        </div>
        <SkeletonPage />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {profileError && (
          <div
            style={{
              position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)",
              zIndex: 100, background: "var(--red-50)", color: "var(--red-600)",
              border: "1px solid var(--red-100)", padding: "10px 16px",
              borderRadius: "var(--r-md)", fontSize: 13, maxWidth: 480, textAlign: "center",
              boxShadow: "var(--sh-1)",
            }}
          >
            {lang === "ru" ? "Не удалось загрузить профиль:" : "Профиль жүктөлгөн жок:"} {profileError}
          </div>
        )}
        <Login lang={lang} setLang={setLang} />
      </>
    );
  }

  const roleLabel = (I18N[lang].roles as Record<string, string>)[user.role] ?? user.role;
  const isAdminLike =
    user.role === "director" ||
    user.role === "fitness_director" ||
    user.role === "senior_manager" ||
    user.role === "manager" ||
    user.role === "cashier";

  return (
    // ТЗ §12.3: между входом и приложением — второй фактор. Директора и
    // управляющего он не пускает дальше, пока тот не настроен.
    <MfaGate lang={lang}>
    <div className="cards-bordered">
      <div className={`app-chrome ${isPwaRole ? "app-chrome--pwa" : ""}`}>
        <div className="app-chrome__inner">
          <div className="crm-logo">
            <img className="crm-logo__img" src="/logo.png" alt="Академия Машрапова" />
            MASHRAPOVA
          </div>

          <div className="user-chip">
            <div className="user-chip__avatar">
              {user.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="user-chip__meta">
              <div className="user-chip__name">{user.full_name}</div>
              <div className="user-chip__role">{roleLabel}</div>
            </div>
            <button className="user-chip__logout" onClick={() => signOut()} title={lang === "ru" ? "Выйти" : "Чыгуу"}>
              {lang === "ru" ? "Выйти" : "Чыгуу"}
            </button>
          </div>

          <div className="lang-switch">
            {(["ru", "ky"] as const).map((l) => (
              <button
                key={l}
                className={`lang-switch__btn ${lang === l ? "is-active" : ""}`}
                onClick={() => setLang(l)}
              >
                {l === "ru" ? "RU" : "КЫ"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Suspense
        fallback={<SkeletonPage mobile={isPwaRole} />}
      >
        {isAdminLike && <AdminDashboard lang={lang} />}
        {user.role === "coach" && <CoachScreen lang={lang} />}
        {user.role === "parent" && <ParentScreen lang={lang} />}
      </Suspense>
    </div>
    <OfflineBar lang={lang} />
    </MfaGate>
  );
};

export default function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: QUERY_CACHE_MAX_AGE,
        buster: QUERY_CACHE_BUSTER,
      }}
    >
      <AuthProvider>
        <Shell />
        <ToastHost />
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
