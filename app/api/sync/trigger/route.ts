import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase'
import { createSessionClient } from '@/lib/supabase-server'
import { createSynchroteamClient } from '@/lib/synchroteam'
import { getSessionUser } from '@/lib/auth/session'
import { syncTerritory, buildAccounts, claimSyncSlot } from '@/lib/sync-territory-route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Déclenchement des synchronisations Synchroteam → Supabase.
//
// La synchronisation est lancée ici directement (même logique que les routes
// /api/sync/reu|myt|glp), sans passer par un appel HTTP vers ces routes :
// l'ancien relais dépendait de CRON_SECRET et de NEXT_PUBLIC_APP_URL et, sans
// ces variables, visait la production avec un secret vide (réponse
// « Unauthorized », constatée le 29/09/2026 depuis un poste de développement).

const TERRITORIES = {
  reu: { code: 'REU', label: 'La Réunion' },
  myt: { code: 'MYT', label: 'Mayotte' },
  glp: { code: 'GLP', label: 'Guadeloupe' },
} as const
type TerritoryKey = keyof typeof TERRITORIES

function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('x-cron-secret') === secret || req.headers.get('authorization') === `Bearer ${secret}`
}

/** Lance la synchronisation d'un territoire en tâche de fond et répond aussitôt */
async function startTerritorySync(key: TerritoryKey): Promise<{ status: number; body: Record<string, unknown> }> {
  const t = TERRITORIES[key]
  const acc = buildAccounts(t.code)
  if (!acc) return { status: 500, body: { error: `Compte Synchroteam ${t.code} non configuré (SYNCHROTEAM_DOMAIN / API_KEY)`, territory: t.code } }

  const supabase = createServiceClient()
  const slot = await claimSyncSlot(supabase, `synchroteam_${key}`)
  if (!slot.claimed) {
    return { status: 409, body: { status: 'already_running', territory: t.code, message: `Une synchronisation ${t.code} est déjà en cours depuis ${slot.alreadyRunningSince}` } }
  }
  const logId = slot.logId

  // waitUntil : la synchronisation continue après la réponse HTTP (limite de 60 s par fonction)
  waitUntil(
    syncTerritory(supabase, createSynchroteamClient(acc.domain, acc.key), acc.idPrefix, acc.forcedTerritoryCode).then(async (result) => {
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

  return { status: 200, body: { status: 'started', logId, territory: t.code } }
}

// GET /api/sync/trigger : les trois territoires en parallèle (usage cron), protégé par CRON_SECRET
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const results = await Promise.all((Object.keys(TERRITORIES) as TerritoryKey[]).map((key) => startTerritorySync(key)))
  return NextResponse.json({ status: 'started', territories: results.map((r) => r.body) })
}

// POST /api/sync/trigger?territory=reu|myt|glp : depuis l'interface, session administrateur ou maintenance
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(await createSessionClient())
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    if (user.role !== 'administrateur' && user.role !== 'maintenance') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Erreur auth' }, { status: 401 })
  }

  const territory = req.nextUrl.searchParams.get('territory') ?? ''
  if (!(territory in TERRITORIES)) {
    return NextResponse.json({ error: `Territoire inconnu : ${territory}` }, { status: 400 })
  }
  try {
    const { status, body } = await startTerritorySync(territory as TerritoryKey)
    return NextResponse.json(body, { status })
  } catch (err) {
    return NextResponse.json({ status: 'error', error: String(err) }, { status: 500 })
  }
}
