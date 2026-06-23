import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { runSynchroteamSync } from '@/lib/sync-synchroteam'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const startedAt = new Date().toISOString()

  // Créer l'entrée de log avec statut 'running'
  const { data: logEntry } = await supabase
    .from('sync_logs')
    .insert({ source: 'synchroteam', status: 'running', started_at: startedAt })
    .select('id')
    .single()

  const logId: string | null = logEntry?.id ?? null

  try {
    const result = await runSynchroteamSync(supabase)

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

    return NextResponse.json({ status: finalStatus, result, synced: totalSynced })
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
