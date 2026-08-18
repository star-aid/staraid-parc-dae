import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createSessionClient } from '@/lib/supabase-server'
import { parseContratParam, parseAutreTypesParam, buildContratOrFilter } from '@/lib/contract-groups'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type ExportRow = {
  serial_number: string | null
  model: string | null
  brand: string | null
  status: string
  status_reason: string | null
  battery_status: string
  electrodes_status: string
  last_maintenance_date: string | null
  next_maintenance_date: string | null
  battery_expiry: string | null
  electrodes_adult_expiry: string | null
  electrodes_pediatric_expiry: string | null
  clients: { name: string } | null
  sites: { name: string } | null
  territories: { code: string } | null
}

function criticalDate(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a <= b ? a : b
}

function isPediatricMoreCritical(adult: string | null, ped: string | null): boolean {
  if (!ped) return false
  if (!adult) return true
  return ped < adult
}

function fmtDate(s: string | null) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function csvEscape(v: string | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(req: NextRequest) {
  // Authentification requise — export réservé aux utilisateurs connectés
  try {
    const sessionClient = await createSessionClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  } catch {
    return NextResponse.json({ error: 'Erreur auth' }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const q       = (sp.get('q') ?? '').trim()
  const terr    = sp.get('territoire')?.split(',').filter(Boolean) ?? []
  const stat    = sp.get('statut')?.split(',').filter(Boolean) ?? []
  const actif   = sp.get('actif') ?? 'actif'
  const clientId = sp.get('client') ?? null

  const contratGroups = parseContratParam(sp.get('contrat') ?? undefined)
  const contratFilter = buildContratOrFilter(contratGroups, parseAutreTypesParam(sp.get('autreTypes') ?? undefined))

  const supabase = createServiceClient()

  // Même logique de filtre client que la page Parc DAE
  let clientOrFilter: string | null = null
  if (clientId) {
    const { data: cs } = await supabase.from('sites').select('id').eq('client_id', clientId).limit(100)
    const siteIds = (cs ?? []).map((s: { id: string }) => s.id)
    const parts = [`client_id.eq.${clientId}`]
    if (siteIds.length > 0) parts.push(`site_id.in.(${siteIds.join(',')})`)
    clientOrFilter = parts.join(',')
  }

  let territoryIds: string[] = []
  if (terr.length > 0) {
    const { data: terrs } = await supabase.from('territories').select('id').in('code', terr)
    territoryIds = terrs?.map((t: { id: string }) => t.id) ?? []
  }

  // Recherche texte : même logique que la page Parc DAE
  let searchOrParts: string[] | null = null
  if (q) {
    const { data: matchedClients } = await supabase
      .from('clients')
      .select('id')
      .ilike('name', `%${q}%`)
      .order('name')
      .limit(20)
    const matchedClientIds = (matchedClients ?? []).map((c: { id: string }) => c.id)

    let matchedSiteIds: string[] = []
    if (matchedClientIds.length > 0) {
      const { data: matchedSites } = await supabase
        .from('sites')
        .select('id')
        .in('client_id', matchedClientIds)
        .limit(80)
      matchedSiteIds = (matchedSites ?? []).map((s: { id: string }) => s.id)
    }

    const orParts = [`serial_number.ilike.%${q}%`, `model.ilike.%${q}%`, `brand.ilike.%${q}%`]
    if (matchedClientIds.length > 0) orParts.push(`client_id.in.(${matchedClientIds.join(',')})`)
    if (matchedSiteIds.length > 0) orParts.push(`site_id.in.(${matchedSiteIds.join(',')})`)
    searchOrParts = orParts
  }

  // Récupère TOUTES les lignes correspondant aux filtres, sans pagination affichage
  const PAGE = 1000
  const allRows: ExportRow[] = []
  for (let p = 0; ; p++) {
    let query = supabase
      .from('defibrillators')
      .select(`
        serial_number, model, brand,
        status, status_reason, battery_status, electrodes_status,
        last_maintenance_date, next_maintenance_date, battery_expiry,
        electrodes_adult_expiry, electrodes_pediatric_expiry,
        clients(name), sites(name), territories(code)
      `)
      .order('id')
      .range(p * PAGE, (p + 1) * PAGE - 1)

    if (actif === 'actif')   query = query.eq('active', true)
    if (actif === 'inactif') query = query.eq('active', false)
    if (terr.length > 0 && territoryIds.length > 0) query = query.in('territory_id', territoryIds)
    if (stat.length > 0) query = query.in('status', stat)
    if (contratFilter)   query = query.or(contratFilter)
    if (clientOrFilter)  query = query.or(clientOrFilter)
    if (searchOrParts)   query = query.or(searchOrParts.join(','))

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) break
    allRows.push(...(data as unknown as ExportRow[]))
    if (data.length < PAGE) break
  }

  const cols = [
    'N° série', 'Modèle', 'Marque', 'Client', 'Site', 'Territoire',
    'Statut', 'Raison statut', 'Dernière maintenance', 'Prochaine échéance',
    'Batterie', 'DLU batterie', 'Électrodes', 'DLU électrodes', 'Type électrodes',
  ]

  const lines = [cols.join(',')]
  for (const d of allRows) {
    const row = [
      d.serial_number ?? '',
      d.model ?? '',
      d.brand ?? '',
      d.clients?.name ?? '',
      d.sites?.name ?? '',
      d.territories?.code ?? '',
      d.status,
      d.status_reason ?? '',
      fmtDate(d.last_maintenance_date),
      fmtDate(d.next_maintenance_date),
      d.battery_status,
      fmtDate(d.battery_expiry),
      d.electrodes_status,
      fmtDate(criticalDate(d.electrodes_adult_expiry, d.electrodes_pediatric_expiry)),
      isPediatricMoreCritical(d.electrodes_adult_expiry, d.electrodes_pediatric_expiry) ? 'Pédiatriques' : 'Adultes',
    ]
    lines.push(row.map(csvEscape).join(','))
  }

  const csv = '﻿' + lines.join('\n')
  const date = new Date().toISOString().split('T')[0]

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="parc-dae-${date}.csv"`,
    },
  })
}
