import type { ReactNode } from 'react'
import { createServiceClient } from '@/lib/supabase'
import type { ParkSummary, TerritoryCode } from '@/types'
import StatusDonut from '@/components/dashboard/StatusDonut'
import TerritoryBars from '@/components/dashboard/TerritoryBars'
import InterventionsLine from '@/components/dashboard/InterventionsLine'
import NextExpirations from '@/components/dashboard/NextExpirations'

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
  territoryId?: string
) {
  let q = supabase
    .from('defibrillators')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)
  if (status)      q = q.eq('status', status)
  if (territoryId) q = q.eq('territory_id', territoryId)
  return q
}

async function getDashboardData(): Promise<{
  summary: ParkSummary | null
  monthly: MonthlyRow[]
}> {
  try {
    const supabase = createServiceClient()

    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
    const dateFrom = twelveMonthsAgo.toISOString().split('T')[0]

    // ── Passe 1 : données indépendantes des IDs de territoire ────────────────
    // Les interventions sont paginées séparément pour contourner max_rows=1000
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
      countQ(supabase),
      countQ(supabase, 'conforme'),
      countQ(supabase, 'vigilance'),
      countQ(supabase, 'critique'),
      countQ(supabase, 'inconnu'),
      supabase.from('territories').select('id, code'),
      supabase
        .from('sync_logs')
        .select('finished_at')
        .eq('source', 'synchroteam')
        .eq('status', 'success')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('defibrillators')
        .select('id, serial_number, model, status_reason, battery_expiry, electrodes_adult_expiry, next_maintenance_date, clients(name), territories(code)')
        .eq('active', true)
        .in('status', ['critique', 'vigilance'])
        .order('status', { ascending: false })
        .order('battery_expiry', { ascending: true, nullsFirst: false })
        .limit(5),
    ])

    // Pagination des interventions pour contourner max_rows=1000
    type IntRow = { type: string | null; completed_date: string }
    const allInterventions: IntRow[] = []
    {
      const PAGE = 1000
      let page = 0
      while (true) {
        const { data, error: err } = await supabase
          .from('interventions')
          .select('type, completed_date')
          .eq('status', 'termine')
          .gte('completed_date', dateFrom)
          .not('completed_date', 'is', null)
          .order('completed_date', { ascending: true })
          .range(page * PAGE, (page + 1) * PAGE - 1)
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
        countQ(supabase, undefined, t.id),
        ...STATUSES.map((s) => countQ(supabase, s, t.id)),
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
      next_maintenance_date: string | null
      clients: { name: string } | null
      territories: { code: string } | null
    }
    const next_expirations = ((expirationsRes.data ?? []) as unknown as ExpRow[]).map((d) => {
      const dates = [d.battery_expiry, d.electrodes_adult_expiry, d.next_maintenance_date]
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

interface KPICardProps {
  label: string
  value: string | number
  sub?: string
  accent: 'blue' | 'emerald' | 'amber' | 'red' | 'slate'
  icon: ReactNode
}

function KPICard({ label, value, sub, accent, icon }: KPICardProps) {
  const ACCENT = {
    blue:    'bg-blue-50 text-blue-600 ring-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    amber:   'bg-amber-50 text-amber-600 ring-amber-100',
    red:     'bg-red-50 text-red-600 ring-red-100',
    slate:   'bg-slate-100 text-slate-500 ring-slate-200',
  }
  const VALUE_COLOR = {
    blue: 'text-slate-800', emerald: 'text-emerald-700',
    amber: 'text-amber-700', red: 'text-red-700', slate: 'text-slate-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
          <p className={`text-3xl font-bold mt-1.5 leading-none ${VALUE_COLOR[accent]}`}>
            {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
          </p>
          {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-lg ring-1 ${ACCENT[accent]}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

export default async function DashboardPage() {
  const { summary, monthly } = await getDashboardData()

  const total     = summary?.total     ?? 0
  const conforme  = summary?.conforme  ?? 0
  const vigilance = summary?.vigilance ?? 0
  const critique  = summary?.critique  ?? 0
  const inconnu   = summary?.inconnu   ?? 0

  return (
    <div className="p-6 lg:p-8 max-w-screen-xl mx-auto">
      {/* En-tête */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Tableau de bord</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Vue d&apos;ensemble du parc DAE STAR aid — données temps réel
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Total DAE"
          value={total || '—'}
          sub="équipements actifs"
          accent="blue"
          icon={
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          }
        />
        <KPICard
          label="Conformes"
          value={conforme || '—'}
          sub={total ? `${pct(conforme, total)} du parc` : undefined}
          accent="emerald"
          icon={
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          }
        />
        <KPICard
          label="Vigilance"
          value={vigilance || '—'}
          sub={vigilance > 0 ? 'échéance < 30 jours' : 'aucune alerte'}
          accent="amber"
          icon={
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          }
        />
        <KPICard
          label="Critiques"
          value={critique || '—'}
          sub={critique > 0 ? 'intervention urgente' : 'aucun critique'}
          accent={critique > 0 ? 'red' : 'slate'}
          icon={
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          }
        />
      </div>

      {/* Graphiques — ligne 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Répartition des statuts</h2>
          {total > 0 ? (
            <StatusDonut
              conforme={conforme}
              vigilance={vigilance}
              critique={critique}
              inconnu={inconnu}
              total={total}
            />
          ) : (
            <div className="h-56 flex items-center justify-center text-sm text-slate-400">
              Aucune donnée
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">DAE par territoire</h2>
          <TerritoryBars byTerritory={summary?.by_territory ?? {}} />
        </div>
      </div>

      {/* Graphiques — ligne 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            Interventions — 12 mois glissants
          </h2>
          <InterventionsLine data={monthly} />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Prochaines échéances urgentes</h2>
            {(summary?.next_expirations?.length ?? 0) > 0 && (
              <a href="/alertes" className="text-xs text-blue-600 hover:underline">
                Voir tout →
              </a>
            )}
          </div>
          <NextExpirations items={summary?.next_expirations ?? []} />
        </div>
      </div>

      {/* Bandeau données inconnu */}
      {inconnu > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-3 flex items-center gap-3 text-sm text-slate-600">
          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>
            <strong>{inconnu.toLocaleString('fr-FR')} DAE</strong> ont un statut inconnu — données
            insuffisantes (batterie, électrodes ou maintenance non renseignées dans Synchroteam).
          </span>
        </div>
      )}
    </div>
  )
}
