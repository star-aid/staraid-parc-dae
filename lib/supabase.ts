import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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

// ── Client serveur avec session utilisateur (Server Components, layouts) ──────
export async function createSessionClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => { /* lecture seule dans les Server Components */ },
      },
    }
  )
}

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
