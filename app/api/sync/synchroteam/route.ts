import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createSynchroteamClient } from '@/lib/synchroteam'
import { runSynchroteamSync } from '@/lib/sync-synchroteam'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const startedAt = new Date().toISOString()

  const { data: logEntry } = await supabase
    .from('sync_logs')
    .insert({ source: 'synchroteam', status: 'running', started_at: startedAt })
    .select('id')
    .single()

  const logId: string | null = logEntry?.id ?? null

  try {
    // Construction de la liste des comptes Synchroteam configurés
    // REU : variables sans suffixe (compte principal, IDs sans préfixe pour compatibilité)
    // GLP / MYT : variables suffixées, IDs préfixés pour éviter les collisions
    const accounts: Array<{
      client: ReturnType<typeof createSynchroteamClient>
      idPrefix: string
      forcedTerritoryCode: string | null
    }> = []

    if (process.env.SYNCHROTEAM_DOMAIN && process.env.SYNCHROTEAM_API_KEY) {
      accounts.push({
        client: createSynchroteamClient(
          process.env.SYNCHROTEAM_DOMAIN,
          process.env.SYNCHROTEAM_API_KEY
        ),
        idPrefix: '',       // REU : pas de préfixe (données historiques)
        forcedTerritoryCode: null, // détection via zone_géographique
      })
    }

    if (process.env.SYNCHROTEAM_DOMAIN_GLP && process.env.SYNCHROTEAM_API_KEY_GLP) {
      accounts.push({
        client: createSynchroteamClient(
          process.env.SYNCHROTEAM_DOMAIN_GLP,
          process.env.SYNCHROTEAM_API_KEY_GLP
        ),
        idPrefix: 'GLP_',
        forcedTerritoryCode: 'GLP',
      })
    }

    if (process.env.SYNCHROTEAM_DOMAIN_MYT && process.env.SYNCHROTEAM_API_KEY_MYT) {
      accounts.push({
        client: createSynchroteamClient(
          process.env.SYNCHROTEAM_DOMAIN_MYT,
          process.env.SYNCHROTEAM_API_KEY_MYT
        ),
        idPrefix: 'MYT_',
        forcedTerritoryCode: 'MYT',
      })
    }

    if (accounts.length === 0) {
      return NextResponse.json({ error: 'Aucun compte Synchroteam configuré' }, { status: 500 })
    }

    const result = await runSynchroteamSync(supabase, accounts)

    const totalSynced =
      result.clients + result.sites + result.technicians +
      result.equipments + result.interventions

    const finalStatus = result.errors.length > 0 ? 'error' : 'success'

    if (logId) {
      await supabase
        .from('sync_logs')
        .update({
          status: finalStatus,
          records_synced: totalSynced,
          error_message: result.errors.length > 0 ? result.errors.join('\n') : null,
          finished_at: new Date().toISOString(),
        })
        .eq('id', logId)
    }

    return NextResponse.json({ status: finalStatus, result, synced: totalSynced, accounts: accounts.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (logId) {
      await supabase
        .from('sync_logs')
        .update({ status: 'error', error_message: message, finished_at: new Date().toISOString() })
        .eq('id', logId)
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
