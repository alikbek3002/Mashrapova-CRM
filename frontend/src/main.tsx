import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Самолечение от stale-chunk после деплоя.
// После каждого деплоя у бандлов меняется хеш в имени файла. Если у
// пользователя кэширован старый index.html (через Service Worker или
// просто через ОБЫЧНЫЙ браузерный кэш), он пытается подгрузить старый
// чанк, которого на сервере уже нет. Railway/Vercel при таком 404 для
// SPA возвращают index.html → MIME mismatch → весь экран падает.
//
// Vite 5+ кидает событие `vite:preloadError` на window. Ловим, очищаем
// кэши SW (если они есть) и делаем жёсткую перезагрузку — фронт получит
// свежий index.html с актуальными хешами.
let reloadLock = false;
const recoverFromStaleChunk = (reason: string) => {
  if (reloadLock) return;
  reloadLock = true;
  // eslint-disable-next-line no-console
  console.warn("[uq] stale chunk detected, reloading:", reason);
  Promise.resolve()
    .then(() => {
      if ("caches" in window) {
        return caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
      }
    })
    .then(() => {
      if ("serviceWorker" in navigator) {
        return navigator.serviceWorker.getRegistrations()
          .then((regs) => Promise.all(regs.map((r) => r.unregister())));
      }
    })
    .finally(() => {
      // Перезагружаемся жёстко (bypass cache).
      window.location.reload();
    });
};

window.addEventListener("vite:preloadError", (e: Event) => {
  const msg = (e as unknown as { message?: string }).message ?? "preloadError";
  recoverFromStaleChunk(msg);
});
// Fallback: ловим любые незахваченные ошибки динамических импортов.
window.addEventListener("error", (e) => {
  const msg = e?.message ?? "";
  if (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("MIME type") ||
    msg.includes("module script")
  ) {
    recoverFromStaleChunk(msg);
  }
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = String(e.reason ?? "");
  if (
    reason.includes("Failed to fetch dynamically imported module") ||
    reason.includes("ChunkLoadError")
  ) {
    recoverFromStaleChunk(reason);
  }
});

// Автоприменение новой версии после деплоя. SW собран со skipWaiting +
// clientsClaim: свежий воркер перехватывает страницу через пару секунд
// после открытия — ловим смену контроллера и перезагружаемся один раз.
// Без этого менеджеры сидели на старом бандле, пока не нажмут Ctrl+Shift+R.
if ("serviceWorker" in navigator) {
  // При самой первой установке SW (контроллера не было) не перезагружаем —
  // иначе каждый новый посетитель получал бы лишний рефреш.
  const hadController = !!navigator.serviceWorker.controller;
  let refreshed = false;
  // Жалоба тренеров 2026-09-11 («по отметке вылетает сайт»): новая версия
  // приезжала через пару секунд после открытия PWA и страница перезагружалась
  // прямо во время отметки. Теперь перезагружаемся только когда человек
  // не трогал экран ≥ 45 с, либо когда приложение ушло в фон.
  const IDLE_MS = 45_000;
  let lastTouch = Date.now();
  for (const ev of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true });
  }
  let pendingReload = false;
  const tryReload = () => {
    if (!pendingReload || refreshed || reloadLock) return;
    if (document.visibilityState === "hidden" || Date.now() - lastTouch >= IDLE_MS) {
      refreshed = true;
      window.location.reload();
    }
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshed || reloadLock) return;
    pendingReload = true;
    tryReload();
    if (!refreshed) setInterval(tryReload, 5_000);
  });
  document.addEventListener("visibilitychange", tryReload);
  // Вкладка, открытая весь день, проверяет новую версию раз в час — и
  // каждый раз, когда PWA возвращается на экран (офис держит приложение
  // открытым сутками и после деплоя ещё долго видит старую версию).
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;
    const check = () => reg.update().catch(() => {});
    check();
    setInterval(check, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
