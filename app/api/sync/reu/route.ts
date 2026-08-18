import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase'
import { createSynchroteamClient } from '@/lib/synchroteam'
import { syncTerritory, buildAccounts, claimSyncSlot } from '@/lib/sync-territory-route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-cron-secret') === process.env.CRON_SECRET) return true
  if (req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`) return true
  return false
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const acc = buildAccounts('REU')
  if (!acc) return NextResponse.json({ error: 'SYNCHROTEAM_DOMAIN / API_KEY non configurés' }, { status: 500 })

  const supabase = createServiceClient()
  const slot = await claimSyncSlot(supabase, 'synchroteam_reu')
  if (!slot.claimed) {
    return NextResponse.json({
      status: 'already_running',
      territory: 'REU',
      message: `Une synchronisation REU est déjà en cours depuis ${slot.alreadyRunningSince}`,
    }, { status: 409 })
  }
  const logId = slot.logId

  // waitUntil : la sync continue après la réponse HTTP — contourne la limite 60s du cron Vercel
  waitUntil(
    syncTerritory(
      supabase,
      createSynchroteamClient(acc.domain, acc.key),
      acc.idPrefix,
      acc.forcedTerritoryCode
    ).then(async (result) => {
      if (logId) {
        await supabase.from('sync_logs').update({
          status: result.status,
          records_synced: result.clients + result.sites + result.equipments + result.interventions,
          error_message: result.errors.length > 0 ? result.errors.slice(0, 10).join('\n') : null,
          finished_at: new Date().toISOString(),
        }).eq('id', logId)
      }
    })
  )

  return NextResponse.json({ status: 'started', logId, territory: 'REU' })
}

export const GET = handle
export const POST = handle
