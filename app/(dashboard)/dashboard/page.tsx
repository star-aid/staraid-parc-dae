import type { ReactNode } from 'react'
import { Suspense } from 'react'
import dynamicImport from 'next/dynamic'
import { createServiceClient } from '@/lib/supabase'
import type { ParkSummary, TerritoryCode } from '@/types'
import NextExpirations from '@/components/dashboard/NextExpirations'
import Link from 'next/link'
import { parseContratParam, parseAutreTypesParam, buildContratOrFilter } from '@/lib/contract-groups'
import TerritoryFilterBar from '@/components/dashboard/TerritoryFilterBar'
import { Card, EmptyState, LinkButton, PageContainer, PageHeader } from '@/components/ui/primitives'
import { createSessionClient } from '@/lib/supabase-server'

const StatusDonut = dynamicImport(() => import('@/components/dashboard/StatusDonut'), { ssr: false })
const TerritoryBars = dynamicImport(() => import('@/components/dashboard/TerritoryBars'), { ssr: false })
const InterventionsLine = dynamicImport(() => import('@/components/dashboard/InterventionsLine'), { ssr: false })

export const dynamic = 'force-dynamic'

interface MonthlyRow {
  month: string
  total: number
  maintenance: number
  depannage: number
}

// Requête count HEAD — ne retourne que le comptage, pas de lignes → pas de limite max_rows
function countQ(
  supabase: ReturnType<typeof createServiceClient>,
  status?: string,
  territoryId?: string,
  contratFilter?: string | null,
  clientOrFilter?: string | null,
  actif?: string
) {
  let q = supabase
    .from('defibrillators')
    .select('*', { count: 'exact', head: true })
  if (!actif || actif === 'actif') q = q.eq('active', true)
  else if (actif === 'inactif')    q = q.eq('active', false)
  // 'tous' → pas de filtre active
  if (status)          q = q.eq('status', status)
  if (territoryId)     q = q.eq('territory_id', territoryId)
  if (contratFilter)   q = q.or(contratFilter)
  if (clientOrFilter)  q = q.or(clientOrFilter)
  return q
}

async function getDashboardData(contratFilter: string | null, clientId: string | null, territoryCode: string | null, actif: string): Promise<{
  summary: ParkSummary | null
  monthly: MonthlyRow[]
}> {
  try {
    const supabase = createServiceClient()

    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
    const dateFrom = twelveMonthsAgo.toISOString().split('T')[0]

    // Résolution du territoire sélectionné en UUID
    let selectedTerritoryId: string | undefined
    if (territoryCode) {
      const { data: tRow } = await supabase.from('territories').select('id').eq('code', territoryCode).maybeSingle()
      selectedTerritoryId = tRow?.id
    }

    // Filtre client : OR sur client_id direct OU site_id (héritage via le site)
    let clientOrFilter: string | null = null
    if (clientId) {
      const { data: cs } = await supabase.from('sites').select('id').eq('client_id', clientId).limit(100)
      const siteIds = (cs ?? []).map((s: { id: string }) => s.id)
      const parts = [`client_id.eq.${clientId}`]
      if (siteIds.length > 0) parts.push(`site_id.in.(${siteIds.join(',')})`)
      clientOrFilter = parts.join(',')
    }

    // ── Passe 1 : données indépendantes des IDs de territoire ────────────────
    // Les interventions sont paginées séparément pour contourner max_rows=1000
    let expQ = supabase
      .from('defibrillators')
      .select('id, serial_number, model, status_reason, battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry, next_maintenance_date, clients(name), territories(code)')
      .in('status', ['critique', 'vigilance'])
      .order('status', { ascending: false })
      .order('battery_expiry', { ascending: true, nullsFirst: false })
      .limit(5)
    if (!actif || actif === 'actif') expQ = expQ.eq('active', true)
    else if (actif === 'inactif')   expQ = expQ.eq('active', false)
    if (selectedTerritoryId) expQ = expQ.eq('territory_id', selectedTerritoryId)
    if (contratFilter)  expQ = expQ.or(contratFilter)
    if (clientOrFilter) expQ = expQ.or(clientOrFilter)

    const [
      { count: total },
      { count: conforme },
      { count: vigilance },
      { count: critique },
      { count: inconnu },
      territoriesRes,
      lastSyncRes,
      expirationsRes,
    ] = await Promise.all([
      countQ(supabase, undefined,   selectedTerritoryId, contratFilter, clientOrFilter, actif),
      countQ(supabase, 'conforme',  selectedTerritoryId, contratFilter, clientOrFilter, actif),
      countQ(supabase, 'vigilance', selectedTerritoryId, contratFilter, clientOrFilter, actif),
      countQ(supabase, 'critique',  selectedTerritoryId, contratFilter, clientOrFilter, actif),
      countQ(supabase, 'inconnu',   selectedTerritoryId, contratFilter, clientOrFilter, actif),
      supabase.from('territories').select('id, code'),
      supabase
        .from('sync_logs')
        .select('finished_at')
        .eq('source', 'synchroteam')
        .eq('status', 'success')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      expQ,
    ])

    // Pagination des interventions pour contourner max_rows=1000
    type IntRow = { type: string | null; completed_date: string }
    const allInterventions: IntRow[] = []
    {
      const PAGE = 1000
      let page = 0
      while (true) {
        let intQ = supabase
          .from('interventions')
          .select('type, completed_date')
          .not('completed_date', 'is', null)
          .gte('completed_date', dateFrom)
          .order('completed_date', { ascending: true })
          .range(page * PAGE, (page + 1) * PAGE - 1)
        // interventions.client_id suit la même logique que defibrillators
        if (clientOrFilter) intQ = intQ.or(clientOrFilter)
        const { data, error: err } = await intQ
        if (err || !data?.length) break
        allInterventions.push(...(data as IntRow[]))
        if (data.length < PAGE) break
        page++
      }
    }

    const territories = (territoriesRes.data ?? []) as Array<{ id: string; code: string }>

    // ── Passe 2 : counts par territoire (IDs maintenant connus) ──────────────
    const STATUSES = ['conforme', 'vigilance', 'critique', 'inconnu'] as const
    const CODES    = ['REU', 'MYT', 'GLP'] as const

    const terrCountResults = await Promise.all(
      territories.flatMap((t) => [
        countQ(supabase, undefined, t.id, contratFilter, clientOrFilter),
        ...STATUSES.map((s) => countQ(supabase, s, t.id, contratFilter, clientOrFilter)),
      ])
    )

    // Reconstruction by_territory depuis les résultats
    const by_territory = Object.fromEntries(
      CODES.map((c) => [c, { total: 0, conforme: 0, vigilance: 0, critique: 0, inconnu: 0 }])
    ) as ParkSummary['by_territory']

    territories.forEach((t, ti) => {
      const code = t.code as TerritoryCode
      if (!(code in by_territory)) return
      const base = ti * (STATUSES.length + 1)
      by_territory[code].total     = terrCountResults[base].count     ?? 0
      by_territory[code].conforme  = terrCountResults[base + 1].count ?? 0
      by_territory[code].vigilance = terrCountResults[base + 2].count ?? 0
      by_territory[code].critique  = terrCountResults[base + 3].count ?? 0
      by_territory[code].inconnu   = terrCountResults[base + 4].count ?? 0
    })

    // ── Prochaines échéances ──────────────────────────────────────────────────
    type ExpRow = {
      id: string
      serial_number: string | null
      model: string | null
      status_reason: string | null
      battery_expiry: string | null
      electrodes_adult_expiry: string | null
      electrodes_pediatric_expiry: string | null
      next_maintenance_date: string | null
      clients: { name: string } | null
      territories: { code: string } | null
    }
    const next_expirations = ((expirationsRes.data ?? []) as unknown as ExpRow[]).map((d) => {
      const dates = [d.battery_expiry, d.electrodes_adult_expiry, d.electrodes_pediatric_expiry, d.next_maintenance_date]
        .filter((x): x is string => !!x)
        .sort()
      return {
        id:             d.id,
        serial_number:  d.serial_number,
        model:          d.model,
        client_name:    d.clients?.name ?? null,
        territory_code: (d.territories?.code ?? null) as TerritoryCode | null,
        next_date:      dates[0] ?? '',
        reason:         d.status_reason ?? '',
      }
    })

    // ── Interventions mensuelles groupées en JS ───────────────────────────────
    const monthlyMap = new Map<string, MonthlyRow>()
    for (const iv of allInterventions) {
      if (!iv.completed_date) continue
      const month = iv.completed_date.slice(0, 7)
      if (!monthlyMap.has(month)) monthlyMap.set(month, { month, total: 0, maintenance: 0, depannage: 0 })
      const row = monthlyMap.get(month)!
      row.total++
      if (iv.type === 'maintenance') row.maintenance++
      if (iv.type === 'depannage') row.depannage++
    }
    const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month))

    const summary: ParkSummary = {
      total:     total     ?? 0,
      conforme:  conforme  ?? 0,
      vigilance: vigilance ?? 0,
      critique:  critique  ?? 0,
      inconnu:   inconnu   ?? 0,
      by_territory,
      next_expirations,
      last_sync: lastSyncRes.data?.finished_at ?? null,
    }

    return { summary, monthly }
  } catch (err) {
    console.error('getDashboardData:', err)
    return { summary: null, monthly: [] }
  }
}

function pct(n: number, total: number) {
  if (!total) return '—'
  return `${Math.round((n / total) * 100)} %`
}

// ─── Tuile indicateur ─────────────────────────────────────────────────────────

type Accent = 'brand' | 'emerald' | 'amber' | 'red' | 'slate'

const ACCENT_TILE: Record<Accent, string> = {
  brand:   'bg-brand-soft text-brand',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber:   'bg-amber-50 text-amber-600',
  red:     'bg-red-50 text-red-600',
  slate:   'bg-slate-100 text-slate-500',
}

const ACCENT_VALUE: Record<Accent, string> = {
  brand:   'text-slate-900',
  emerald: 'text-emerald-700',
  amber:   'text-amber-700',
  red:     'text-red-700',
  slate:   'text-slate-700',
}

interface KPICardProps {
  label: string
  value: string | number
  sub?: string
  accent: Accent
  icon: ReactNode
  /** Cible au clic (liste filtrée correspondante) */
  href?: string
}

function KPICard({ label, value, sub, accent, icon, href }: KPICardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${ACCENT_TILE[accent]}`}>{icon}</span>
      </div>
      <p className={`mt-2 text-2xl font-semibold leading-none tracking-tight tabular-nums ${ACCENT_VALUE[accent]}`}>
        {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
      </p>
      {sub && <p className="mt-1.5 truncate text-xs text-slate-500">{sub}</p>}
    </>
  )
  const base = 'block rounded-lg border border-slate-200 bg-white p-4 shadow-card'
  if (!href) return <div className={base}>{body}</div>
  return (
    <Link href={href} className={`${base} transition-colors hover:border-slate-300 hover:bg-slate-50/60`}>
      {body}
    </Link>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { contrat?: string; autreTypes?: string; client?: string; territoire?: string; actif?: string; [key: string]: string | undefined }
}) {
  const contratFilter = buildContratOrFilter(
    parseContratParam(searchParams?.contrat),
    parseAutreTypesParam(searchParams?.autreTypes),
  )
  const clientId = searchParams?.client ?? null
  const territoryCode = searchParams?.territoire ?? null
  const actif = searchParams?.actif ?? 'actif'
  const { summary, monthly } = await getDashboardData(contratFilter, clientId, territoryCode, actif)

  let selectedClientName: string | null = null
  if (clientId) {
    const supabase = createServiceClient()
    const { data: cl } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle()
    selectedClientName = cl?.name ?? null
  }

  // Rôle utilisateur — pour afficher le bandeau inconnu aux admins/maintenance uniquement
  let userRole: string = 'direction'
  try {
    const sessionClient = await createSessionClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    userRole = (user?.user_metadata?.role as string | undefined) ?? 'direction'
  } catch { /* non authentifié → rôle par défaut */ }

  const total     = summary?.total     ?? 0
  const conforme  = summary?.conforme  ?? 0
  const vigilance = summary?.vigilance ?? 0
  const critique  = summary?.critique  ?? 0
  const inconnu   = summary?.inconnu   ?? 0

  // Les liens des tuiles conservent le contexte d'équipements actifs / inactifs
  const actifParam = actif !== 'actif' ? `&actif=${actif}` : ''
  const scopeLabel = actif === 'inactif' ? 'équipements inactifs' : actif === 'tous' ? 'tous les équipements' : 'équipements actifs'
  const nbExpirations = summary?.next_expirations?.length ?? 0

  return (
    <PageContainer>
      <PageHeader
        title="Tableau de bord"
        subtitle={
          selectedClientName
            ? <>Client : <span className="font-medium text-slate-700">{selectedClientName}</span></>
            : 'Vue d’ensemble du parc DAE, données de la dernière synchronisation'
        }
        actions={
          <Suspense>
            <TerritoryFilterBar />
          </Suspense>
        }
      />

      {/* Indicateurs */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard
          label="Total DAE"
          value={total || '—'}
          sub={scopeLabel}
          accent="brand"
          href={actif !== 'actif' ? `/parc?actif=${actif}` : '/parc'}
          icon={
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          }
        />
        <KPICard
          label="Conformes"
          value={conforme || '—'}
          sub={total ? `${pct(conforme, total)} du parc` : undefined}
          accent="emerald"
          href={`/parc?statut=conforme${actifParam}`}
          icon={
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          }
        />
        <KPICard
          label="Vigilance"
          value={vigilance || '—'}
          sub={vigilance > 0 ? 'échéance sous 30 jours' : 'aucune échéance proche'}
          accent="amber"
          href={`/parc?statut=vigilance${actifParam}`}
          icon={
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          }
        />
        <KPICard
          label="Critiques"
          value={critique || '—'}
          sub={critique > 0 ? 'intervention urgente' : 'aucun DAE critique'}
          accent={critique > 0 ? 'red' : 'slate'}
          href="/alertes"
          icon={
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          }
        />
      </div>

      {/* Graphiques */}
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Répartition des statuts">
          {total > 0 ? (
            <StatusDonut conforme={conforme} vigilance={vigilance} critique={critique} inconnu={inconnu} total={total} />
          ) : (
            <EmptyState className="flex h-44 items-center justify-center py-0">Aucune donnée</EmptyState>
          )}
        </Card>
        <Card title="DAE par territoire et statut">
          <TerritoryBars byTerritory={summary?.by_territory ?? {}} />
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card title="Interventions réalisées, 12 mois glissants" className="xl:col-span-2">
          <InterventionsLine data={monthly} />
        </Card>
        <Card
          title="Prochaines échéances urgentes"
          className="xl:col-span-3"
          actions={nbExpirations > 0 ? <LinkButton href="/alertes" variant="ghost" size="sm">Toutes les alertes</LinkButton> : undefined}
        >
          <NextExpirations items={summary?.next_expirations ?? []} />
        </Card>
      </div>

      {/* Données incomplètes — visible admins et maintenance uniquement */}
      {inconnu > 0 && (userRole === 'administrateur' || userRole === 'maintenance') && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-13 text-slate-600 shadow-card">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="flex-1 min-w-[200px]">
            <strong className="font-semibold text-slate-800 tabular-nums">{inconnu.toLocaleString('fr-FR')} DAE</strong> ont un statut
            inconnu : batterie, électrodes ou maintenance non renseignées dans Synchroteam.
          </span>
          <LinkButton href="/alertes?statut=inconnu" variant="secondary" size="sm">Voir la liste</LinkButton>
        </div>
      )}
    </PageContainer>
  )
}