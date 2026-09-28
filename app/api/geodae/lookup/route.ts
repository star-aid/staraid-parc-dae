import { NextRequest, NextResponse } from 'next/server'
import { createSessionClient } from '@/lib/supabase-server'
import { lookupGidBySerial } from '@/lib/geodae/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/geodae/lookup?serial=X25L970153
 * Étape 2 du contrôle Géo'DAE : retrouve l'identifiant Géo'DAE (gid) d'un DAE à
 * partir de son numéro de série. Lecture seule. Réservé aux rôles administrateur
 * et maintenance, comme la page.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await createSessionClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const role = user.user_metadata?.role as string | undefined
    if (role !== 'administrateur' && role !== 'maintenance') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Erreur auth' }, { status: 401 })
  }

  const serial = (req.nextUrl.searchParams.get('serial') ?? '').trim()
  if (serial.length < 4 || serial.length > 64) {
    return NextResponse.json({ error: 'Paramètre serial manquant ou invalide (4 à 64 caractères)' }, { status: 400 })
  }

  try {
    const result = await lookupGidBySerial(serial)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
