'use client'

import { useMemo, useState } from 'react'
import BackButton from '@/components/BackButton'
import {
  TERRITORY_LABELS,
  toCsv,
  type AccountExtraction,
  type ExtractionResult,
  type LocationDae,
} from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

type RowFilter = 'all' | 'sans_geo' | 'sans_serie'
const PAGE_SIZE = 50

function downloadCsv(rows: LocationDae[]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `geodae-extraction-synchroteam-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

// ─── Carte de bilan par compte ───────────────────────────────────────────────

function AccountCard({ a }: { a: AccountExtraction }) {
  if (!a.configured) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
        <p className="font-semibold text-slate-500">{TERRITORY_LABELS[a.account]}</p>
        <p className="mt-1">Compte Synchroteam non configuré</p>
      </div>
    )
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <p className="font-semibold text-slate-800">{TERRITORY_LABELS[a.account]}</p>
        <span className="text-[11px] text-slate-400">{(a.duration_ms / 1000).toFixed(1)} s</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-slate-500">DAE actifs</dt>
        <dd className="text-right font-medium text-slate-700">{a.active_total}</dd>
        <dt className="text-slate-500">dont en location</dt>
        <dd className="text-right font-bold text-slate-900">{a.location_total}</dd>
        <dt className="text-slate-500">avec identifiant Géo&apos;DAE</dt>
        <dd className="text-right font-medium text-emerald-700">{a.with_geo_dae_id}</dd>
        <dt className="text-slate-500">sans identifiant Géo&apos;DAE</dt>
        <dd className={`text-right font-medium ${a.without_geo_dae_id > 0 ? 'text-amber-700' : 'text-slate-700'}`}>{a.without_geo_dae_id}</dd>
        <dt className="text-slate-500">sans n° de série</dt>
        <dd className={`text-right font-medium ${a.without_serial > 0 ? 'text-red-700' : 'text-slate-700'}`}>{a.without_serial}</dd>
      </dl>
      <p className="mt-3 text-[11px] text-slate-400">Mapping des champs : {a.mapping_source || '—'}</p>
      {a.missing_fields.length > 0 && (
        <p className="mt-1 text-xs text-red-600">Champs non résolus : {a.missing_fields.join(', ')}</p>
      )}
      {a.error && <p className="mt-1 text-xs text-amber-700">{a.error}</p>}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function GeodaeClient() {
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [account, setAccount] = useState<'all' | TerritoryCode>('all')
  const [filter, setFilter] = useState<RowFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/geodae/extract', { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setResult((await res.json()) as ExtractionResult)
      setPage(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!result) return []
    const q = search.trim().toLowerCase()
    return result.rows.filter((r) => {
      if (account !== 'all' && r.account !== account) return false
      if (filter === 'sans_geo' && r.geo_dae_id) return false
      if (filter === 'sans_serie' && r.serial_number) return false
      if (q) {
        const hay = [r.serial_number, r.geo_dae_id, r.customer_name, r.site_name, r.name, r.synchroteam_id]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [result, account, filter, search])

  // Types de contrat rencontrés, agrégés sur tous les comptes
  const contractTypes = useMemo(() => {
    if (!result) return []
    const m = new Map<string, { count: number; is_location: boolean }>()
    for (const a of result.accounts) {
      for (const t of a.contract_types_seen) {
        const prev = m.get(t.type)
        m.set(t.type, { count: (prev?.count ?? 0) + t.count, is_location: t.is_location })
      }
    }
    return Array.from(m, ([type, v]) => ({ type, ...v })).sort((a, b) => b.count - a.count)
  }, [result])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div className="p-6 lg:p-8 max-w-screen-xl mx-auto">
      <div className="mb-4">
        <BackButton label="Tableau de bord" />
      </div>

      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Contrôle Géo&apos;DAE</h1>
          <p className="text-sm text-slate-500 mt-1">
            Étape 1 · Extraction Synchroteam des DAE <strong>actifs</strong> sous contrat de <strong>location</strong>,
            avec identifiant interne, n° de série et identifiant Géo&apos;DAE.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {result && (
            <button
              onClick={() => downloadCsv(filtered)}
              disabled={filtered.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Exporter CSV ({filtered.length})
            </button>
          )}
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#AF2125] rounded-lg hover:bg-[#961d21] transition-colors shadow-sm disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {loading ? 'Interrogation de Synchroteam…' : result ? 'Relancer l’extraction' : 'Lancer l’extraction'}
          </button>
        </div>
      </div>

      {/* ── États ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          Échec de l&apos;extraction : {error}
        </div>
      )}
      {loading && (
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500 animate-pulse">
          Lecture des équipements et des contrats sur chaque compte Synchroteam. Cela peut prendre jusqu&apos;à une minute.
        </div>
      )}
      {!result && !loading && !error && (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
          Aucune extraction lancée. Cliquez sur <strong>Lancer l&apos;extraction</strong> pour interroger Synchroteam.
          <br />
          Les données proviennent de l&apos;API en direct, pas de la copie synchronisée chaque matin.
        </div>
      )}

      {result && !loading && (
        <>
          {result.warning && (
            <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-2.5">
              {result.warning}
            </div>
          )}

          {/* ── Bilan ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {result.accounts.map((a) => <AccountCard key={a.account} a={a} />)}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-600 mb-6">
            <span><strong className="text-slate-900">{result.totals.location_total}</strong> DAE actifs en location sur <strong>{result.totals.active_total}</strong> actifs</span>
            <span className="text-emerald-700"><strong>{result.totals.with_geo_dae_id}</strong> avec identifiant Géo&apos;DAE</span>
            <span className="text-amber-700"><strong>{result.totals.without_geo_dae_id}</strong> sans identifiant</span>
            <span className="text-red-700"><strong>{result.totals.without_serial}</strong> sans n° de série</span>
            <span className="text-slate-400 text-xs">Extraction du {fmtDateTime(result.extracted_at)}</span>
          </div>

          {/* ── Types de contrat rencontrés ─────────────────────────────── */}
          <details className="mb-6 bg-white border border-slate-200 rounded-xl">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 select-none">
              Types de contrat rencontrés sur les DAE actifs ({contractTypes.length})
              <span className="ml-2 text-xs text-slate-400 font-normal">— en vert, les valeurs comptées comme « location »</span>
            </summary>
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              {contractTypes.map((t) => (
                <span
                  key={t.type}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ring-1 ${
                    t.is_location ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-50 text-slate-600 ring-slate-200'
                  }`}
                >
                  {t.type}
                  <span className="font-semibold">{t.count}</span>
                </span>
              ))}
            </div>
          </details>

          {/* ── Filtres ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select
              value={account}
              onChange={(e) => { setAccount(e.target.value as 'all' | TerritoryCode); setPage(1) }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="all">Tous les comptes</option>
              {result.accounts.filter((a) => a.configured).map((a) => (
                <option key={a.account} value={a.account}>{TERRITORY_LABELS[a.account]}</option>
              ))}
            </select>
            <select
              value={filter}
              onChange={(e) => { setFilter(e.target.value as RowFilter); setPage(1) }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="all">Tous les DAE en location</option>
              <option value="sans_geo">Sans identifiant Géo&apos;DAE</option>
              <option value="sans_serie">Sans n° de série</option>
            </select>
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Rechercher : n° série, identifiant, client, site…"
              className="flex-1 min-w-[220px] text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
            />
            <span className="text-xs text-slate-500 ml-auto">{filtered.length} résultat{filtered.length > 1 ? 's' : ''}</span>
          </div>

          {/* ── Tableau ─────────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <th className="px-3 py-3">Compte</th>
                  <th className="px-3 py-3">N° série</th>
                  <th className="px-3 py-3">Identifiant Géo&apos;DAE</th>
                  <th className="px-3 py-3">Client</th>
                  <th className="px-3 py-3">Site</th>
                  <th className="px-3 py-3">Équipement</th>
                  <th className="px-3 py-3">Type de contrat</th>
                  <th className="px-3 py-3">ID Synchroteam</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Aucun DAE ne correspond aux filtres.</td></tr>
                )}
                {pageRows.map((r) => (
                  <tr key={`${r.account}-${r.synchroteam_id}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 text-xs font-medium text-slate-600">{r.account}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {r.serial_number ?? <span className="text-red-600 font-sans">manquant</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {r.geo_dae_id ?? <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-sans text-[11px]">à renseigner</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{r.customer_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.site_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500">{r.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">{r.contract_type}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{r.synchroteam_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ──────────────────────────────────────────────── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
              <span>Page {safePage} / {totalPages}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(Math.max(1, safePage - 1))}
                  disabled={safePage === 1}
                  className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  Précédent
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                  disabled={safePage === totalPages}
                  className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
