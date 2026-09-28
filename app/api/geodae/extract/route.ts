import { NextRequest, NextResponse } from 'next/server'
import { authorizeGeodae } from '@/lib/geodae/route-auth'
import { loadDbMappings } from '@/lib/geodae/mappings'
import { createSynchroteamClient } from '@/lib/synchroteam'
import { buildAccounts } from '@/lib/sync-territory-route'
import { extractLocationDae, type AccountInput } from '@/lib/geodae/extract-synchroteam'
import { extractLocationDaeFromDb } from '@/lib/geodae/extract-supabase'
import { toCsv, type ExtractionResult } from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACCOUNTS: TerritoryCode[] = ['REU', 'MYT', 'GLP']

/**
 * GET /api/geodae/extract[?source=supabase|synchroteam][&format=csv]
 * DAE actifs sous contrat de location, avec identifiant Synchroteam, n° de série
 * et identifiant Géo'DAE (étape 1 du contrôle).
 *  - source=supabase (défaut) : copie synchronisée chaque matin, réponse immédiate ;
 *  - source=synchroteam : lecture directe des comptes Synchroteam (jusqu'à une
 *    minute), conservée pour les diagnostics et les scripts.
 * Réservé aux rôles administrateur et maintenance (même périmètre que le menu).
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res

  const source = req.nextUrl.searchParams.get('source') === 'synchroteam' ? 'synchroteam' : 'supabase'

  let result: ExtractionResult
  try {
    if (source === 'synchroteam') {
      const { mappings, warning } = await loadDbMappings()
      const inputs: AccountInput[] = ACCOUNTS.map((account) => {
        const acc = buildAccounts(account)
        return { account, client: acc ? createSynchroteamClient(acc.domain, acc.key) : null }
      })
      result = { ...(await extractLocationDae(inputs, mappings, warning)), source: 'synchroteam' }
    } else {
      result = await extractLocationDaeFromDb()
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  if (req.nextUrl.searchParams.get('format') === 'csv') {
    const date = result.extracted_at.split('T')[0]
    return new NextResponse(toCsv(result.rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="geodae-extraction-${source}-${date}.csv"`,
      },
    })
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
