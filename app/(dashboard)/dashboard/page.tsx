import type { ReactNode } from 'react'
import { createServiceClient } from '@/lib/supabase'
import type { ParkSummary } from '@/types'
import StatusDonut from '@/components/dashboard/StatusDonut'
import TerritoryBars from '@/components/dashboard/TerritoryBars'
import InterventionsLine from '@/components/dashboard/InterventionsLine'
import NextExpirations from '@/components/dashboard/NextExpirations'

interface MonthlyRow {
  month: string
  total: number
  maintenance: number
  depannage: number
}

async function getDashboardData(): Promise<{
  summary: ParkSummary | null
  monthly: MonthlyRow[]
}> {
  try {
    const supabase = createServiceClient()
    const [summaryRes, monthlyRes] = await Promise.all([
      supabase.rpc('get_park_summary'),
      supabase.rpc('get_interventions_monthly', { p_months: 12 }),
    ])
    return {
      summary: summaryRes.data as ParkSummary | null,
      monthly: (monthlyRes.data ?? []) as MonthlyRow[],
    }
  } catch {
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
