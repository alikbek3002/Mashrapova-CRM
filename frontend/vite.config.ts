import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "logo.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Академия Машрапова",
        short_name: "Машрапов",
        description: "ERP-система зала единоборств «Академия Машрапова»",
        theme_color: "#0D0B0B",
        background_color: "#0D0B0B",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Новый SW сразу активируется и забирает открытые вкладки —
        // в паре с controllerchange-reload в main.tsx это даёт
        // автообновление приложения без Ctrl+Shift+R у менеджеров.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "supabase-storage",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
});
