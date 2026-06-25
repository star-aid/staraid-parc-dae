// Fichier serveur uniquement — ne jamais importer depuis un composant 'use client'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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
