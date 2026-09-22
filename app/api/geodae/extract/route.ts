import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createSessionClient } from '@/lib/supabase-server'
import { createSynchroteamClient } from '@/lib/synchroteam'
import { buildAccounts } from '@/lib/sync-territory-route'
import { extractLocationDae, type AccountInput } from '@/lib/geodae/extract-synchroteam'
import { toCsv } from '@/lib/geodae/types'
import type { CustomFieldMapping, TerritoryCode } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACCOUNTS: TerritoryCode[] = ['REU', 'MYT', 'GLP']

/**
 * GET /api/geodae/extract[?format=csv]
 * Étape 1 du contrôle Géo'DAE : DAE actifs sous contrat de location, lus en
 * direct dans Synchroteam. Réservé aux rôles administrateur et maintenance
 * (même périmètre que l'entrée de menu et que le middleware).
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

  // Mapping des champs personnalisés configuré en base. S'il est inaccessible
  // (clé de service absente en local, par exemple), l'extraction retombe sur
  // l'heuristique par libellé et le signale.
  let dbMappings: CustomFieldMapping[] = []
  let warning: string | null = null
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('custom_field_mapping').select('*')
    if (error) throw new Error(error.message)
    dbMappings = (data ?? []) as CustomFieldMapping[]
    if (dbMappings.length === 0) warning = 'Table custom_field_mapping vide : mapping deviné à partir des libellés Synchroteam'
  } catch (err) {
    warning = `Mapping Supabase indisponible (${err instanceof Error ? err.message : String(err)}) : mapping deviné à partir des libellés Synchroteam`
  }

  const inputs: AccountInput[] = ACCOUNTS.map((account) => {
    const acc = buildAccounts(account)
    return { account, client: acc ? createSynchroteamClient(acc.domain, acc.key) : null }
  })

  const result = await extractLocationDae(inputs, dbMappings, warning)

  if (req.nextUrl.searchParams.get('format') === 'csv') {
    const date = result.extracted_at.split('T')[0]
    return new NextResponse(toCsv(result.rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="geodae-extraction-synchroteam-${date}.csv"`,
      },
    })
  }

  return NextResponse.json(result)
}
