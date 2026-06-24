import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createSynchroteamClient } from '@/lib/synchroteam'
import { syncTerritory, buildAccounts } from '@/lib/sync-territory-route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-cron-secret') === process.env.CRON_SECRET) return true
  if (req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`) return true
  return false
}

// Sync GLP puis MYT enchaînés — ces territoires ont peu d'appareils et tiennent dans 60s
async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const results = []

  for (const territory of ['GLP', 'MYT'] as const) {
    const acc = buildAccounts(territory)
    if (!acc) {
      results.push({ territory, skipped: true, reason: 'Non configuré' })
      continue
    }

    const { data: logEntry } = await supabase
      .from('sync_logs')
      .insert({ source: `synchroteam_${territory.toLowerCase()}`, status: 'running', started_at: new Date().toISOString() })
      .select('id').single()
    const logId = logEntry?.id ?? null

    const result = await syncTerritory(
      supabase,
      createSynchroteamClient(acc.domain, acc.key),
      acc.idPrefix,
      acc.forcedTerritoryCode
    )

    if (logId) {
      await supabase.from('sync_logs').update({
        status: result.status,
        records_synced: result.clients + result.sites + result.equipments + result.interventions,
        error_message: result.errors.length > 0 ? result.errors.slice(0, 10).join('\n') : null,
        finished_at: new Date().toISOString(),
      }).eq('id', logId)
    }

    results.push(result)
  }

  return NextResponse.json({ results })
}

export const GET = handle
export const POST = handle
