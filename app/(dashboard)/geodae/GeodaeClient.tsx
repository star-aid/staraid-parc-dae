'use client'

import { useMemo, useState } from 'react'
import BackButton from '@/components/BackButton'
import {
  Button, Card, EmptyState, PageContainer, PageHeader, cx, inputClass, selectClass,
  tableClass, tableWrapClass, tbodyClass, tdClass, thClass, theadClass, trClass,
} from '@/components/ui/primitives'
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

function Metric({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'strong' | 'good' | 'warn' | 'bad' }) {
  const cls = {
    default: 'text-slate-700',
    strong:  'font-semibold text-slate-900',
    good:    'text-emerald-700',
    warn:    value > 0 ? 'text-amber-700' : 'text-slate-700',
    bad:     value > 0 ? 'text-red-700' : 'text-slate-700',
  }[tone]
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className={cx('text-right font-medium tabular-nums', cls)}>{value.toLocaleString('fr-FR')}</dd>
    </>
  )
}

function AccountCard({ a }: { a: AccountExtraction }) {
  if (!a.configured) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white/60 p-4 text-13 text-slate-400">
        <p className="font-semibold text-slate-500">{TERRITORY_LABELS[a.account]}</p>
        <p className="mt-1">Compte Synchroteam non configuré</p>
      </div>
    )
  }
  return (
    <Card
      title={TERRITORY_LABELS[a.account]}
      actions={<span className="text-2xs text-slate-400 tabular-nums">{(a.duration_ms / 1000).toFixed(1)} s</span>}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-13">
        <Metric label="DAE actifs" value={a.active_total} />
        <Metric label="dont en location" value={a.location_total} tone="strong" />
        <Metric label="avec identifiant Géo'DAE" value={a.with_geo_dae_id} tone="good" />
        <Metric label="sans identifiant Géo'DAE" value={a.without_geo_dae_id} tone="warn" />
        <Metric label="sans n° de série" value={a.without_serial} tone="bad" />
      </dl>
      <p className="mt-3 text-2xs text-slate-400">Mapping des champs : {a.mapping_source || '—'}</p>
      {a.missing_fields.length > 0 && (
        <p className="mt-1 text-xs text-red-700">Champs non résolus : {a.missing_fields.join(', ')}</p>
      )}
      {a.error && <p className="mt-1 text-xs text-amber-700">{a.error}</p>}
    </Card>
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
        const hay = [r.serial_number, r.geo_dae_id, r.customer_name, r.site_name, r.name, r.synchroteam_id].join(' ').toLowerCase()
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
    <PageContainer>
      <PageHeader
        eyebrow={<BackButton label="Tableau de bord" />}
        title="Contrôle Géo'DAE"
        subtitle={<>Étape 1 · Extraction Synchroteam des DAE <strong className="font-medium text-slate-700">actifs</strong> sous contrat de <strong className="font-medium text-slate-700">location</strong>, avec identifiant interne, n° de série et identifiant Géo&apos;DAE.</>}
        actions={
          <>
            {result && (
              <Button variant="secondary" onClick={() => downloadCsv(filtered)} disabled={filtered.length === 0}>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Exporter CSV ({filtered.length})
              </Button>
            )}
            <Button variant="primary" onClick={run} disabled={loading}>
              <svg viewBox="0 0 24 24" className={cx('h-3.5 w-3.5', loading && 'animate-spin')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {loading ? 'Interrogation de Synchroteam…' : result ? 'Relancer l’extraction' : 'Lancer l’extraction'}
            </Button>
          </>
        }
      />

      {/* ── États ─────────────────────────────────────────────────────────── */}
      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-13 text-red-700">
          Échec de l&apos;extraction : {error}
        </div>
      )}
      {loading && (
        <div className="mb-4 animate-pulse rounded-lg border border-slate-200 bg-white p-6 text-13 text-slate-500 shadow-card">
          Lecture des équipements et des contrats sur chaque compte Synchroteam. Cela peut prendre jusqu&apos;à une minute.
        </div>
      )}
      {!result && !loading && !error && (
        <EmptyState className="rounded-lg border border-dashed border-slate-300 bg-white/60 py-12">
          Aucune extraction lancée. Cliquez sur <strong className="font-medium text-slate-600">Lancer l&apos;extraction</strong> pour interroger Synchroteam.
          <br />
          <span className="text-xs">Les données viennent de l&apos;API en direct, pas de la copie synchronisée chaque matin.</span>
        </EmptyState>
      )}

      {result && !loading && (
        <>
          {result.warning && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{result.warning}</div>
          )}

          {/* ── Bilan ───────────────────────────────────────────────────────── */}
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {result.accounts.map((a) => <AccountCard key={a.account} a={a} />)}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-13 text-slate-600 tabular-nums">
            <span><strong className="font-semibold text-slate-900">{result.totals.location_total}</strong> DAE actifs en location sur <strong className="font-medium">{result.totals.active_total}</strong> actifs</span>
            <span className="text-emerald-700"><strong className="font-semibold">{result.totals.with_geo_dae_id}</strong> avec identifiant</span>
            <span className="text-amber-700"><strong className="font-semibold">{result.totals.without_geo_dae_id}</strong> sans identifiant</span>
            <span className="text-red-700"><strong className="font-semibold">{result.totals.without_serial}</strong> sans n° de série</span>
            <span className="text-2xs text-slate-400">Extraction du {fmtDateTime(result.extracted_at)}</span>
          </div>

          {/* ── Types de contrat rencontrés ─────────────────────────────────── */}
          <details className="mb-4 rounded-lg border border-slate-200 bg-white shadow-card">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-13 font-medium text-slate-700">
              Types de contrat rencontrés sur les DAE actifs ({contractTypes.length})
              <span className="ml-2 text-xs font-normal text-slate-400">en vert, les valeurs comptées comme « location »</span>
            </summary>
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-4 py-3">
              {contractTypes.map((t) => (
                <span
                  key={t.type}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs ring-1 ring-inset tabular-nums',
                    t.is_location ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-slate-50 text-slate-600 ring-slate-200'
                  )}
                >
                  {t.type}
                  <span className="font-semibold">{t.count}</span>
                </span>
              ))}
            </div>
          </details>

          {/* ── Filtres ─────────────────────────────────────────────────────── */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={account} onChange={(e) => { setAccount(e.target.value as 'all' | TerritoryCode); setPage(1) }} className={selectClass} aria-label="Compte">
              <option value="all">Tous les comptes</option>
              {result.accounts.filter((a) => a.configured).map((a) => (
                <option key={a.account} value={a.account}>{TERRITORY_LABELS[a.account]}</option>
              ))}
            </select>
            <select value={filter} onChange={(e) => { setFilter(e.target.value as RowFilter); setPage(1) }} className={selectClass} aria-label="Filtre">
              <option value="all">Tous les DAE en location</option>
              <option value="sans_geo">Sans identifiant Géo&apos;DAE</option>
              <option value="sans_serie">Sans n° de série</option>
            </select>
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="N° série, identifiant, client, site…"
              aria-label="Rechercher"
              className={cx(inputClass, 'w-72')}
            />
            <span className="ml-auto text-xs text-slate-500 tabular-nums">{filtered.length} résultat{filtered.length > 1 ? 's' : ''}</span>
          </div>

          {/* ── Tableau ─────────────────────────────────────────────────────── */}
          <div className={cx(tableWrapClass, 'overflow-hidden')}>
            <div className="overflow-x-auto">
              <table className={cx(tableClass, 'min-w-full w-max')}>
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Compte</th>
                    <th className={thClass}>N° série</th>
                    <th className={thClass}>Identifiant Géo&apos;DAE</th>
                    <th className={thClass}>Client</th>
                    <th className={thClass}>Site</th>
                    <th className={thClass}>Équipement</th>
                    <th className={thClass}>Type de contrat</th>
                    <th className={thClass}>ID Synchroteam</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {pageRows.length === 0 && (
                    <tr><td colSpan={8}><EmptyState>Aucun DAE ne correspond aux filtres.</EmptyState></td></tr>
                  )}
                  {pageRows.map((r) => (
                    <tr key={`${r.account}-${r.synchroteam_id}`} className={trClass}>
                      <td className={cx(tdClass, 'text-xs font-medium text-slate-600')}>{r.account}</td>
                      <td className={cx(tdClass, 'font-mono text-xs font-medium text-slate-800')}>
                        {r.serial_number ?? <span className="font-sans font-medium text-red-700">manquant</span>}
                      </td>
                      <td className={cx(tdClass, 'font-mono text-xs text-slate-700')}>
                        {r.geo_dae_id ?? <span className="inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 font-sans text-2xs font-medium text-amber-800 ring-1 ring-inset ring-amber-500/30">à renseigner</span>}
                      </td>
                      <td className={cx(tdClass, 'max-w-[200px] truncate text-slate-700')} title={r.customer_name ?? undefined}>{r.customer_name ?? '—'}</td>
                      <td className={cx(tdClass, 'max-w-[200px] truncate text-slate-700')} title={r.site_name ?? undefined}>{r.site_name ?? '—'}</td>
                      <td className={cx(tdClass, 'max-w-[220px] truncate text-slate-500')} title={r.name ?? undefined}>{r.name ?? '—'}</td>
                      <td className={cx(tdClass, 'text-xs text-slate-500')}>{r.contract_type}</td>
                      <td className={cx(tdClass, 'font-mono text-xs text-slate-400')}>{r.synchroteam_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-xs text-slate-500">
                <span className="tabular-nums">Page {safePage} / {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="secondary" size="sm" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>Précédent</Button>
                  <Button variant="secondary" size="sm" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}>Suivant</Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </PageContainer>
  )
}
