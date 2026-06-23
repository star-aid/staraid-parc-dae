import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Client navigateur (session utilisateur) — lazy pour éviter l'erreur au build
let _browserClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!_browserClient) {
    _browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return _browserClient
}

// Alias pratique pour les Server Components qui utilisent le client browser
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

// Client serveur avec service role (sync, crons — jamais exposé côté client)
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
