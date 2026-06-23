import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Retourne le statut d'une synchronisation en cours ou terminée
export async function GET(req: NextRequest) {
  const logId = req.nextUrl.searchParams.get('id')
  if (!logId) {
    return NextResponse.json({ error: 'Paramètre id manquant' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('sync_logs')
    .select('status, records_synced, error_message, started_at, finished_at')
    .eq('id', logId)
    .single()

  if (error || !data) {
    return NextResponse.json({ status: 'unknown' })
  }

  return NextResponse.json(data)
}
