/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** VAPID public key — the browser needs it to subscribe to Web Push. */
  readonly VITE_VAPID_PUBLIC_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
