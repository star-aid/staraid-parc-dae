import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { authorizeGeodae } from '@/lib/geodae/route-auth'
import { runGeodaeControl } from '@/lib/geodae/cron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Nombre maximal d'exécutions enchaînées par déclenchement du cron (≈ 300 DAE) */
const MAX_CHAIN = 10

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://staraid-parc-dae.vercel.app'

/** Appel planifié : secret dans x-cron-secret (appel interne) ou Authorization: Bearer (cron Vercel) */
function isCronCall(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('x-cron-secret') === secret || req.headers.get('authorization') === `Bearer ${secret}`
}

/**
 * GET /api/geodae/cron[?chain=n]
 * Contrôle automatique Géo'DAE, planifié dans vercel.json après la synchronisation.
 * Traite un lot puis, s'il reste des DAE à contrôler, se rappelle lui-même
 * (chaque appel dispose de son propre budget de 60 s), au plus MAX_CHAIN fois.
 */
export async function GET(req: NextRequest) {
  if (!isCronCall(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const chain = Math.max(0, Number(req.nextUrl.searchParams.get('chain') ?? '0') || 0)
  try {
    const result = await runGeodaeControl({ triggeredBy: 'cron' })

    // Enchaînement : seulement si ce lot a réellement avancé, pour exclure toute boucle
    const next = result.remaining > 0 && result.examined > 0 && chain < MAX_CHAIN ? chain + 1 : null
    if (next !== null) {
      waitUntil(
        fetch(`${baseUrl}/api/geodae/cron?chain=${next}`, {
          headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
        }).catch(() => undefined)
      )
    }
    return NextResponse.json({ ...result, chain, next_chain: next })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/**
 * POST /api/geodae/cron
 * Lancement manuel d'un seul lot depuis la page Contrôle Géo'DAE (session
 * administrateur ou maintenance). Pas d'enchaînement.
 */
export async function POST() {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res
  try {
    const result = await runGeodaeControl({ triggeredBy: auth.who })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
