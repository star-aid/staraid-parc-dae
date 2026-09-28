'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import BackButton from '@/components/BackButton'
import {
  Button, Card, EmptyState, PageContainer, PageHeader, cx, inputClass, selectClass,
  tableClass, tableWrapClass, tbodyClass, tdClass, thClass, theadClass, trClass,
} from '@/components/ui/primitives'
import {
  ANOMALY_LABELS,
  TERRITORY_LABELS,
  geodaeSheetUrl,
  toCsv,
  type AccountExtraction,
  type AnomalyType,
  type ExtractionResult,
  type GidCandidate,
  type JournalItem,
  type JournalSummary,
  type LocationDae,
  type LookupResult,
} from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

type RowFilter = 'all' | 'sans_geo' | 'sans_serie'
const PAGE_SIZE = 50

type LookupState =
  | { status: 'loading' }
  | { status: 'done'; result: LookupResult }
  | { status: 'error'; message: string }

const SOURCE_LABEL: Record<GidCandidate['source'], string> = {
  open_data:  'open data data.gouv.fr',
  geodae_api: 'API exploitants Géo’DAE',
}

const ANOMALY_CLASS: Record<AnomalyType, string> = {
  absent_geodae:             'bg-red-50 text-red-700 ring-red-600/20',
  ambigu:                    'bg-amber-50 text-amber-800 ring-amber-500/30',
  erreur_recherche:          'bg-slate-100 text-slate-600 ring-slate-300',
  divergence_id:             'bg-orange-50 text-orange-700 ring-orange-600/20',
  non_reference_synchroteam: 'bg-blue-50 text-blue-700 ring-blue-600/20',
}

function rowKey(r: LocationDae) {
  return `${r.account}-${r.synchroteam_id}`
}

/** Identifiant retenu quand la recherche a donné une correspondance unique */
function foundGid(state: LookupState | undefined): string | null {
  return state?.status === 'done' && state.result.candidates.length === 1 ? state.result.candidates[0].gid : null
}

/** Convertit une ligne et son résultat de recherche en élément de journal */
function toJournalItem(row: LocationDae, state: LookupState): JournalItem | null {
  if (state.status === 'loading') return null
  const base = {
    account: row.account,
    synchroteam_id: row.synchroteam_id,
    serial_number: row.serial_number,
    synchroteam_geo_dae_id: row.geo_dae_id,
  }
  if (state.status === 'error') return { ...base, outcome: 'error', candidates: [], error: state.message }
  const n = state.result.candidates.length
  return {
    ...base,
    outcome: n === 1 ? 'found' : n === 0 ? 'not_found' : 'ambiguous',
    candidates: state.result.candidates,
    sources: state.result.sources,
  }
}

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

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-3.5 w-3.5 animate-spin', className)} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

/** Lien vers la fiche du DAE sur le portail Géo'DAE */
function GidLink({ gid, className }: { gid: string; className?: string }) {
  return (
    <a
      href={geodaeSheetUrl(gid)}
      target="_blank"
      rel="noopener noreferrer"
      title="Ouvrir la fiche sur le portail Géo'DAE (connexion au portail requise)"
      className={cx('inline-flex items-center gap-1 rounded font-mono text-xs hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40', className)}
    >
      {gid}
      <ExternalIcon />
    </a>
  )
}

// ─── Cellule « identifiant manquant » : recherche et résultat ────────────────

function MissingGidCell({
  row, state, copied, onLookup, onCopy,
}: {
  row: LocationDae
  state: LookupState | undefined
  copied: boolean
  onLookup: () => void
  onCopy: (gid: string) => void
}) {
  const missingPill = (
    <span className="inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 text-2xs font-medium text-amber-800 ring-1 ring-inset ring-amber-500/30">
      à renseigner
    </span>
  )

  if (!row.serial_number) {
    return (
      <div className="flex flex-col gap-0.5">
        {missingPill}
        <span className="text-2xs italic text-slate-400">n° de série absent, recherche impossible</span>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="flex items-center gap-2">
        {missingPill}
        <Button variant="ghost" size="sm" onClick={onLookup} title="Chercher l’identifiant Géo’DAE à partir du n° de série">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          Rechercher
        </Button>
      </div>
    )
  }

  if (state.status === 'loading') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><SpinnerIcon />Recherche…</span>
  }

  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-700">Erreur : {state.message}</span>
        <Button variant="ghost" size="sm" onClick={onLookup}>Réessayer</Button>
      </div>
    )
  }

  const { candidates } = state.result

  if (candidates.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex rounded-md bg-red-50 px-1.5 py-0.5 text-2xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
          Introuvable dans Géo&apos;DAE
        </span>
        <Button variant="ghost" size="sm" onClick={onLookup} title="Relancer la recherche">Réessayer</Button>
      </div>
    )
  }

  if (candidates.length === 1) {
    const c = candidates[0]
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <GidLink gid={c.gid} className="font-semibold text-emerald-700" />
          <Button variant="ghost" size="sm" onClick={() => onCopy(c.gid)} title="Copier l’identifiant" className={copied ? 'text-emerald-700' : undefined}>
            {copied ? 'Copié' : 'Copier'}
          </Button>
        </div>
        <span className="max-w-[280px] truncate text-2xs text-slate-500" title={c.nom ?? undefined}>
          {c.nom ?? 'Sans nom'} · {SOURCE_LABEL[c.source]}
        </span>
        {c.etat_fonct && c.etat_fonct !== 'En fonctionnement' && (
          <span className="text-2xs font-medium text-amber-700">Déclaré « {c.etat_fonct} »</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs font-medium text-amber-700">{candidates.length} correspondances, à trancher</span>
      {candidates.slice(0, 3).map((c) => (
        <span key={c.gid} className="flex items-center gap-1.5 text-2xs text-slate-600">
          <GidLink gid={c.gid} className="text-slate-800" />
          <span className="max-w-[220px] truncate" title={c.nom ?? undefined}>{c.nom}</span>
          <Button variant="ghost" size="sm" onClick={() => onCopy(c.gid)} className="h-5 px-1.5 text-2xs">Copier</Button>
        </span>
      ))}
    </div>
  )
}

// ─── Journal des contrôles ───────────────────────────────────────────────────

function JournalCard({ journal, loading, message, onRefresh }: {
  journal: JournalSummary | null
  loading: boolean
  message: string | null
  onRefresh: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const lastRun = journal?.runs[0] ?? null
  const anomalies = journal?.open_anomalies ?? []
  const shown = showAll ? anomalies : anomalies.slice(0, 15)

  return (
    <Card
      title={<>Journal des contrôles{journal?.available && journal.open_total > 0 && <span className="ml-1.5 font-normal text-slate-400 tabular-nums">({journal.open_total} anomalie{journal.open_total > 1 ? 's' : ''} ouverte{journal.open_total > 1 ? 's' : ''})</span>}</>}
      actions={
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} title="Recharger le journal">
          <SpinnerIcon className={cx(!loading && 'animate-none')} />
          Actualiser
        </Button>
      }
      className="mb-4"
      padded={false}
    >
      {message && (
        <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-600">{message}</div>
      )}

      {!journal && loading && <div className="px-4 py-3 text-13 text-slate-400">Chargement du journal…</div>}

      {journal && !journal.available && (
        <div className="px-4 py-3 text-13 text-amber-800">
          <span className="font-medium">Journal non disponible.</span> {journal.reason}
          <br />
          <span className="text-xs text-amber-700">Les résultats de recherche s&apos;affichent normalement mais ne sont pas conservés tant que le journal n&apos;est pas disponible.</span>
        </div>
      )}

      {journal?.available && (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5 text-13 text-slate-600 tabular-nums">
            {lastRun ? (
              <span>
                Dernière recherche groupée le <span className="font-medium text-slate-800">{fmtDateTime(lastRun.started_at)}</span>
                {lastRun.triggered_by && <> par {lastRun.triggered_by}</>} :
                {' '}{lastRun.examined} examiné{lastRun.examined > 1 ? 's' : ''},
                {' '}<span className="text-emerald-700">{lastRun.found} trouvé{lastRun.found > 1 ? 's' : ''}</span>,
                {' '}<span className="text-red-700">{lastRun.not_found} introuvable{lastRun.not_found > 1 ? 's' : ''}</span>
                {lastRun.ambiguous > 0 && <>, <span className="text-amber-700">{lastRun.ambiguous} ambigu{lastRun.ambiguous > 1 ? 's' : ''}</span></>}
                {lastRun.errors > 0 && <>, {lastRun.errors} erreur{lastRun.errors > 1 ? 's' : ''}</>}
              </span>
            ) : (
              <span className="text-slate-400">Aucune recherche groupée enregistrée pour l&apos;instant.</span>
            )}
            <span className="ml-auto flex flex-wrap gap-1.5">
              {Object.entries(journal.open_by_type).map(([type, n]) => (
                <span key={type} className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset', ANOMALY_CLASS[type as AnomalyType])}>
                  {ANOMALY_LABELS[type as AnomalyType] ?? type} <span className="font-semibold">{n}</span>
                </span>
              ))}
            </span>
          </div>

          {anomalies.length > 0 && (
            <div className="overflow-x-auto border-t border-slate-100">
              <table className={tableClass}>
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Anomalie</th>
                    <th className={thClass}>Compte</th>
                    <th className={thClass}>N° série</th>
                    <th className={thClass}>Première détection</th>
                    <th className={thClass}>Dernière détection</th>
                    <th className={thClass}>Fiche</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {shown.map((a) => (
                    <tr key={a.id} className={trClass}>
                      <td className={tdClass}>
                        <span className={cx('inline-flex rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset', ANOMALY_CLASS[a.type])}>
                          {ANOMALY_LABELS[a.type] ?? a.type}
                        </span>
                      </td>
                      <td className={cx(tdClass, 'text-xs text-slate-600')}>{a.account ?? '—'}</td>
                      <td className={cx(tdClass, 'font-mono text-xs text-slate-800')}>{a.serial_number ?? '—'}</td>
                      <td className={cx(tdClass, 'text-xs text-slate-500 tabular-nums')}>{fmtDate(a.first_seen_at)}</td>
                      <td className={cx(tdClass, 'text-xs text-slate-500 tabular-nums')}>{fmtDate(a.last_seen_at)}</td>
                      <td className={cx(tdClass, 'text-xs')}>
                        {a.defibrillator_id
                          ? <Link href={`/parc/${a.defibrillator_id}`} className="font-medium text-brand hover:underline">Voir</Link>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {anomalies.length > 15 && (
                <div className="border-t border-slate-100 px-4 py-2 text-xs">
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
                    {showAll ? 'Réduire' : `Afficher les ${anomalies.length} anomalies`}
                  </button>
                  {journal.open_total > anomalies.length && <span className="ml-2 text-slate-400">({journal.open_total} au total, les 200 plus récentes sont listées)</span>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
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

  // Recherches d'identifiant (étape 2), par ligne
  const [lookups, setLookups] = useState<Record<string, LookupState>>({})
  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number } | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Journal des contrôles (tables de la migration 009)
  const [journal, setJournal] = useState<JournalSummary | null>(null)
  const [journalLoading, setJournalLoading] = useState(false)
  const [journalMsg, setJournalMsg] = useState<string | null>(null)

  async function loadJournal() {
    setJournalLoading(true)
    try {
      const res = await fetch('/api/geodae/journal', { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as (JournalSummary & { error?: string }) | null
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setJournal(body)
    } catch (err) {
      setJournal({ available: false, reason: err instanceof Error ? err.message : String(err), runs: [], open_by_type: {}, open_total: 0, open_anomalies: [] })
    } finally {
      setJournalLoading(false)
    }
  }

  // Le journal se charge à l'ouverture de la page : il a du sens même sans extraction
  useEffect(() => { loadJournal() }, [])

  async function persistJournal(items: JournalItem[], scope: string | null, createRun: boolean) {
    if (items.length === 0) return
    try {
      const res = await fetch('/api/geodae/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, scope, createRun }),
      })
      const body = (await res.json().catch(() => null)) as { persisted?: boolean; reason?: string; anomalies_upserted?: number; resolved?: number; error?: string } | null
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`)
      if (!body.persisted) {
        setJournalMsg(body.reason ?? 'Journal non enregistré.')
      } else if (createRun) {
        setJournalMsg(`Journal enregistré : ${body.anomalies_upserted ?? 0} anomalie${(body.anomalies_upserted ?? 0) > 1 ? 's' : ''} ouverte${(body.anomalies_upserted ?? 0) > 1 ? 's' : ''} ou mise${(body.anomalies_upserted ?? 0) > 1 ? 's' : ''} à jour, ${body.resolved ?? 0} clôturée${(body.resolved ?? 0) > 1 ? 's' : ''}.`)
      }
      await loadJournal()
    } catch (err) {
      setJournalMsg(`Journal non enregistré : ${err instanceof Error ? err.message : String(err)}`)
    }
  }

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
      setLookups({})
      setBulk(null)
      setPage(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  /** Recherche pour une ligne ; renvoie l'état final pour que l'appelant puisse le journaliser */
  async function lookupOne(row: LocationDae): Promise<LookupState | null> {
    if (!row.serial_number) return null
    const key = rowKey(row)
    setLookups((prev) => ({ ...prev, [key]: { status: 'loading' } }))
    let final: LookupState
    try {
      const res = await fetch(`/api/geodae/lookup?serial=${encodeURIComponent(row.serial_number)}`, { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as (LookupResult & { error?: string }) | null
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`)
      final = { status: 'done', result: body }
    } catch (err) {
      final = { status: 'error', message: err instanceof Error ? err.message : String(err) }
    }
    setLookups((prev) => ({ ...prev, [key]: final }))
    return final
  }

  /** Recherche unitaire depuis le bouton d'une ligne : journalisée sans ligne d'exécution */
  async function lookupSingle(row: LocationDae) {
    const state = await lookupOne(row)
    if (!state) return
    const item = toJournalItem(row, state)
    if (item) await persistJournal([item], null, false)
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

  // Lignes candidates à la recherche : sans identifiant mais avec un n° de série
  const missingTargets = useMemo(
    () => filtered.filter((r) => !r.geo_dae_id && r.serial_number && lookups[rowKey(r)]?.status !== 'done'),
    [filtered, lookups]
  )

  async function lookupMissing() {
    if (bulk?.running || missingTargets.length === 0) return
    const targets = [...missingTargets]
    setBulk({ running: true, done: 0, total: targets.length })
    setJournalMsg(null)
    const items: JournalItem[] = []
    for (let i = 0; i < targets.length; i++) {
      const state = await lookupOne(targets[i])
      if (state) {
        const item = toJournalItem(targets[i], state)
        if (item) items.push(item)
      }
      setBulk({ running: true, done: i + 1, total: targets.length })
      // Rythme mesuré pour rester courtois avec les API publiques
      await new Promise((r) => setTimeout(r, 120))
    }
    setBulk({ running: false, done: targets.length, total: targets.length })

    const scopeParts = [
      account === 'all' ? 'tous les comptes' : TERRITORY_LABELS[account],
      filter === 'sans_geo' ? 'filtre « sans identifiant »' : filter === 'sans_serie' ? 'filtre « sans n° de série »' : null,
      search.trim() ? `recherche « ${search.trim()} »` : null,
      `${targets.length} DAE`,
    ].filter(Boolean)
    await persistJournal(items, `Recherche groupée · ${scopeParts.join(' · ')}`, true)
  }

  async function copyGid(gid: string, key: string) {
    try {
      await navigator.clipboard.writeText(gid)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    } catch { /* presse-papiers indisponible : le lien reste sélectionnable */ }
  }

  // Bilan des recherches effectuées sur les lignes affichées
  const lookupSummary = useMemo(() => {
    let found = 0, ambiguous = 0, notFound = 0, errors = 0
    let apiStatus: string | null = null
    for (const r of filtered) {
      const st = lookups[rowKey(r)]
      if (!st) continue
      if (st.status === 'error') { errors++; continue }
      if (st.status !== 'done') continue
      apiStatus = st.result.sources.geodae_api
      const n = st.result.candidates.length
      if (n === 1) found++
      else if (n === 0) notFound++
      else ambiguous++
    }
    return { found, ambiguous, notFound, errors, total: found + ambiguous + notFound + errors, apiStatus }
  }, [filtered, lookups])

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

  // Export : les identifiants retrouvés partent dans une colonne dédiée
  const exportRows = () => filtered.map((r) => ({ ...r, found_geo_dae_id: foundGid(lookups[rowKey(r)]) }))

  return (
    <PageContainer>
      <PageHeader
        eyebrow={<BackButton label="Tableau de bord" />}
        title="Contrôle Géo'DAE"
        subtitle={<>Extraction Synchroteam des DAE <strong className="font-medium text-slate-700">actifs</strong> sous contrat de <strong className="font-medium text-slate-700">location</strong>, recherche des identifiants Géo&apos;DAE manquants à partir du n° de série, journal des anomalies.</>}
        actions={
          <>
            {result && (
              <Button variant="secondary" onClick={() => downloadCsv(exportRows())} disabled={filtered.length === 0}>
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

      {/* ── Journal des contrôles ──────────────────────────────────────────── */}
      <JournalCard journal={journal} loading={journalLoading} message={journalMsg} onRefresh={loadJournal} />

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

          {/* ── Recherche des identifiants manquants ────────────────────────── */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-card">
            <div className="min-w-0 flex-1 text-13 text-slate-600">
              <span className="font-medium text-slate-800">Identifiants manquants.</span>{' '}
              La recherche part du n° de série et interroge l&apos;open data Géo&apos;DAE de data.gouv.fr
              {lookupSummary.apiStatus === 'ok' ? ' et l’API exploitants Géo’DAE' : ''}. Les résultats sont journalisés.
              {lookupSummary.total > 0 && (
                <span className="ml-2 tabular-nums">
                  <span className="text-emerald-700">{lookupSummary.found} trouvé{lookupSummary.found > 1 ? 's' : ''}</span>
                  {lookupSummary.ambiguous > 0 && <> · <span className="text-amber-700">{lookupSummary.ambiguous} à trancher</span></>}
                  {lookupSummary.notFound > 0 && <> · <span className="text-red-700">{lookupSummary.notFound} introuvable{lookupSummary.notFound > 1 ? 's' : ''}</span></>}
                  {lookupSummary.errors > 0 && <> · <span className="text-red-700">{lookupSummary.errors} erreur{lookupSummary.errors > 1 ? 's' : ''}</span></>}
                </span>
              )}
              {lookupSummary.apiStatus && lookupSummary.apiStatus !== 'ok' && (
                <span className="ml-2 text-2xs text-slate-400">API exploitants : {lookupSummary.apiStatus}</span>
              )}
            </div>
            <Button
              variant="secondary"
              onClick={lookupMissing}
              disabled={bulk?.running || missingTargets.length === 0}
              title="Lance la recherche pour toutes les lignes affichées sans identifiant"
            >
              {bulk?.running
                ? <><SpinnerIcon />Recherche {bulk.done} / {bulk.total}</>
                : <>Rechercher les manquants ({missingTargets.length})</>}
            </Button>
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
                  {pageRows.map((r) => {
                    const key = rowKey(r)
                    return (
                      <tr key={key} className={trClass}>
                        <td className={cx(tdClass, 'text-xs font-medium text-slate-600')}>{r.account}</td>
                        <td className={cx(tdClass, 'font-mono text-xs font-medium text-slate-800')}>
                          {r.serial_number ?? <span className="font-sans font-medium text-red-700">manquant</span>}
                        </td>
                        <td className={cx(tdClass, 'text-slate-700')}>
                          {r.geo_dae_id
                            ? <GidLink gid={r.geo_dae_id} />
                            : (
                              <MissingGidCell
                                row={r}
                                state={lookups[key]}
                                copied={copiedKey === key}
                                onLookup={() => lookupSingle(r)}
                                onCopy={(gid) => copyGid(gid, key)}
                              />
                            )}
                        </td>
                        <td className={cx(tdClass, 'max-w-[200px] truncate text-slate-700')} title={r.customer_name ?? undefined}>{r.customer_name ?? '—'}</td>
                        <td className={cx(tdClass, 'max-w-[200px] truncate text-slate-700')} title={r.site_name ?? undefined}>{r.site_name ?? '—'}</td>
                        <td className={cx(tdClass, 'max-w-[220px] truncate text-slate-500')} title={r.name ?? undefined}>{r.name ?? '—'}</td>
                        <td className={cx(tdClass, 'text-xs text-slate-500')}>{r.contract_type}</td>
                        <td className={cx(tdClass, 'font-mono text-xs text-slate-400')}>{r.synchroteam_id}</td>
                      </tr>
                    )
                  })}
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
