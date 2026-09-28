// Autorisation commune aux routes du contrôle Géo'DAE : session Supabase
// valide et rôle administrateur ou maintenance (même périmètre que l'entrée
// de menu et que le middleware).

import { NextResponse } from 'next/server'
import { createSessionClient } from '@/lib/supabase-server'

export type GeodaeAuth =
  | { ok: true; who: string }
  | { ok: false; res: NextResponse }

export async function authorizeGeodae(): Promise<GeodaeAuth> {
  try {
    const session = await createSessionClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user) return { ok: false, res: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
    const role = user.user_metadata?.role as string | undefined
    if (role !== 'administrateur' && role !== 'maintenance') {
      return { ok: false, res: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
    }
    // Identifiant lisible pour le journal : l'e-mail sans le domaine technique
    return { ok: true, who: (user.email ?? user.id).replace('@parc-dae.local', '') }
  } catch {
    return { ok: false, res: NextResponse.json({ error: 'Erreur auth' }, { status: 401 }) }
  }
}
