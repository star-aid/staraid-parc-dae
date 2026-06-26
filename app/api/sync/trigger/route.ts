import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase'
import { createSessionClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TERRITORY_ROUTES: Record<string, { path: string; label: string }> = {
  reu: { path: '/api/sync/reu', label: 'La Réunion' },
  myt: { path: '/api/sync/myt', label: 'Mayotte' },
  glp: { path: '/api/sync/glp', label: 'Guadeloupe' },
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://staraid-parc-dae.vercel.app'
const secret  = process.env.CRON_SECRET ?? ''

// GET /api/sync/trigger — déclenche les 3 territoires en parallèle (usage cron interne)
export async function GET() {
  const supabase = createServiceClient()

  const { data: logEntry } = await supabase
    .from('sync_logs')
    .insert({ source: 'synchroteam_trigger', status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single()
  const logId: string | null = logEntry?.id ?? null

  waitUntil(
    Promise.allSettled(
      Object.values(TERRITORY_ROUTES).map(({ path, label }) =>
        fetch(`${baseUrl}${path}`, { method: 'GET', headers: { 'x-cron-secret': secret } })
          .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
          .then((body: { equipments?: number; clients?: number; sites?: number; interventions?: number; errors?: string[] }) => ({
            label,
            synced: (body.equipments ?? 0) + (body.clients ?? 0) + (body.sites ?? 0) + (body.interventions ?? 0),
            errors: (body.errors ?? []).map((e) => `[${label}] ${e}`),
          }))
          .catch((err: unknown) => ({ label, synced: 0, errors: [`[${label}] ${String(err)}`] }))
      )
    ).then(async (results) => {
      let totalSynced = 0
      const allErrors: string[] = []
      for (const r of results) {
        if (r.status === 'fulfilled') {
          totalSynced += r.value.synced
          allErrors.push(...r.value.errors)
        } else {
          allErrors.push(String(r.reason))
        }
      }
      const finalStatus = allErrors.length > 0 ? (totalSynced > 0 ? 'partial' : 'error') : 'success'
      if (logId) {
        await supabase.from('sync_logs').update({
          status: finalStatus,
          records_synced: totalSynced,
          error_message: allErrors.length > 0 ? allErrors.slice(0, 10).join('\n') : null,
          finished_at: new Date().toISOString(),
        }).eq('id', logId)
      }
    })
  )

  return NextResponse.json({ status: 'started', logId, territories: Object.keys(TERRITORY_ROUTES) })
}

// POST /api/sync/trigger?territory=reu|myt|glp
// Appelé depuis la sidebar (session utilisateur) — proxy vers la route territoire avec le secret serveur
export async function POST(req: NextRequest) {
  // Vérifie que l'utilisateur est connecté
  try {
    const supabase = await createSessionClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const role = user.user_metadata?.role as string | undefined
    if (role !== 'administrateur' && role !== 'maintenance') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Erreur auth' }, { status: 401 })
  }

  const territory = req.nextUrl.searchParams.get('territory') ?? ''
  const route = TERRITORY_ROUTES[territory]
  if (!route) {
    return NextResponse.json({ error: `Territoire inconnu: ${territory}` }, { status: 400 })
  }

  try {
    const res = await fetch(`${baseUrl}${route.path}`, {
      method: 'GET',
      headers: { 'x-cron-secret': secret },
    })
    const body = await res.json()
    return NextResponse.json(body, { status: res.status })
  } catch (err) {
    return NextResponse.json({ status: 'error', error: String(err) }, { status: 500 })
  }
}
