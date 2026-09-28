'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import BackButton from '@/components/BackButton'
import {
  Button, Card, EmptyState, PageContainer, PageHeader, Tabs, buttonClass, cx, inputClass, selectClass,
  tableClass, tableWrapClass, tbodyClass, tdClass, thClass, theadClass, trClass,
} from '@/components/ui/primitives'
import {
  ANOMALY_LABELS,
  TERRITORY_LABELS,
  geodaeSheetUrl,
  outcomeOf,
  sourcesFailureMessage,
  toCsv,
  type AccountExtraction,
  type AnomalyType,
  type ExtractionResult,
  type GidCandidate,
  type JournalItem,
  type JournalRun,
  type JournalSummary,
  type LocationDae,
  type LookupResult,
} from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

type RowFilter = 'all' | 'sans_geo' | 'sans_serie'
const PAGE_SIZE = 50

/** Résultat de recherche d'une ligne ; checked_* renseignés quand il vient de la base */
type LookupState =
  | { status: 'loading' }
  | { status: 'done'; result: LookupResult; checked_at?: string; checked_by?: string | null }
  | { status: 'error'; message: string; checked_at?: string; checked_by?: string | null }

/** Report d'un identifiant dans Synchroteam, par ligne */
type WritebackState =
  | { status: 'confirm'; gid: string }
  | { status: 'writing'; gid: string }
  | { status: 'done'; gid: string; verified: boolean }
  | { status: 'error'; gid: string; message: string }

/** Réponse de POST /api/geodae/writeback (succès, refus 409 ou erreur) */
type WritebackResponse = {
  ok?: boolean
  verified?: boolean
  already_set?: boolean
  error?: string
  journal?: { persisted: boolean; reason?: string; resolved: number }
}

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

/** Après un report réussi : la ligne porte l'identifiant et les compteurs suivent */
function applyWrittenGid(result: ExtractionResult, row: LocationDae, gid: string): ExtractionResult {
  const key = rowKey(row)
  const shift = <T extends { with_geo_dae_id: number; without_geo_dae_id: number }>(o: T): T => ({
    ...o,
    with_geo_dae_id: o.with_geo_dae_id + 1,
    without_geo_dae_id: Math.max(0, o.without_geo_dae_id - 1),
  })
  return {
    ...result,
    rows: result.rows.map((r) => (rowKey(r) === key ? { ...r, geo_dae_id: gid } : r)),
    totals: shift(result.totals),
    accounts: result.accounts.map((a) => (a.account === row.account ? shift(a) : a)),
  }
}

/** Résultats conservés en base (brique 2) → même état que juste après une recherche */
function seedLookups(rows: LocationDae[]): Record<string, LookupState> {
  const seeded: Record<string, LookupState> = {}
  for (const r of rows) {
    const l = r.lookup
    if (!l) continue
    seeded[rowKey(r)] = l.status === 'erreur'
      ? { status: 'error', message: l.error ?? 'erreur inconnue', checked_at: l.checked_at, checked_by: l.checked_by }
      : {
          status: 'done',
          result: {
            serial: r.serial_number ?? '',
            candidates: l.candidates,
            sources: l.sources ?? { open_data: 'inconnu', geodae_api: 'inconnu' },
          },
          checked_at: l.checked_at,
          checked_by: l.checked_by,
        }
  }
  return seeded
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
  const outcome = outcomeOf(state.result)
  return {
    ...base,
    outcome,
    candidates: state.result.candidates,
    sources: state.result.sources,
    error: outcome === 'error' ? sourcesFailureMessage(state.result) : null,
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

/** Icône « actualiser » fixe ; le SpinnerIcon la remplace pendant un chargement */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
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

// ─── Report dans Synchroteam : bouton, confirmation, état ────────────────────

function WriteControls({ gid, writeback, compact, onRequest, onConfirm, onCancel }: {
  gid: string
  writeback: WritebackState | undefined
  compact?: boolean
  onRequest: (gid: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const small = compact ? 'h-5 px-1.5 text-2xs' : undefined
  if (writeback && writeback.gid === gid) {
    if (writeback.status === 'writing') {
      return <span className="inline-flex items-center gap-1 text-2xs text-slate-500"><SpinnerIcon className="h-3 w-3" />Report dans Synchroteam…</span>
    }
    if (writeback.status === 'confirm') {
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="text-2xs font-medium text-slate-700">Écrire {gid} dans Synchroteam ?</span>
          <Button variant="primary" size="sm" onClick={onConfirm} className={small}>Confirmer</Button>
          <Button variant="ghost" size="sm" onClick={onCancel} className={small}>Annuler</Button>
        </span>
      )
    }
    if (writeback.status === 'error') {
      return (
        <span className="inline-flex max-w-[340px] items-center gap-1 text-2xs text-red-700">
          <span className="truncate" title={writeback.message}>Échec : {writeback.message}</span>
          <Button variant="ghost" size="sm" onClick={() => onRequest(gid)} className={small}>Réessayer</Button>
        </span>
      )
    }
  }
  return (
    <Button
      variant={compact ? 'ghost' : 'secondary'}
      size="sm"
      onClick={() => onRequest(gid)}
      title="Écrire cet identifiant dans le champ « Identifiant Géo'DAE » de l'équipement Synchroteam (après confirmation)"
      className={small}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      Reporter dans Synchroteam
    </Button>
  )
}

// ─── Cellule « identifiant manquant » : recherche et résultat ────────────────

function MissingGidCell({
  row, state, writeback, copied, onLookup, onCopy, onWriteRequest, onWriteConfirm, onWriteCancel,
}: {
  row: LocationDae
  state: LookupState | undefined
  writeback: WritebackState | undefined
  copied: boolean
  onLookup: () => void
  onCopy: (gid: string) => void
  onWriteRequest: (gid: string) => void
  onWriteConfirm: () => void
  onWriteCancel: () => void
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

  // Provenance du résultat quand il vient de la base (contrôle antérieur)
  const checked = state.checked_at ? (
    <span className="text-2xs text-slate-400">
      Contrôlé le {fmtDateTime(state.checked_at)}{state.checked_by ? ` par ${state.checked_by}` : ''}
    </span>
  ) : null

  if (state.status === 'error') {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-red-700">Erreur : {state.message}</span>
          <Button variant="ghost" size="sm" onClick={onLookup}>Réessayer</Button>
        </div>
        {checked}
      </div>
    )
  }

  const { candidates } = state.result

  // Aucune correspondance et aucune source n'a répondu : ce n'est pas un « introuvable »
  if (outcomeOf(state.result) === 'error') {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="max-w-[320px] truncate text-xs text-red-700" title={sourcesFailureMessage(state.result)}>Sources injoignables</span>
          <Button variant="ghost" size="sm" onClick={onLookup}>Réessayer</Button>
        </div>
        {checked}
      </div>
    )
  }

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex rounded-md bg-red-50 px-1.5 py-0.5 text-2xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
            Introuvable dans Géo&apos;DAE
          </span>
          <Button variant="ghost" size="sm" onClick={onLookup} title="Relancer la recherche">Réessayer</Button>
        </div>
        {checked}
      </div>
    )
  }

  if (candidates.length === 1) {
    const c = candidates[0]
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <GidLink gid={c.gid} className="font-semibold text-emerald-700" />
          <Button variant="ghost" size="sm" onClick={() => onCopy(c.gid)} title="Copier l’identifiant" className={copied ? 'text-emerald-700' : undefined}>
            {copied ? 'Copié' : 'Copier'}
          </Button>
          <WriteControls gid={c.gid} writeback={writeback} onRequest={onWriteRequest} onConfirm={onWriteConfirm} onCancel={onWriteCancel} />
        </div>
        <span className="max-w-[280px] truncate text-2xs text-slate-500" title={c.nom ?? undefined}>
          {c.nom ?? 'Sans nom'} · {SOURCE_LABEL[c.source]}
        </span>
        {c.etat_fonct && c.etat_fonct !== 'En fonctionnement' && (
          <span className="text-2xs font-medium text-amber-700">Déclaré « {c.etat_fonct} »</span>
        )}
        {checked}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs font-medium text-amber-700">{candidates.length} correspondances, à trancher</span>
      {candidates.slice(0, 3).map((c) => (
        <span key={c.gid} className="flex flex-wrap items-center gap-1.5 text-2xs text-slate-600">
          <GidLink gid={c.gid} className="text-slate-800" />
          <span className="max-w-[220px] truncate" title={c.nom ?? undefined}>{c.nom}</span>
          <Button variant="ghost" size="sm" onClick={() => onCopy(c.gid)} className="h-5 px-1.5 text-2xs">Copier</Button>
          <WriteControls gid={c.gid} writeback={writeback} compact onRequest={onWriteRequest} onConfirm={onWriteConfirm} onCancel={onWriteCancel} />
        </span>
      ))}
      {checked}
    </div>
  )
}

// ─── Journal des contrôles : anomalies et historique ─────────────────────────

/** Vrai si l'exécution est un rapprochement complet (point 3) et non un lot de recherches */
function isReconcileRun(run: JournalRun): boolean {
  return (run.sources as { kind?: string } | null | undefined)?.kind === 'reconcile'
}

/** Encadré commun quand le journal n'est pas disponible (migrations 009 / 010) */
function JournalUnavailable({ journal, loading }: { journal: JournalSummary | null; loading: boolean }) {
  if (!journal && loading) return <div className="px-4 py-3 text-13 text-slate-400">Chargement du journal…</div>
  if (journal && !journal.available) {
    return (
      <div className="px-4 py-3 text-13 text-amber-800">
        <span className="font-medium">Journal non disponible.</span> {journal.reason}
        <br />
        <span className="text-xs text-amber-700">Les résultats de recherche s&apos;affichent normalement mais ne sont pas conservés tant que le journal n&apos;est pas disponible.</span>
      </div>
    )
  }
  return null
}

const ANOMALIES_PAGE = 50

/** Onglet « Anomalies » : rapport du point 3, filtrable par type, export CSV, clôture manuelle */
function AnomaliesPanel({ journal, loading, onRefresh, onReconcile, reconciling, onResolve }: {
  journal: JournalSummary | null
  loading: boolean
  onRefresh: () => void
  /** Lance le rapprochement complet Synchroteam ↔ Géo'DAE */
  onReconcile: () => void
  reconciling: boolean
  /** Clôture manuelle d'une anomalie, avec motif */
  onResolve: (id: string, comment: string) => Promise<void>
}) {
  const [showAll, setShowAll] = useState(false)
  const [typeFilter, setTypeFilter] = useState<AnomalyType | 'all'>('all')
  const [resolving, setResolving] = useState<{ id: string; text: string } | null>(null)
  const lastReconcile = journal?.runs.find(isReconcileRun) ?? null
  const reconcileCounts = (lastReconcile?.sources ?? {}) as { divergence?: number; absent?: number; non_reference?: number }
  const allAnomalies = journal?.open_anomalies ?? []
  const anomalies = typeFilter === 'all' ? allAnomalies : allAnomalies.filter((a) => a.type === typeFilter)
  const shown = showAll ? anomalies : anomalies.slice(0, ANOMALIES_PAGE)

  return (
    <Card padded={false}>
      <JournalUnavailable journal={journal} loading={loading} />

      {journal?.available && (
        <>
          {/* Barre d'outils : filtre par type à gauche, actions à droite */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => { setTypeFilter('all'); setShowAll(false) }}
                className={cx(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset transition-colors',
                  typeFilter === 'all' ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                )}
              >
                Toutes <span className="font-semibold tabular-nums">{journal.open_total}</span>
              </button>
              {Object.entries(journal.open_by_type).map(([type, n]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setTypeFilter(typeFilter === type ? 'all' : (type as AnomalyType)); setShowAll(false) }}
                  title={typeFilter === type ? 'Afficher tous les types' : 'Ne montrer que ce type'}
                  className={cx(
                    'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset transition-shadow',
                    ANOMALY_CLASS[type as AnomalyType],
                    typeFilter === type ? 'ring-2 ring-offset-1' : typeFilter !== 'all' ? 'opacity-50' : ''
                  )}
                >
                  {ANOMALY_LABELS[type as AnomalyType] ?? type} <span className="font-semibold tabular-nums">{n}</span>
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <a href="/api/geodae/anomalies?format=csv" className={buttonClass('ghost', 'sm')} title="Exporter toutes les anomalies ouvertes (CSV)">
                Exporter CSV
              </a>
              <Button
                variant="secondary"
                size="sm"
                onClick={onReconcile}
                disabled={reconciling || loading}
                title="Compare les DAE Synchroteam en location et les DAE Géo'DAE déclarés sous le SIREN STAR : divergences, absents, non référencés. Fait chaque matin par le cron."
              >
                {reconciling ? <SpinnerIcon /> : null}
                {reconciling ? 'Rapprochement…' : 'Rapprocher maintenant'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} title="Recharger le journal">
                {loading ? <SpinnerIcon /> : <RefreshIcon />}
                Actualiser
              </Button>
            </div>
          </div>

          <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-600 tabular-nums">
            {lastReconcile ? (
              <span>
                Dernier rapprochement Synchroteam ↔ Géo&apos;DAE le <span className="font-medium text-slate-800">{fmtDateTime(lastReconcile.started_at)}</span>
                {lastReconcile.triggered_by && <> par {lastReconcile.triggered_by}</>} :
                {' '}{lastReconcile.examined} DAE en location, {lastReconcile.found} apparié{lastReconcile.found > 1 ? 's' : ''},
                {' '}<span className="text-orange-700">{reconcileCounts.divergence ?? 0} divergent{(reconcileCounts.divergence ?? 0) > 1 ? 's' : ''}</span>,
                {' '}<span className="text-red-700">{reconcileCounts.absent ?? 0} absent{(reconcileCounts.absent ?? 0) > 1 ? 's' : ''} de Géo&apos;DAE</span>,
                {' '}<span className="text-blue-700">{reconcileCounts.non_reference ?? 0} non référencé{(reconcileCounts.non_reference ?? 0) > 1 ? 's' : ''} dans Synchroteam</span>
              </span>
            ) : (
              <span className="text-slate-400">Aucun rapprochement complet enregistré : il a lieu chaque matin, ou via « Rapprocher maintenant ».</span>
            )}
          </div>

          {anomalies.length === 0 ? (
            <EmptyState>{typeFilter === 'all' ? 'Aucune anomalie ouverte.' : 'Aucune anomalie ouverte de ce type.'}</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Anomalie</th>
                    <th className={thClass}>Compte</th>
                    <th className={thClass}>N° série</th>
                    <th className={thClass}>Id Synchroteam</th>
                    <th className={thClass}>Id Géo&apos;DAE</th>
                    <th className={thClass}>Détail</th>
                    <th className={thClass}>Première</th>
                    <th className={thClass}>Dernière</th>
                    <th className={thClass}>Fiche</th>
                    <th className={thClass}></th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {shown.map((a) => {
                    const d = (a.details ?? {}) as { reason?: string; presence?: string }
                    const detail = [d.reason, d.presence].filter(Boolean).join(' · ')
                    const editing = resolving?.id === a.id
                    return (
                      <tr key={a.id} className={trClass}>
                        <td className={tdClass}>
                          <span className={cx('inline-flex rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset', ANOMALY_CLASS[a.type])}>
                            {ANOMALY_LABELS[a.type] ?? a.type}
                          </span>
                        </td>
                        <td className={cx(tdClass, 'text-xs text-slate-600')}>{a.account ?? '—'}</td>
                        <td className={cx(tdClass, 'font-mono text-xs text-slate-800')}>{a.serial_number ?? '—'}</td>
                        <td className={tdClass}>{a.synchroteam_geo_dae_id ? <GidLink gid={a.synchroteam_geo_dae_id} /> : <span className="text-slate-300">—</span>}</td>
                        <td className={tdClass}>{a.geodae_gid ? <GidLink gid={a.geodae_gid} /> : <span className="text-slate-300">—</span>}</td>
                        <td className={cx(tdClass, 'max-w-[280px] truncate text-xs text-slate-500')} title={detail || undefined}>{detail || '—'}</td>
                        <td className={cx(tdClass, 'text-xs text-slate-500 tabular-nums')}>{fmtDate(a.first_seen_at)}</td>
                        <td className={cx(tdClass, 'text-xs text-slate-500 tabular-nums')}>{fmtDate(a.last_seen_at)}</td>
                        <td className={cx(tdClass, 'text-xs')}>
                          {a.defibrillator_id
                            ? <Link href={`/parc/${a.defibrillator_id}`} className="font-medium text-brand hover:underline">Voir</Link>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={cx(tdClass, 'text-xs')}>
                          {editing ? (
                            <span className="flex items-center gap-1">
                              <input
                                autoFocus
                                value={resolving.text}
                                onChange={(e) => setResolving({ id: a.id, text: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Escape') setResolving(null) }}
                                placeholder="Motif de clôture"
                                aria-label="Motif de clôture"
                                className={cx(inputClass, 'h-6 w-44 text-2xs')}
                              />
                              <Button variant="primary" size="sm" className="h-6 px-1.5 text-2xs" disabled={!resolving.text.trim()} onClick={() => onResolve(a.id, resolving.text.trim()).then(() => setResolving(null))}>Clore</Button>
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-2xs" onClick={() => setResolving(null)}>Annuler</Button>
                            </span>
                          ) : (
                            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-2xs" onClick={() => setResolving({ id: a.id, text: '' })} title="Clôturer manuellement une anomalie traitée hors outil (déclaration faite sur le portail, DAE désactivé…)">
                              Clore
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {anomalies.length > ANOMALIES_PAGE && (
                <div className="border-t border-slate-100 px-4 py-2 text-xs">
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
                    {showAll ? 'Réduire' : `Afficher les ${anomalies.length} anomalies`}
                  </button>
                  {journal.open_total > allAnomalies.length && <span className="ml-2 text-slate-400">({journal.open_total} au total, les 200 plus récentes sont listées ; l&apos;export CSV les contient toutes)</span>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/** Onglet « Historique » : exécutions (recherches, rapprochements) et reports dans Synchroteam */
function HistoryPanel({ journal, loading, onRefresh }: {
  journal: JournalSummary | null
  loading: boolean
  onRefresh: () => void
}) {
  const runs = journal?.runs ?? []
  const writebacks = journal?.writebacks ?? []
  const pill = (cls: string, text: string) => (
    <span className={cx('inline-flex rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset', cls)}>{text}</span>
  )

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Dernières exécutions"
        actions={
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} title="Recharger le journal">
            {loading ? <SpinnerIcon /> : <RefreshIcon />}
            Actualiser
          </Button>
        }
        padded={false}
      >
        <JournalUnavailable journal={journal} loading={loading} />
        {journal?.available && (runs.length === 0 ? (
          <EmptyState>Aucune exécution enregistrée pour l&apos;instant.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>Nature</th>
                  <th className={thClass}>Déclencheur</th>
                  <th className={thClass}>Périmètre</th>
                  <th className={thClass}>Résultat</th>
                </tr>
              </thead>
              <tbody className={tbodyClass}>
                {runs.map((r) => {
                  const reconcile = isReconcileRun(r)
                  const c = (r.sources ?? {}) as { divergence?: number; absent?: number; non_reference?: number }
                  return (
                    <tr key={r.id} className={trClass}>
                      <td className={cx(tdClass, 'text-xs text-slate-500 tabular-nums')}>{fmtDateTime(r.started_at)}</td>
                      <td className={tdClass}>
                        {reconcile
                          ? pill('bg-blue-50 text-blue-700 ring-blue-600/20', 'Rapprochement')
                          : pill('bg-slate-100 text-slate-700 ring-slate-300', 'Recherche')}
                      </td>
                      <td className={cx(tdClass, 'text-xs text-slate-600')}>{r.triggered_by ?? '—'}</td>
                      <td className={cx(tdClass, 'max-w-[360px] truncate text-xs text-slate-500')} title={r.scope ?? undefined}>{r.scope ?? '—'}</td>
                      <td className={cx(tdClass, 'text-xs text-slate-600 tabular-nums')}>
                        {reconcile ? (
                          <>
                            {r.examined} DAE, {r.found} apparié{r.found > 1 ? 's' : ''},
                            {' '}<span className="text-orange-700">{c.divergence ?? 0} divergent{(c.divergence ?? 0) > 1 ? 's' : ''}</span>,
                            {' '}<span className="text-red-700">{c.absent ?? 0} absent{(c.absent ?? 0) > 1 ? 's' : ''}</span>,
                            {' '}<span className="text-blue-700">{c.non_reference ?? 0} non référencé{(c.non_reference ?? 0) > 1 ? 's' : ''}</span>
                          </>
                        ) : (
                          <>
                            {r.examined} examiné{r.examined > 1 ? 's' : ''},
                            {' '}<span className="text-emerald-700">{r.found} trouvé{r.found > 1 ? 's' : ''}</span>,
                            {' '}<span className="text-red-700">{r.not_found} introuvable{r.not_found > 1 ? 's' : ''}</span>
                            {r.ambiguous > 0 && <>, <span className="text-amber-700">{r.ambiguous} ambigu{r.ambiguous > 1 ? 's' : ''}</span></>}
                            {r.errors > 0 && <>, {r.errors} erreur{r.errors > 1 ? 's' : ''}</>}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </Card>

      <Card
        title={<>Reports dans Synchroteam{journal?.available && journal.writebacks_total > 0 && <span className="ml-1.5 font-normal text-slate-400 tabular-nums">({journal.writebacks_total} au total, {writebacks.length} dernier{writebacks.length > 1 ? 's' : ''} affiché{writebacks.length > 1 ? 's' : ''})</span>}</>}
        padded={false}
      >
        {journal?.available && journal.writebacks_reason && (
          <div className="px-4 py-2 text-xs text-amber-800">Reports non tracés. {journal.writebacks_reason}</div>
        )}
        {journal?.available && !journal.writebacks_reason && (writebacks.length === 0 ? (
          <EmptyState>Aucun report effectué pour l&apos;instant.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>Compte</th>
                  <th className={thClass}>N° série</th>
                  <th className={thClass}>Identifiant écrit</th>
                  <th className={thClass}>Par</th>
                  <th className={thClass}>Résultat</th>
                </tr>
              </thead>
              <tbody className={tbodyClass}>
                {writebacks.map((w) => (
                  <tr key={w.id} className={trClass}>
                    <td className={cx(tdClass, 'text-xs text-slate-500 tabular-nums')}>{fmtDateTime(w.written_at)}</td>
                    <td className={cx(tdClass, 'text-xs text-slate-600')}>{w.account ?? '—'}</td>
                    <td className={cx(tdClass, 'font-mono text-xs text-slate-800')}>{w.serial_number ?? '—'}</td>
                    <td className={tdClass}><GidLink gid={w.geodae_gid} /></td>
                    <td className={cx(tdClass, 'text-xs text-slate-600')}>{w.written_by ?? '—'}</td>
                    <td className={cx(tdClass, 'text-xs')}>
                      {w.status === 'ok'
                        ? <span className="text-emerald-700">{w.verified ? 'Écrit et vérifié' : 'Écrit, relecture non confirmée'}</span>
                        : <span className="text-red-700" title={w.error ?? undefined}>Échec{w.error ? ` : ${w.error}` : ''}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Card>
    </div>
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
      <p className="mt-3 text-2xs text-slate-400">
        {a.synced_at ? <>Synchronisé le {fmtDateTime(a.synced_at)}</> : <>Mapping des champs : {a.mapping_source || '—'}</>}
      </p>
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

  // Reports dans Synchroteam (étape 2) : par ligne, et en lot pour les correspondances uniques
  const [writebacks, setWritebacks] = useState<Record<string, WritebackState>>({})
  const [bulkWrite, setBulkWrite] = useState<{ running: boolean; done: number; total: number } | null>(null)
  const [bulkWriteConfirm, setBulkWriteConfirm] = useState(false)
  const [writeMsg, setWriteMsg] = useState<string | null>(null)

  // Actualisation à la demande : synchronisation Synchroteam → Supabase puis rechargement
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // Contrôle automatique (brique 3) lancé à la main : un seul lot, comme le cron
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoMsg, setAutoMsg] = useState<string | null>(null)

  // Rapprochement complet (point 3) lancé à la main
  const [reconciling, setReconciling] = useState(false)

  // Onglet affiché : liste de travail des DAE, rapport d'anomalies, ou historique
  const [tab, setTab] = useState<'dae' | 'anomalies' | 'journal'>('dae')

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
      setJournal({ available: false, reason: err instanceof Error ? err.message : String(err), runs: [], open_by_type: {}, open_total: 0, open_anomalies: [], writebacks: [], writebacks_total: 0 })
    } finally {
      setJournalLoading(false)
    }
  }

  // À l'ouverture : la copie Supabase (immédiate) et le journal
  useEffect(() => { load(); loadJournal() }, [])

  async function persistJournal(items: JournalItem[], scope: string | null, createRun: boolean) {
    if (items.length === 0) return
    try {
      const res = await fetch('/api/geodae/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, scope, createRun }),
      })
      const body = (await res.json().catch(() => null)) as {
        persisted?: boolean; reason?: string; anomalies_upserted?: number; resolved?: number
        lookups_saved?: number; lookups_reason?: string; error?: string
      } | null
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`)
      const parts: string[] = []
      if (!body.persisted) {
        parts.push(body.reason ?? 'Journal non enregistré.')
      } else if (createRun) {
        const n = body.anomalies_upserted ?? 0
        const closed = body.resolved ?? 0
        const kept = body.lookups_saved ?? 0
        parts.push(`Journal enregistré : ${n} anomalie${n > 1 ? 's' : ''} ouverte${n > 1 ? 's' : ''} ou mise${n > 1 ? 's' : ''} à jour, ${closed} clôturée${closed > 1 ? 's' : ''}, ${kept} résultat${kept > 1 ? 's' : ''} conservé${kept > 1 ? 's' : ''}.`)
      }
      if (body.lookups_reason) parts.push(body.lookups_reason)
      if (parts.length > 0) setJournalMsg(parts.join(' '))
      await loadJournal()
    } catch (err) {
      setJournalMsg(`Journal non enregistré : ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Charge la copie Supabase des DAE (synchronisée chaque matin) : réponse immédiate */
  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/geodae/extract', { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as ExtractionResult
      setResult(body)
      setLookups(seedLookups(body.rows))
      setBulk(null)
      setWritebacks({})
      setBulkWrite(null)
      setBulkWriteConfirm(false)
      setWriteMsg(null)
      setPage(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  /**
   * Actualisation à la demande : relance la synchronisation Synchroteam → Supabase
   * des comptes configurés (même mécanisme que « Synchroniser maintenant » dans la
   * barre latérale), puis recharge la copie. Jusqu'à une minute par compte.
   */
  async function refreshFromSynchroteam() {
    if (syncing) return
    setSyncing(true)
    setSyncMsg(null)
    const configured = result?.accounts.filter((a) => a.configured).map((a) => a.account) ?? []
    const keys = (configured.length > 0 ? configured : ['REU']).map((t) => t.toLowerCase())
    const errors: string[] = []
    await Promise.all(keys.map(async (key) => {
      try {
        const res = await fetch(`/api/sync/trigger?territory=${key}`, { method: 'POST' })
        const body = (await res.json().catch(() => null)) as { errors?: string[]; error?: string } | null
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
        errors.push(...(body?.errors ?? []))
      } catch (err) {
        errors.push(`[${key.toUpperCase()}] ${err instanceof Error ? err.message : String(err)}`)
      }
    }))
    setSyncing(false)
    if (errors.length > 0) {
      setSyncMsg(`Synchronisation terminée avec ${errors.length} erreur${errors.length > 1 ? 's' : ''} : ${errors.slice(0, 3).join(' · ')}`)
    }
    await load()
  }

  /** Rapprochement complet Synchroteam ↔ Géo'DAE (point 3), même moteur que le cron */
  async function runReconcile() {
    if (reconciling) return
    setReconciling(true)
    setJournalMsg(null)
    try {
      const res = await fetch('/api/geodae/cron?action=reconcile', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as {
        synchroteam_total?: number; geodae_total?: number; matched?: number; divergence?: number; absent?: number
        non_reference?: number; resolved?: number; persisted?: boolean; reason?: string; error?: string
      } | null
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setJournalMsg(
        `Rapprochement : ${body.synchroteam_total ?? 0} DAE Synchroteam en location, ${body.geodae_total ?? 0} DAE Géo'DAE, ${body.matched ?? 0} appariés · ` +
        `${body.divergence ?? 0} divergent${(body.divergence ?? 0) > 1 ? 's' : ''}, ${body.absent ?? 0} absent${(body.absent ?? 0) > 1 ? 's' : ''} de Géo'DAE, ` +
        `${body.non_reference ?? 0} non référencé${(body.non_reference ?? 0) > 1 ? 's' : ''} dans Synchroteam, ${body.resolved ?? 0} anomalie${(body.resolved ?? 0) > 1 ? 's' : ''} clôturée${(body.resolved ?? 0) > 1 ? 's' : ''}.` +
        (body.persisted ? '' : ` ${body.reason ?? 'Résultat non enregistré.'}`)
      )
      await loadJournal()
    } catch (err) {
      setJournalMsg(`Rapprochement impossible : ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setReconciling(false)
    }
  }

  /** Clôture manuelle d'une anomalie (traitée hors outil), avec motif */
  async function resolveAnomaly(id: string, comment: string) {
    try {
      const res = await fetch('/api/geodae/anomalies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, resolution: comment }),
      })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      await loadJournal()
    } catch (err) {
      setJournalMsg(`Clôture impossible : ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Lance à la main un lot du contrôle automatique (même moteur que le cron
   * quotidien), puis recharge les DAE et le journal.
   */
  async function runAutoControl() {
    if (autoRunning) return
    setAutoRunning(true)
    setAutoMsg(null)
    try {
      const res = await fetch('/api/geodae/cron', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as {
        due?: number; examined?: number; found?: number; ambiguous?: number; not_found?: number; errors?: number
        remaining?: number; candidates_total?: number; reason?: string; lookups_reason?: string; error?: string
      } | null
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`)
      const parts = [
        `${body.examined ?? 0} DAE examiné${(body.examined ?? 0) > 1 ? 's' : ''} sur ${body.due ?? 0} à contrôler (${body.candidates_total ?? 0} sans identifiant)`,
        `${body.found ?? 0} trouvé${(body.found ?? 0) > 1 ? 's' : ''}`,
        `${body.not_found ?? 0} introuvable${(body.not_found ?? 0) > 1 ? 's' : ''}`,
      ]
      if ((body.ambiguous ?? 0) > 0) parts.push(`${body.ambiguous} ambigu${(body.ambiguous ?? 0) > 1 ? 's' : ''}`)
      if ((body.errors ?? 0) > 0) parts.push(`${body.errors} erreur${(body.errors ?? 0) > 1 ? 's' : ''}`)
      if ((body.remaining ?? 0) > 0) parts.push(`${body.remaining} restant${(body.remaining ?? 0) > 1 ? 's' : ''} pour un prochain lot`)
      setAutoMsg(`Contrôle automatique : ${parts.join(', ')}.${body.reason ? ` ${body.reason}` : ''}${body.lookups_reason ? ` ${body.lookups_reason}` : ''}`)
      await Promise.all([load(), loadJournal()])
    } catch (err) {
      setAutoMsg(`Contrôle automatique impossible : ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAutoRunning(false)
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
      // Une ligne reportée à l'instant reste visible dans la vue « sans identifiant »
      if (filter === 'sans_geo' && r.geo_dae_id && writebacks[rowKey(r)]?.status !== 'done') return false
      if (filter === 'sans_serie' && r.serial_number) return false
      if (q) {
        const hay = [r.serial_number, r.geo_dae_id, r.customer_name, r.site_name, r.name, r.synchroteam_id].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [result, account, filter, search, writebacks])

  // Lignes candidates à la recherche : sans identifiant mais avec un n° de série
  const missingTargets = useMemo(
    () => filtered.filter((r) => !r.geo_dae_id && r.serial_number && lookups[rowKey(r)]?.status !== 'done'),
    [filtered, lookups]
  )

  // Lignes reportables en lot : correspondance unique trouvée, pas encore écrite
  const uniqueTargets = useMemo(
    () => filtered.filter((r) => {
      if (r.geo_dae_id || !foundGid(lookups[rowKey(r)])) return false
      const w = writebacks[rowKey(r)]
      return !w || w.status === 'error' || w.status === 'confirm'
    }),
    [filtered, lookups, writebacks]
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

  // ── Report dans Synchroteam ───────────────────────────────────────────────

  function requestWrite(row: LocationDae, gid: string) {
    setWritebacks((prev) => ({ ...prev, [rowKey(row)]: { status: 'confirm', gid } }))
  }

  function cancelWrite(row: LocationDae) {
    setWritebacks((prev) => {
      const next = { ...prev }
      delete next[rowKey(row)]
      return next
    })
  }

  /** Écrit l'identifiant dans le champ Synchroteam de la ligne ; vrai si l'écriture a été acceptée */
  async function writeOne(row: LocationDae, gid: string): Promise<boolean> {
    const key = rowKey(row)
    setWritebacks((prev) => ({ ...prev, [key]: { status: 'writing', gid } }))
    try {
      const res = await fetch('/api/geodae/writeback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: row.account, synchroteam_id: row.synchroteam_id, serial_number: row.serial_number, gid }),
      })
      const body = (await res.json().catch(() => null)) as WritebackResponse | null
      if (!body) throw new Error(`HTTP ${res.status}`)
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setWritebacks((prev) => ({ ...prev, [key]: { status: 'done', gid, verified: body.verified === true } }))
      // La ligne rejoint les DAE « avec identifiant » et les compteurs suivent
      setResult((prev) => (prev ? applyWrittenGid(prev, row, gid) : prev))
      if (body.journal && !body.journal.persisted) setJournalMsg(body.journal.reason ?? 'Report non tracé dans le journal.')
      return true
    } catch (err) {
      setWritebacks((prev) => ({ ...prev, [key]: { status: 'error', gid, message: err instanceof Error ? err.message : String(err) } }))
      return false
    }
  }

  /** Confirmation d'un report demandé sur une ligne */
  async function confirmWrite(row: LocationDae) {
    const pending = writebacks[rowKey(row)]
    if (pending?.status !== 'confirm') return
    setWriteMsg(null)
    await writeOne(row, pending.gid)
    await loadJournal()
  }

  /** Report en lot des correspondances uniques affichées, après confirmation explicite */
  async function writeUniqueMatches() {
    setBulkWriteConfirm(false)
    if (bulkWrite?.running || uniqueTargets.length === 0) return
    const targets = uniqueTargets.map((r) => ({ row: r, gid: foundGid(lookups[rowKey(r)]) as string }))
    setBulkWrite({ running: true, done: 0, total: targets.length })
    setWriteMsg(null)
    let ok = 0
    for (let i = 0; i < targets.length; i++) {
      if (await writeOne(targets[i].row, targets[i].gid)) ok++
      setBulkWrite({ running: true, done: i + 1, total: targets.length })
      // Chaque report enchaîne trois appels Synchroteam : on espace les lignes
      await new Promise((r) => setTimeout(r, 150))
    }
    setBulkWrite({ running: false, done: targets.length, total: targets.length })
    const failed = targets.length - ok
    setWriteMsg(
      `Report terminé : ${ok} identifiant${ok > 1 ? 's' : ''} écrit${ok > 1 ? 's' : ''} dans Synchroteam` +
      (failed > 0 ? `, ${failed} échec${failed > 1 ? 's' : ''} (détail sur chaque ligne).` : '.')
    )
    await loadJournal()
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
      const outcome = outcomeOf(st.result)
      if (outcome === 'found') found++
      else if (outcome === 'not_found') notFound++
      else if (outcome === 'ambiguous') ambiguous++
      else errors++
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
        subtitle={<>DAE <strong className="font-medium text-slate-700">actifs</strong> sous contrat de <strong className="font-medium text-slate-700">location</strong> d&apos;après la copie Synchroteam synchronisée chaque matin, recherche des identifiants Géo&apos;DAE manquants à partir du n° de série, report dans Synchroteam, rapport d&apos;anomalies.</>}
        actions={
          <Button
            variant="primary"
            onClick={refreshFromSynchroteam}
            disabled={syncing || loading}
            title="Relance la synchronisation Synchroteam → Supabase des comptes configurés, puis recharge la page (jusqu’à une minute)"
          >
            {syncing ? <SpinnerIcon /> : <RefreshIcon />}
            {syncing ? 'Synchronisation en cours…' : 'Actualiser depuis Synchroteam'}
          </Button>
        }
      />

      {/* ── Messages et états ─────────────────────────────────────────────── */}
      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-13 text-red-700">
          Échec du chargement : {error}
        </div>
      )}
      {syncMsg && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{syncMsg}</div>
      )}
      {journalMsg && (
        <div className="mb-4 rounded-md border border-slate-200 bg-white px-4 py-2 text-xs text-slate-700 shadow-card">{journalMsg}</div>
      )}
      {writeMsg && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">{writeMsg}</div>
      )}
      {autoMsg && (
        <div className="mb-4 rounded-md border border-slate-200 bg-white px-4 py-2 text-xs text-slate-700 shadow-card">{autoMsg}</div>
      )}
      {syncing && (
        <div className="mb-4 animate-pulse rounded-lg border border-slate-200 bg-white p-6 text-13 text-slate-500 shadow-card">
          Synchronisation Synchroteam → Supabase en cours sur chaque compte configuré. Cela peut prendre jusqu&apos;à une minute.
        </div>
      )}
      {loading && !syncing && (
        <div className="mb-4 animate-pulse rounded-lg border border-slate-200 bg-white p-6 text-13 text-slate-500 shadow-card">
          Chargement de la copie Supabase…
        </div>
      )}

      {/* ── Onglets ───────────────────────────────────────────────────────── */}
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'dae', label: 'DAE en location', count: result?.totals.location_total ?? null },
          { value: 'anomalies', label: 'Anomalies', count: journal?.available ? journal.open_total : null, tone: 'warn' },
          { value: 'journal', label: 'Historique' },
        ]}
      />

      {/* ── Onglet DAE en location ────────────────────────────────────────── */}
      {tab === 'dae' && result && !loading && (
        <>
          {result.warning && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{result.warning}</div>
          )}

          {/* Bilan par compte */}
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {result.accounts.map((a) => <AccountCard key={a.account} a={a} />)}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-13 text-slate-600 tabular-nums">
            <span><strong className="font-semibold text-slate-900">{result.totals.location_total}</strong> DAE actifs en location sur <strong className="font-medium">{result.totals.active_total}</strong> actifs</span>
            <span className="text-emerald-700"><strong className="font-semibold">{result.totals.with_geo_dae_id}</strong> avec identifiant</span>
            <span className="text-amber-700"><strong className="font-semibold">{result.totals.without_geo_dae_id}</strong> sans identifiant</span>
            <span className="text-red-700"><strong className="font-semibold">{result.totals.without_serial}</strong> sans n° de série</span>
            <span className="text-2xs text-slate-400">
              {result.source === 'synchroteam' ? 'Lecture directe Synchroteam du' : 'Copie Synchroteam synchronisée le'} {fmtDateTime(result.extracted_at)}
            </span>
          </div>

          {/* Recherche des identifiants manquants */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-card">
            <div className="min-w-0 flex-1 text-13 text-slate-600">
              <span className="font-medium text-slate-800">Identifiants manquants.</span>{' '}
              La recherche part du n° de série et interroge l&apos;open data Géo&apos;DAE de data.gouv.fr
              {lookupSummary.apiStatus === 'ok' ? ' et l’API exploitants Géo’DAE' : ''}. Les résultats sont conservés en base et journalisés.
              {lookupSummary.total > 0 && (
                <span className="ml-2 tabular-nums">
                  <span className="text-emerald-700">{lookupSummary.found} trouvé{lookupSummary.found > 1 ? 's' : ''}</span>
                  {lookupSummary.ambiguous > 0 && <> · <span className="text-amber-700">{lookupSummary.ambiguous} à trancher</span></>}
                  {lookupSummary.notFound > 0 && <> · <span className="text-red-700">{lookupSummary.notFound} introuvable{lookupSummary.notFound > 1 ? 's' : ''}</span></>}
                  {lookupSummary.errors > 0 && <> · <span className="text-red-700">{lookupSummary.errors} erreur{lookupSummary.errors > 1 ? 's' : ''}</span></>}
                </span>
              )}
              {lookupSummary.apiStatus && lookupSummary.apiStatus !== 'ok' && lookupSummary.apiStatus !== 'inconnu' && (
                <span className="ml-2 text-2xs text-slate-400">API exploitants : {lookupSummary.apiStatus}</span>
              )}
              {result.lookups_reason && (
                <span className="ml-2 text-2xs text-amber-700">{result.lookups_reason}</span>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={runAutoControl}
              disabled={autoRunning || bulk?.running}
              title="Lance un lot du contrôle automatique, celui que le cron exécute chaque matin : DAE jamais contrôlés d'abord, puis contrôles les plus anciens"
            >
              {autoRunning ? <SpinnerIcon /> : null}
              {autoRunning ? 'Contrôle automatique…' : 'Contrôle automatique (un lot)'}
            </Button>
            <Button
              variant="secondary"
              onClick={lookupMissing}
              disabled={bulk?.running || autoRunning || missingTargets.length === 0}
              title="Lance la recherche pour toutes les lignes affichées sans identifiant"
            >
              {bulk?.running
                ? <><SpinnerIcon />Recherche {bulk.done} / {bulk.total}</>
                : <>Rechercher les manquants ({missingTargets.length})</>}
            </Button>
            <Button
              variant="primary"
              onClick={() => setBulkWriteConfirm(true)}
              disabled={bulkWrite?.running || bulkWriteConfirm || uniqueTargets.length === 0}
              title="Écrit dans Synchroteam les identifiants trouvés avec une correspondance unique, après confirmation"
            >
              {bulkWrite?.running
                ? <><SpinnerIcon />Report {bulkWrite.done} / {bulkWrite.total}</>
                : <>Reporter les correspondances uniques ({uniqueTargets.length})</>}
            </Button>
          </div>

          {bulkWriteConfirm && (
            <div role="alertdialog" aria-label="Confirmer le report dans Synchroteam" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-red-50/50 px-4 py-2.5 text-13 text-slate-700">
              <span className="min-w-0 flex-1">
                Vous allez écrire <strong className="font-semibold">{uniqueTargets.length}</strong> identifiant{uniqueTargets.length > 1 ? 's' : ''} dans le champ « Identifiant Géo&apos;DAE » des équipements Synchroteam.
                {' '}Chaque équipement est relu juste avant l&apos;écriture et un champ déjà renseigné n&apos;est jamais écrasé.
              </span>
              <Button variant="primary" onClick={writeUniqueMatches}>Confirmer le report</Button>
              <Button variant="ghost" onClick={() => setBulkWriteConfirm(false)}>Annuler</Button>
            </div>
          )}

          {/* Types de contrat rencontrés */}
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

          {/* Filtres */}
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
            <Button variant="secondary" size="sm" onClick={() => downloadCsv(exportRows())} disabled={filtered.length === 0} title="Exporter les lignes affichées, avec les identifiants trouvés et l'état des recherches">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Exporter CSV
            </Button>
          </div>

          {/* Tableau */}
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
                    const wb = writebacks[key]
                    return (
                      <tr key={key} className={trClass}>
                        <td className={cx(tdClass, 'text-xs font-medium text-slate-600')}>{r.account}</td>
                        <td className={cx(tdClass, 'font-mono text-xs font-medium text-slate-800')}>
                          {r.serial_number ?? <span className="font-sans font-medium text-red-700">manquant</span>}
                        </td>
                        <td className={cx(tdClass, 'text-slate-700')}>
                          {r.geo_dae_id
                            ? (
                              <span className="inline-flex flex-wrap items-center gap-1.5">
                                <GidLink gid={r.geo_dae_id} />
                                {wb?.status === 'done' && (
                                  <span
                                    className="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-2xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                                    title={wb.verified ? 'Valeur relue dans Synchroteam après l’écriture' : 'Écriture acceptée par Synchroteam, relecture non confirmée'}
                                  >
                                    Reporté dans Synchroteam
                                  </span>
                                )}
                              </span>
                            )
                            : (
                              <MissingGidCell
                                row={r}
                                state={lookups[key]}
                                writeback={wb}
                                copied={copiedKey === key}
                                onLookup={() => lookupSingle(r)}
                                onCopy={(gid) => copyGid(gid, key)}
                                onWriteRequest={(gid) => requestWrite(r, gid)}
                                onWriteConfirm={() => confirmWrite(r)}
                                onWriteCancel={() => cancelWrite(r)}
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

      {/* ── Onglet Anomalies ──────────────────────────────────────────────── */}
      {tab === 'anomalies' && (
        <AnomaliesPanel
          journal={journal}
          loading={journalLoading}
          onRefresh={loadJournal}
          onReconcile={runReconcile}
          reconciling={reconciling}
          onResolve={resolveAnomaly}
        />
      )}

      {/* ── Onglet Historique ─────────────────────────────────────────────── */}
      {tab === 'journal' && (
        <HistoryPanel journal={journal} loading={journalLoading} onRefresh={loadJournal} />
      )}
    </PageContainer>
  )
}
