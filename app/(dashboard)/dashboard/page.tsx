import { AlertCircle, AlertTriangle, CheckCircle2, HeartPulse, HelpCircle, type LucideIcon } from 'lucide-react'
import { Suspense } from 'react'
import dynamicImport from 'next/dynamic'
import { createServiceClient } from '@/lib/supabase'
import type { ParkSummary, TerritoryCode } from '@/types'
import NextExpirations from '@/components/dashboard/NextExpirations'
import Link from 'next/link'
import { parseContratParam, parseAutreTypesParam, buildContratOrFilter, buildContratSqlParams, type ContratSqlParams } from '@/lib/contract-groups'
import TerritoryFilterBar from '@/components/dashboard/TerritoryFilterBar'
import { Card, EmptyState, LinkButton, Notice, PageContainer, PageHeader } from '@/components/ui/primitives'
import { createSessionClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth/session'

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

// ─── Collecte des données ────────────────────────────────────────────────────
// Une seule vague de requêtes parallèles (deux quand un client est filtré, le
// temps de connaître ses sites). Les comptages par statut et par territoire
// viennent d'une fonction SQL agrégée (get_dashboard_status_counts) au lieu
// d'une vingtaine de requêtes de comptage, et les interventions mensuelles sont
// agrégées en SQL (get_dashboard_interventions_monthly) au lieu d'être
// paginées puis regroupées ici. Chaque aller-retour vers Supabase coûtant
// 250 à 400 ms depuis les territoires, c'est le nombre d'étapes qui compte.
// Migration requise : supabase/migrations/20260928000013_dashboard_aggregates.sql

type StatusKey = 'conforme' | 'vigilance' | 'critique' | 'inconnu'
const STATUSES: readonly StatusKey[] = ['conforme', 'vigilance', 'critique', 'inconnu']
const CODES = ['REU', 'MYT', 'GLP'] as const

type StatusCountRow = { territory_code: string | null; dae_status: string | null; dae_count: number }
type MonthlyRpcRow  = { month: string; total: number; maintenance: number; depannage: number }
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

function emptyCounts() {
  return { total: 0, conforme: 0, vigilance: 0, critique: 0, inconnu: 0 }
}

// Filtre « actif » de l'URL → paramètre booléen de la fonction SQL (null = tous)
function activeParam(actif: string): boolean | null {
  if (!actif || actif === 'actif') return true
  if (actif === 'inactif') return false
  return null
}

async function getDashboardData(
  contratSql: ContratSqlParams | null,
  contratFilter: string | null,
  clientId: string | null,
  territoryCode: string | null,
  actif: string
): Promise<{ summary: ParkSummary | null; monthly: MonthlyRow[]; clientName: string | null; error: string | null }> {
  try {
    const supabase = createServiceClient()
    const active = activeParam(actif)

    // Prochaines échéances (5 lignes). Le filtre territoire passe par la jointure
    // (territories!inner) : plus besoin de résoudre l'UUID du territoire avant.
    const buildExpQ = (siteIds: string[]) => {
      let q = supabase
        .from('defibrillators')
        .select(`id, serial_number, model, status_reason, battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry, next_maintenance_date, clients(name), territories${territoryCode ? '!inner' : ''}(code)`)
        .in('status', ['critique', 'vigilance'])
        .order('status', { ascending: false })
        .order('battery_expiry', { ascending: true, nullsFirst: false })
        .limit(5)
      if (active !== null) q = q.eq('active', active)
      if (territoryCode)   q = q.eq('territories.code', territoryCode)
      if (contratFilter)   q = q.or(contratFilter)
      if (clientId) {
        const parts = [`client_id.eq.${clientId}`]
        if (siteIds.length > 0) parts.push(`site_id.in.(${siteIds.join(',')})`)
        q = q.or(parts.join(','))
      }
      return q
    }

    // ── Vague 1 : tout ce qui ne dépend pas des sites du client ─────────────
    const [countsRes, monthlyRes, lastSyncRes, clientRes, sitesRes, expDirectRes] = await Promise.all([
      supabase.rpc('get_dashboard_status_counts', {
        p_active:          active,
        p_client_id:       clientId,
        p_contract_in:     contratSql?.contract_in ?? null,
        p_contract_not_in: contratSql?.contract_not_in ?? null,
        p_contract_null:   contratSql?.contract_null ?? false,
      }),
      supabase.rpc('get_dashboard_interventions_monthly', { p_months: 12, p_client_id: clientId }),
      supabase
        .from('sync_logs')
        .select('finished_at')
        .eq('source', 'synchroteam')
        .eq('status', 'success')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      clientId ? supabase.from('clients').select('name').eq('id', clientId).maybeSingle() : null,
      clientId ? supabase.from('sites').select('id').eq('client_id', clientId).limit(100) : null,
      clientId ? null : buildExpQ([]),
    ])
    if (countsRes.error)  throw new Error(`get_dashboard_status_counts : ${countsRes.error.message}`)
    if (monthlyRes.error) throw new Error(`get_dashboard_interventions_monthly : ${monthlyRes.error.message}`)

    // ── Vague 2 (client filtré seulement) : échéances restreintes à ses sites ─
    const expirationsRes = expDirectRes ?? await buildExpQ(
      ((sitesRes?.data ?? []) as Array<{ id: string }>).map((s) => s.id)
    )

    // ── Comptages : KPI globaux + répartition par territoire ─────────────────
    const by_territory = Object.fromEntries(
      CODES.map((c) => [c, emptyCounts()])
    ) as ParkSummary['by_territory']
    const global = emptyCounts()

    for (const r of (countsRes.data ?? []) as StatusCountRow[]) {
      const n = Number(r.dae_count)
      const code = r.territory_code as TerritoryCode | null
      const st = r.dae_status
      const isStatus = st !== null && (STATUSES as readonly string[]).includes(st)
      // KPI globaux : territoire sélectionné uniquement s'il est filtré
      if (!territoryCode || code === territoryCode) {
        global.total += n
        if (isStatus) global[st as StatusKey] += n
      }
      // Répartition : toujours les trois territoires
      if (code && code in by_territory) {
        by_territory[code].total += n
        if (isStatus) by_territory[code][st as StatusKey] += n
      }
    }

    // ── Prochaines échéances ─────────────────────────────────────────────────
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

    // ── Interventions mensuelles (agrégées en SQL) ───────────────────────────
    const monthly: MonthlyRow[] = ((monthlyRes.data ?? []) as MonthlyRpcRow[]).map((r) => ({
      month:       r.month,
      total:       Number(r.total),
      maintenance: Number(r.maintenance),
      depannage:   Number(r.depannage),
    }))

    const summary: ParkSummary = {
      ...global,
      by_territory,
      next_expirations,
      last_sync: lastSyncRes.data?.finished_at ?? null,
    }

    const clientName = (clientRes?.data as { name: string } | null)?.name ?? null
    return { summary, monthly, clientName, error: null }
  } catch (err) {
    console.error('getDashboardData:', err)
    return { summary: null, monthly: [], clientName: null, error: err instanceof Error ? err.message : String(err) }
  }
}

// Rôle de l'utilisateur connecté, lu dans le jeton vérifié localement (aucun appel réseau)
async function getUserRole(): Promise<string> {
  try {
    const user = await getSessionUser(await createSessionClient())
    return user?.role ?? 'direction'
  } catch {
    return 'direction' // non authentifié → rôle par défaut
  }
}

function pct(n: number, total: number) {
  if (!total) return '—'
  return `${Math.round((n / total) * 100)} %`
}

// ─── Tuile indicateur ─────────────────────────────────────────────────────────

type Accent = 'brand' | 'success' | 'warning' | 'danger' | 'neutral'

// La couleur d'identité vit dans la tuile d'icône ; la valeur reste en encre,
// sauf quand elle signale un état (vigilance, critique).
const ACCENT_TILE: Record<Accent, string> = {
  brand:   'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger:  'bg-danger-soft text-danger',
  neutral: 'bg-surface-sunken text-fg-muted',
}

const ACCENT_VALUE: Record<Accent, string> = {
  brand:   'text-fg',
  success: 'text-fg',
  warning: 'text-warning',
  danger:  'text-danger',
  neutral: 'text-fg-secondary',
}

interface KPICardProps {
  label: string
  value: string | number
  sub?: string
  accent: Accent
  icon: LucideIcon
  /** Cible au clic (liste filtrée correspondante) */
  href?: string
}

function KPICard({ label, value, sub, accent, icon: Icon, href }: KPICardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-label font-bold uppercase tracking-wide text-fg-muted">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-control ${ACCENT_TILE[accent]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={`mt-3 text-2xl font-extrabold leading-none tracking-tight tabular-nums ${ACCENT_VALUE[accent]}`}>
        {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
      </p>
      {sub && <p className="mt-1.5 truncate text-caption text-fg-muted">{sub}</p>}
    </>
  )
  const base = 'block rounded-card border border-border bg-surface p-4 shadow-card'
  if (!href) return <div className={base}>{body}</div>
  return (
    <Link href={href} className={`${base} transition-colors hover:border-border-strong`}>
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
  const contratGroups  = parseContratParam(searchParams?.contrat)
  const autreTypesSel  = parseAutreTypesParam(searchParams?.autreTypes)
  const contratFilter  = buildContratOrFilter(contratGroups, autreTypesSel)
  const contratSql     = buildContratSqlParams(contratGroups, autreTypesSel)
  const clientId       = searchParams?.client ?? null
  const territoryCode  = searchParams?.territoire ?? null
  const actif          = searchParams?.actif ?? 'actif'

  // Données et rôle utilisateur en parallèle : plus d'appels en série au niveau de la page
  const [{ summary, monthly, clientName: selectedClientName, error: dataError }, userRole] = await Promise.all([
    getDashboardData(contratSql, contratFilter, clientId, territoryCode, actif),
    getUserRole(),
  ])

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
            ? <>Client : <span className="font-medium text-fg-secondary">{selectedClientName}</span></>
            : 'Vue d’ensemble du parc DAE, données de la dernière synchronisation'
        }
        actions={
          <Suspense>
            <TerritoryFilterBar />
          </Suspense>
        }
      />

      {dataError && (
        <Notice tone="danger" className="mb-4">
          Données indisponibles : {dataError}. Si le message évoque une fonction introuvable, appliquer la migration
          {' '}<code className="font-mono">20260928000013_dashboard_aggregates.sql</code> (npm run db:push).
        </Notice>
      )}

      {/* Indicateurs */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard
          label="Total DAE"
          value={total || '—'}
          sub={scopeLabel}
          accent="brand"
          href={actif !== 'actif' ? `/parc?actif=${actif}` : '/parc'}
          icon={HeartPulse}
        />
        <KPICard
          label="Conformes"
          value={conforme || '—'}
          sub={total ? `${pct(conforme, total)} du parc` : undefined}
          accent="success"
          href={`/parc?statut=conforme${actifParam}`}
          icon={CheckCircle2}
        />
        <KPICard
          label="Vigilance"
          value={vigilance || '—'}
          sub={vigilance > 0 ? 'échéance sous 30 jours' : 'aucune échéance proche'}
          accent="warning"
          href={`/parc?statut=vigilance${actifParam}`}
          icon={AlertTriangle}
        />
        <KPICard
          label="Critiques"
          value={critique || '—'}
          sub={critique > 0 ? 'intervention urgente' : 'aucun DAE critique'}
          accent={critique > 0 ? 'danger' : 'neutral'}
          href="/alertes"
          icon={AlertCircle}
        />
      </div>

      {/* Graphiques */}
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Répartition des statuts">
          {total > 0 ? (
            <StatusDonut conforme={conforme} vigilance={vigilance} critique={critique} inconnu={inconnu} total={total} />
          ) : (
            <EmptyState compact className="h-44">Aucune donnée</EmptyState>
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
        <Notice tone="neutral" icon={HelpCircle} actions={<LinkButton href="/alertes?statut=inconnu" variant="secondary" size="xs">Voir la liste</LinkButton>}>
          <strong className="font-semibold text-fg tabular-nums">{inconnu.toLocaleString('fr-FR')} DAE</strong> ont un statut
          inconnu : batterie, électrodes ou maintenance non renseignées dans Synchroteam.
        </Notice>
      )}
    </PageContainer>
  )
}