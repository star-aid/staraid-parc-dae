import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TERRITORY_ROUTES = [
  { path: '/api/sync/reu', label: 'La Réunion' },
  { path: '/api/sync/glp', label: 'Guadeloupe' },
  { path: '/api/sync/myt', label: 'Mayotte' },
]

export async function GET() {
  const supabase = createServiceClient()

  const { data: logEntry } = await supabase
    .from('sync_logs')
    .insert({ source: 'synchroteam_trigger', status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single()
  const logId: string | null = logEntry?.id ?? null

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://staraid-parc-dae.vercel.app'
  const secret = process.env.CRON_SECRET ?? ''

  waitUntil(
    (async () => {
      let totalSynced = 0
      const allErrors: string[] = []

      for (const { path, label } of TERRITORY_ROUTES) {
        try {
          const res = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { 'x-cron-secret': secret },
          })
          if (!res.ok) {
            allErrors.push(`[${label}] HTTP ${res.status}`)
            continue
          }
          const body = await res.json() as {
            equipments?: number; clients?: number; sites?: number; interventions?: number; errors?: string[]
          }
          totalSynced += (body.equipments ?? 0) + (body.clients ?? 0) + (body.sites ?? 0) + (body.interventions ?? 0)
          if (body.errors?.length) allErrors.push(...body.errors.map((e) => `[${label}] ${e}`))
        } catch (err) {
          allErrors.push(`[${label}] ${String(err)}`)
        }
      }

      const finalStatus = allErrors.length > 0
        ? (totalSynced > 0 ? 'partial' : 'error')
        : 'success'

      if (logId) {
        await supabase.from('sync_logs').update({
          status: finalStatus,
          records_synced: totalSynced,
          error_message: allErrors.length > 0 ? allErrors.slice(0, 10).join('\n') : null,
          finished_at: new Date().toISOString(),
        }).eq('id', logId)
      }
    })()
  )

  return NextResponse.json({ status: 'started', logId, territories: TERRITORY_ROUTES.map((r) => r.label) })
}
