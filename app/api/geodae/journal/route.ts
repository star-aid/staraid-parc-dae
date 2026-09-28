import { NextRequest, NextResponse } from 'next/server'
import { authorizeGeodae } from '@/lib/geodae/route-auth'
import { getJournalSummary, recordLookupRun } from '@/lib/geodae/journal'
import type { JournalItem } from '@/lib/geodae/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** GET /api/geodae/journal : dernières exécutions, anomalies ouvertes et reports. */
export async function GET() {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res
  try {
    return NextResponse.json(await getJournalSummary(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/**
 * POST /api/geodae/journal
 * Corps : { items: JournalItem[], scope?: string, createRun?: boolean }
 * Enregistre le résultat de recherches d'identifiant : ouvre ou rouvre les
 * anomalies (introuvable, ambigu, erreur) et clôt celles des DAE retrouvés.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res

  let body: { items?: JournalItem[]; scope?: string; createRun?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const items = Array.isArray(body.items) ? body.items : []
  if (items.length === 0 || items.length > 2000) {
    return NextResponse.json({ error: 'items : entre 1 et 2000 éléments attendus' }, { status: 400 })
  }
  const valid = items.every((i) =>
    i && typeof i.synchroteam_id === 'string' && ['REU', 'MYT', 'GLP'].includes(i.account) &&
    ['found', 'ambiguous', 'not_found', 'error'].includes(i.outcome) && Array.isArray(i.candidates)
  )
  if (!valid) return NextResponse.json({ error: 'items : format invalide' }, { status: 400 })

  try {
    const result = await recordLookupRun({
      items,
      triggeredBy: auth.who,
      scope: typeof body.scope === 'string' ? body.scope.slice(0, 200) : null,
      createRun: body.createRun === true,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
