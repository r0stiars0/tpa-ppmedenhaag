import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'TPA PPME Den Haag',
        short_name: 'TPA PPME',
        description: "PPME Den Haag TPA — pelacakan kehadiran, tugas, dan progres Yanbu'a/Al-Quran/Murajaah",
        theme_color: '#0D50A0',
        background_color: '#F8F9FA',
        display: 'standalone',
        start_url: '/',
        // `id`, not vite-plugin-pwa's default of `en`. This is the
        // language the OS labels the installed app in, and it was the
        // one place claiming English — `index.html` says `id` and
        // i18n's `fallbackLng` is `id`. It matters more than it looks
        // once the app is installed: an Android WebAPK takes its name,
        // icon and language from this manifest, and that WebAPK is what
        // makes a notification read "TPA PPME Den Haag" instead of
        // "Chrome" in the notification shade.
        lang: 'id',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Web Push handlers, pulled into the generated service worker
        // rather than switching to `injectManifest` — that strategy
        // would hand us the whole precache manifest to maintain by hand
        // just to add two event listeners (TAD ADR-015).
        importScripts: ['/push-sw.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
})
