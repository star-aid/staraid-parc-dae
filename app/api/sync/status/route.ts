import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/sync/status?id=<logId>        → statut d'une sync par logId
// GET /api/sync/status?territories=1     → derniers statuts REU/MYT/GLP
export async function GET(req: NextRequest) {
  const supabase = createServiceClient()

  if (req.nextUrl.searchParams.get('territories')) {
    const sources = ['synchroteam_reu', 'synchroteam_myt', 'synchroteam_glp']
    const results = await Promise.all(
      sources.map((source) =>
        supabase
          .from('sync_logs')
          .select('source, status, records_synced, started_at, finished_at')
          .eq('source', source)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    )
    const data = Object.fromEntries(
      sources.map((source, i) => {
        const row = results[i].data
        return [
          source.replace('synchroteam_', ''),
          row ? { status: row.status, records_synced: row.records_synced, finished_at: row.finished_at } : null,
        ]
      })
    )
    return NextResponse.json(data)
  }

  const logId = req.nextUrl.searchParams.get('id')
  if (!logId) return NextResponse.json({ error: 'Paramètre id ou territories manquant' }, { status: 400 })

  const { data, error } = await supabase
    .from('sync_logs')
    .select('status, records_synced, error_message, started_at, finished_at')
    .eq('id', logId)
    .single()

  if (error || !data) return NextResponse.json({ status: 'unknown' })
  return NextResponse.json(data)
}
