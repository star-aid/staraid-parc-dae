import { NextRequest, NextResponse } from 'next/server'
import { authorizeGeodae } from '@/lib/geodae/route-auth'
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
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res

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
