import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { authorizeGeodae } from '@/lib/geodae/route-auth'
import { runGeodaeControl } from '@/lib/geodae/cron'
import { reconcileGeodae, type ReconcileResult } from '@/lib/geodae/reconcile'

/** Budget total d'un appel (maxDuration 60 s, marge pour les écritures) */
const CALL_BUDGET_MS = 45_000

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
 * Premier appel : rapprochement complet Synchroteam ↔ Géo'DAE (point 3, rapport
 * d'anomalies), puis un lot de recherches d'identifiants. S'il reste des DAE à
 * contrôler, la route se rappelle elle-même (chaque appel dispose de son propre
 * budget de 60 s), au plus MAX_CHAIN fois ; les appels suivants ne font que des lots.
 */
export async function GET(req: NextRequest) {
  if (!isCronCall(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const chain = Math.max(0, Number(req.nextUrl.searchParams.get('chain') ?? '0') || 0)
  const started = Date.now()
  try {
    let reconcile: ReconcileResult | { error: string } | null = null
    if (chain === 0) {
      // Le rapprochement ne bloque pas les recherches : son erreur est rapportée, pas propagée
      reconcile = await reconcileGeodae({ triggeredBy: 'cron' }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
    }
    const result = await runGeodaeControl({ triggeredBy: 'cron', budgetMs: Math.max(5_000, CALL_BUDGET_MS - (Date.now() - started)) })

    // Enchaînement : seulement si ce lot a réellement avancé, pour exclure toute boucle
    const next = result.remaining > 0 && result.examined > 0 && chain < MAX_CHAIN ? chain + 1 : null
    if (next !== null) {
      waitUntil(
        fetch(`${baseUrl}/api/geodae/cron?chain=${next}`, {
          headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
        }).catch(() => undefined)
      )
    }
    return NextResponse.json({ ...result, chain, next_chain: next, reconcile })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/**
 * POST /api/geodae/cron[?action=lookups|reconcile]
 * Lancement manuel depuis la page Contrôle Géo'DAE (session administrateur ou
 * maintenance) : un seul lot de recherches (défaut) ou le rapprochement complet.
 * Pas d'enchaînement.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res
  try {
    if (req.nextUrl.searchParams.get('action') === 'reconcile') {
      return NextResponse.json(await reconcileGeodae({ triggeredBy: auth.who }))
    }
    const result = await runGeodaeControl({ triggeredBy: auth.who })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
