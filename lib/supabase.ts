import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

export type UserRole = 'administrateur' | 'maintenance' | 'direction'

// ── Client navigateur (composants client) ─────────────────────────────────────
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Alias rétrocompatibilité
export const getSupabaseClient = getSupabaseBrowserClient

// ── Client serveur avec service role (sync, crons — jamais exposé côté client)
// global.fetch avec cache:'no-store' court-circuite le Data Cache Next.js
export function createServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (url, opts) => fetch(url, { ...opts, cache: 'no-store' }) },
    }
  )
}
