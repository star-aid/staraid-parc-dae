import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { authorizeGeodae } from '@/lib/geodae/route-auth'
import { ANOMALY_LABELS, type AnomalyRow, type AnomalyType } from '@/lib/geodae/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TYPES: AnomalyType[] = ['absent_geodae', 'ambigu', 'erreur_recherche', 'divergence_id', 'non_reference_synchroteam']
const PAGE = 1000

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Détail lisible d'une anomalie, d'après son JSON */
function detailText(a: AnomalyRow): string {
  const d = (a.details ?? {}) as Record<string, unknown>
  return [d.reason, d.presence].filter((x): x is string => typeof x === 'string').join(' · ')
}

/**
 * GET /api/geodae/anomalies[?status=open|resolved|all][&type=…][&account=…][&format=csv]
 * Rapport d'anomalies (point 3) : liste complète, filtrable, exportable en CSV.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res

  const p = req.nextUrl.searchParams
  const status = p.get('status') === 'resolved' ? 'resolved' : p.get('status') === 'all' ? 'all' : 'open'
  const type = p.get('type')
  const account = p.get('account')

  const supabase = createServiceClient()
  const rows: AnomalyRow[] = []
  for (let page = 0; ; page++) {
    let q = supabase.from('geodae_anomalies').select('*').order('type').order('last_seen_at', { ascending: false })
    if (status === 'open') q = q.is('resolved_at', null)
    if (status === 'resolved') q = q.not('resolved_at', 'is', null)
    if (type && (TYPES as string[]).includes(type)) q = q.eq('type', type)
    if (account && ['REU', 'MYT', 'GLP'].includes(account)) q = q.eq('account', account)
    const { data, error } = await q.range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const batch = (data ?? []) as AnomalyRow[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }

  if (p.get('format') === 'csv') {
    const cols = ['Anomalie', 'Compte', 'N° série', 'Identifiant Synchroteam', "Identifiant Géo'DAE", 'Détail', 'Première détection', 'Dernière détection', 'Clôturée le', 'Résolution']
    const lines = [cols.join(';')]
    for (const a of rows) {
      lines.push([
        ANOMALY_LABELS[a.type] ?? a.type, a.account, a.serial_number, a.synchroteam_geo_dae_id, a.geodae_gid,
        detailText(a), a.first_seen_at, a.last_seen_at, a.resolved_at, a.resolution,
      ].map(csvEscape).join(';'))
    }
    return new NextResponse('﻿' + lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="geodae-anomalies-${status}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }
  return NextResponse.json({ status, total: rows.length, anomalies: rows }, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * PATCH /api/geodae/anomalies  { id, resolution }
 * Clôture manuelle d'une anomalie traitée hors outil (déclaration faite sur le
 * portail, DAE désactivé dans Synchroteam…). Le commentaire garde l'auteur.
 */
export async function PATCH(req: NextRequest) {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res

  let body: { id?: string; resolution?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }
  const id = typeof body.id === 'string' ? body.id : ''
  const text = typeof body.resolution === 'string' ? body.resolution.trim().slice(0, 500) : ''
  if (!/^[0-9a-f-]{36}$/i.test(id) || !text) {
    return NextResponse.json({ error: 'id et resolution (commentaire) attendus' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('geodae_anomalies')
    .update({ resolved_at: new Date().toISOString(), resolution: `clôturée par ${auth.who} : ${text}` })
    .eq('id', id)
    .is('resolved_at', null)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: 'Anomalie introuvable ou déjà clôturée' }, { status: 404 })
  return NextResponse.json({ ok: true, id })
}
