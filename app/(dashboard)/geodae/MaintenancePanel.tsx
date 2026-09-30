'use client'
// Onglet « Maintenance » du contrôle Géo'DAE : compare, pour chaque DAE en
// location apparié, la dernière intervention Synchroteam et la date de
// maintenance déclarée dans Géo'DAE, et propose de reporter dans Synchroteam la
// date Géo'DAE quand elle est plus récente ou que Synchroteam n'en a pas.
// L'écriture est validée ligne par ligne par l'utilisateur ; l'autre sens
// (mettre Géo'DAE à jour) reste à faire sur le portail, avec le lien fourni.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Download, ExternalLink, Loader2, RefreshCw, Upload } from 'lucide-react'
import {
  Button, Card, EmptyState, Notice, Select, Tag, buttonClass, cx, pageButtonClass,
  tableClass, tableFooterClass, tbodyClass, tdClass, thClass, theadClass, trClass, type TagTone,
} from '@/components/ui/primitives'
import { pageParam, pickParam, useUrlState } from '@/lib/url-state'
import {
  MAINTENANCE_LABELS, TERRITORY_LABELS, geodaeSheetUrl, maintenanceSituation,
  type MaintenanceResult, type MaintenanceRow, type MaintenanceSituation,
} from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

const PAGE_SIZE = 50
const SITUATIONS: ReadonlyArray<MaintenanceSituation | 'all'> = ['all', 'geodae_recent', 'synchroteam_vide', 'synchroteam_recent', 'proche', 'identique', 'geodae_vide', 'aucune_date']
const TOLERANCES = ['7', '30', '90'] as const
const ACCOUNT_PARAMS = ['all', 'REU', 'MYT', 'GLP'] as const
/** Situations qui appellent une action : ce sont elles que compte la pastille de l'onglet */
const ACTIONABLE: ReadonlyArray<MaintenanceSituation> = ['geodae_recent', 'synchroteam_vide', 'synchroteam_recent']

// Pastilles cliquables de filtre, même dessin que l'onglet Anomalies
const TONE_CHIP: Record<TagTone, string> = {
  neutral:  'bg-surface-sunken text-fg-secondary',
  brand:    'bg-brand/10 text-brand',
  success:  'bg-success-soft text-success',
  warning:  'bg-warning-soft text-warning',
  danger:   'bg-danger-soft text-danger',
  info:     'bg-info-soft text-info',
  inverted: 'bg-white/15 text-white',
}

const SITUATION_TONE: Record<MaintenanceSituation, TagTone> = {
  identique:          'success',
  proche:             'neutral',
  synchroteam_recent: 'info',
  geodae_recent:      'warning',
  synchroteam_vide:   'danger',
  geodae_vide:        'neutral',
  aucune_date:        'neutral',
}

/** Cible d'une écriture : le champ de la fiche Synchroteam, ou la fiche Géo'DAE */
type WriteTarget = 'synchroteam' | 'geodae'
type WriteState =
  | { status: 'confirm'; target: WriteTarget }
  | { status: 'writing'; target: WriteTarget }
  | { status: 'done'; target: WriteTarget; verified: boolean; alreadySet: boolean; journal?: string; collateral?: string[]; etatValid?: string | null }
  | { status: 'error'; target: WriteTarget; message: string }

const TARGET_LABEL: Record<WriteTarget, string> = { synchroteam: 'Synchroteam', geodae: "Géo'DAE" }

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function rowKey(r: MaintenanceRow) {
  return `${r.account}-${r.synchroteam_id}`
}

export default function MaintenancePanel({ onActionable }: { onActionable?: (count: number) => void }) {
  const [result, setResult] = useState<MaintenanceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writes, setWrites] = useState<Record<string, WriteState>>({})

  // Filtres et page dans l'URL : le bouton Retour et un lien copié ramènent au même état
  const url = useUrlState()
  const account = pickParam(url.get('compte'), ACCOUNT_PARAMS, 'all')
  const situation = pickParam(url.get('situation'), SITUATIONS, 'all')
  const tolerance = parseInt(pickParam(url.get('ecart'), TOLERANCES, '30'), 10)
  const page = pageParam(url.get('page'))
  const setPage = (n: number) => url.set({ page: n > 1 ? n : null })

  async function load(fresh = false) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(fresh ? '/api/geodae/maintenance?fresh=1' : '/api/geodae/maintenance', { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as (MaintenanceResult & { error?: string }) | null
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setResult(body)
      setWrites({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Situation de chaque ligne pour la tolérance choisie
  const rows = useMemo(() => (result?.rows ?? []).map((r) => ({ row: r, situation: maintenanceSituation(r, tolerance) })), [result, tolerance])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const { row, situation: s } of rows) {
      if (account !== 'all' && row.account !== account) continue
      c[s] = (c[s] ?? 0) + 1
    }
    return c
  }, [rows, account])
  const actionable = ACTIONABLE.reduce((n, s) => n + (counts[s] ?? 0), 0)
  useEffect(() => { if (result) onActionable?.(actionable) }, [result, actionable, onActionable])

  const filtered = useMemo(
    () => rows
      .filter(({ row, situation: s }) => (account === 'all' || row.account === account) && (situation === 'all' || s === situation))
      .sort((a, b) => Math.abs(b.row.gap_days ?? 0) - Math.abs(a.row.gap_days ?? 0)),
    [rows, account, situation]
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // ── Écritures : la date Géo'DAE dans Synchroteam, ou la date Synchroteam dans Géo'DAE ──
  async function confirmWrite(r: MaintenanceRow, target: WriteTarget) {
    const date = target === 'synchroteam' ? r.geodae_date : r.synchroteam_date
    if (!date) return
    const key = rowKey(r)
    setWrites((prev) => ({ ...prev, [key]: { status: 'writing', target } }))
    try {
      const payload = target === 'synchroteam'
        ? { account: r.account, synchroteam_id: r.synchroteam_id, serial_number: r.serial_number, date }
        : { target: 'geodae', gid: r.geo_dae_id, date, account: r.account, synchroteam_id: r.synchroteam_id, serial_number: r.serial_number }
      const res = await fetch('/api/geodae/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean; verified?: boolean; already_set?: boolean; error?: string; collateral?: string[]; etat_valid_after?: string | null
        journal?: { persisted: boolean; reason?: string }
      } | null
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setWrites((prev) => ({ ...prev, [key]: {
        status: 'done', target, verified: body.verified === true, alreadySet: body.already_set === true,
        journal: body.journal && !body.journal.persisted ? body.journal.reason : undefined,
        collateral: body.collateral, etatValid: body.etat_valid_after,
      } }))
      // La ligne reflète la nouvelle valeur du côté qui vient d'être écrit
      setResult((prev) => prev ? { ...prev, rows: prev.rows.map((x) => (rowKey(x) !== key ? x : target === 'synchroteam' ? { ...x, synchroteam_field_date: date } : { ...x, geodae_date: date, gap_days: 0 })) } : prev)
    } catch (err) {
      setWrites((prev) => ({ ...prev, [key]: { status: 'error', target, message: err instanceof Error ? err.message : String(err) } }))
    }
  }

  const csvHref = `/api/geodae/maintenance?format=csv&tolerance=${tolerance}`

  return (
    <Card padded={false}>
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <Select value={account} onChange={(e) => { url.set({ compte: e.target.value === 'all' ? null : e.target.value, page: null }) }} aria-label="Compte Synchroteam" wrapperClassName="w-44">
          <option value="all">Tous les comptes</option>
          {(['REU', 'MYT', 'GLP'] as TerritoryCode[]).map((code) => <option key={code} value={code}>{TERRITORY_LABELS[code]}</option>)}
        </Select>
        {/* Situations : pastilles cliquables avec compteur, un clic filtre, un second clic retire le filtre */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => url.set({ situation: null, page: null })}
            className={cx(
              'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-label font-semibold transition-colors',
              situation === 'all' ? 'bg-fg text-white' : 'bg-surface-sunken text-fg-secondary hover:text-fg'
            )}
          >
            Toutes <span className="font-bold tabular-nums">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>
          </button>
          {SITUATIONS.filter((s): s is MaintenanceSituation => s !== 'all' && (counts[s] ?? 0) > 0).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => url.set({ situation: situation === s ? null : s, page: null })}
              title={situation === s ? 'Afficher toutes les situations' : 'Ne montrer que cette situation'}
              className={cx(
                'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-label font-semibold transition-all',
                TONE_CHIP[SITUATION_TONE[s]],
                situation === s ? 'ring-2 ring-current ring-offset-1' : situation !== 'all' ? 'opacity-50' : ''
              )}
            >
              {MAINTENANCE_LABELS[s]} <span className="font-bold tabular-nums">{counts[s]}</span>
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2">
          <span className="text-label font-bold uppercase tracking-wide text-fg-faint">Tolérance</span>
          <Select value={String(tolerance)} onChange={(e) => url.set({ ecart: e.target.value === '30' ? null : e.target.value, page: null })} aria-label="Écart toléré">
            {TOLERANCES.map((t) => <option key={t} value={t}>{t} jours</option>)}
          </Select>
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <a href={csvHref} className={buttonClass('ghost', 'sm')} title="Exporter la comparaison complète (CSV)">
            <Download className="h-4 w-4" />Exporter CSV
          </a>
          <Button variant="ghost" size="sm" icon={RefreshCw} loading={loading} onClick={() => load(true)} title="Relire la copie Supabase et l'open data Géo'DAE">
            Actualiser
          </Button>
        </div>
      </div>

      {/* Sources */}
      {result && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle px-4 py-2 text-caption text-fg-secondary tabular-nums">
          <span>Dernière intervention Synchroteam d&apos;après la copie synchronisée le <span className="font-medium text-fg">{fmtDate(result.extracted_at.slice(0, 10))}</span>, date Géo&apos;DAE d&apos;après l&apos;open data mis à jour le <span className="font-medium text-fg">{fmtDate(result.geodae_updated_at)}</span>. Écart toléré : {tolerance} jours.</span>
          {result.totals.unpaired > 0 && <span className="text-fg-faint">{result.totals.unpaired} identifiant{result.totals.unpaired > 1 ? 's' : ''} inconnu{result.totals.unpaired > 1 ? 's' : ''} de l&apos;open data, non comparé{result.totals.unpaired > 1 ? 's' : ''}</span>}
        </div>
      )}

      <div className="flex flex-col gap-2 px-4 py-2 empty:hidden">
        {error && <Notice tone="danger">Échec du chargement : {error}</Notice>}
        {result?.warning && <Notice tone="warning">{result.warning}</Notice>}
        {result && !result.field_mapped && (
          <Notice tone="info">
            Le champ « Date dernière maintenance » de la fiche Synchroteam n&apos;est pas encore lu par la synchronisation : associez-le au champ interne
            « Date dernière maintenance (champ Synchroteam) » dans <Link href="/admin/field-mapping" className="font-semibold underline">Mapping des champs</Link>, puis synchronisez.
            Le report vers Synchroteam reste possible, le champ est retrouvé par son libellé.
          </Notice>
        )}
      </div>

      {loading && !result && (
        <div className="flex items-center justify-center gap-2 py-12 text-body text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" />Comparaison des dates…</div>
      )}

      {result && (filtered.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Aucun DAE dans cette situation" description="Changez de situation, de compte ou de tolérance." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Compte</th>
                  <th className={thClass}>N° série</th>
                  <th className={thClass}>Client · site</th>
                  <th className={cx(thClass, 'w-px whitespace-normal leading-tight')}>Dernière intervention<br />Synchroteam</th>
                  {result.field_mapped && <th className={cx(thClass, 'w-px whitespace-normal leading-tight')}>Champ<br />Synchroteam</th>}
                  <th className={cx(thClass, 'w-px whitespace-normal leading-tight')}>Date<br />Géo&apos;DAE</th>
                  <th className={thClass}>Écart</th>
                  <th className={thClass}>Situation</th>
                  <th className={thClass}>Action</th>
                </tr>
              </thead>
              <tbody className={tbodyClass}>
                {pageRows.map(({ row: r, situation: s }) => {
                  const key = rowKey(r)
                  const w = writes[key]
                  const canWrite = (s === 'geodae_recent' || s === 'synchroteam_vide') && Boolean(r.geodae_date)
                  return (
                    <tr key={key} className={trClass}>
                      <td className={cx(tdClass, 'w-px whitespace-nowrap text-caption')}>{r.account}</td>
                      <td className={cx(tdClass, 'w-px whitespace-nowrap font-mono text-caption text-fg')}>
                        <Link prefetch={false} href={`/parc/${r.defibrillator_id}`} className="hover:text-brand hover:underline">{r.serial_number ?? '—'}</Link>
                      </td>
                      <td className={cx(tdClass, 'max-w-[260px]')}>
                        <div className="truncate text-fg" title={r.customer_name ?? undefined}>{r.customer_name ?? '—'}</div>
                        <div className="truncate text-label text-fg-muted" title={r.site_name ?? undefined}>{r.site_name ?? ''}</div>
                      </td>
                      <td className={cx(tdClass, 'w-px whitespace-nowrap tabular-nums')}>{fmtDate(r.synchroteam_date)}</td>
                      {result.field_mapped && <td className={cx(tdClass, 'w-px whitespace-nowrap tabular-nums text-fg-muted')}>{fmtDate(r.synchroteam_field_date)}</td>}
                      <td className={cx(tdClass, 'w-px whitespace-nowrap tabular-nums')}>
                        <a href={geodaeSheetUrl(r.geo_dae_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-brand hover:underline" title={r.geodae_name ?? undefined}>
                          {fmtDate(r.geodae_date)}<ExternalLink className="h-3 w-3 text-fg-faint" />
                        </a>
                      </td>
                      <td className={cx(tdClass, 'w-px whitespace-nowrap text-caption tabular-nums', r.gap_days != null && Math.abs(r.gap_days) > tolerance ? 'font-semibold text-fg' : 'text-fg-muted')}>
                        {r.gap_days == null ? '—' : `${r.gap_days > 0 ? '+' : ''}${r.gap_days} j`}
                      </td>
                      <td className={cx(tdClass, 'w-px whitespace-nowrap')}><Tag tone={SITUATION_TONE[s]} dot>{MAINTENANCE_LABELS[s]}</Tag></td>
                      <td className={cx(tdClass, 'whitespace-nowrap text-caption')}>
                        {w?.status === 'writing' && <span className="inline-flex items-center gap-1 text-fg-muted"><Loader2 className="h-3 w-3 animate-spin" />Écriture dans {TARGET_LABEL[w.target]}…</span>}
                        {w?.status === 'done' && (
                          <span className="inline-flex max-w-[360px] flex-wrap items-center gap-1.5 whitespace-normal">
                            <Tag tone="success" title={w.verified ? `Valeur relue dans ${TARGET_LABEL[w.target]} après l’écriture` : 'Écriture acceptée, relecture non confirmée'}>
                              {w.alreadySet ? `Déjà à jour dans ${TARGET_LABEL[w.target]}` : `Écrit dans ${TARGET_LABEL[w.target]}`}
                            </Tag>
                            {w.target === 'geodae' && !w.alreadySet && (
                              <a href={geodaeSheetUrl(r.geo_dae_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-label text-fg-muted hover:text-brand hover:underline">
                                vérifier sur le portail<ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {w.target === 'geodae' && w.etatValid && w.etatValid !== 'validées' && <span className="text-label text-warning">état de la fiche : {w.etatValid}</span>}
                            {w.collateral && w.collateral.length > 0 && (
                              <span className="text-label text-danger" title={w.collateral.join('\n')}>{w.collateral.length} autre{w.collateral.length > 1 ? 's' : ''} champ{w.collateral.length > 1 ? 's' : ''} modifié{w.collateral.length > 1 ? 's' : ''} : vérifier la fiche</span>
                            )}
                            {w.journal && <span className="text-label text-warning" title={w.journal}>trace non enregistrée</span>}
                          </span>
                        )}
                        {w?.status === 'error' && (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <span className="max-w-[260px] truncate" title={w.message}>Échec : {w.message}</span>
                            <Button variant="ghost" size="xs" onClick={() => setWrites((p) => ({ ...p, [key]: { status: 'confirm', target: w.target } }))}>Réessayer</Button>
                          </span>
                        )}
                        {w?.status === 'confirm' && (
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <span className="text-label font-semibold text-fg-secondary">
                              Écrire {fmtDate(w.target === 'synchroteam' ? r.geodae_date : r.synchroteam_date)} dans {w.target === 'synchroteam' ? 'Synchroteam' : `la fiche Géo'DAE ${r.geo_dae_id}`} ?
                            </span>
                            <Button variant="primary" size="xs" onClick={() => confirmWrite(r, w.target)}>Confirmer</Button>
                            <Button variant="ghost" size="xs" onClick={() => setWrites((p) => { const n = { ...p }; delete n[key]; return n })}>Annuler</Button>
                          </span>
                        )}
                        {!w && canWrite && (
                          <Button variant="soft" size="xs" icon={Upload} onClick={() => setWrites((p) => ({ ...p, [key]: { status: 'confirm', target: 'synchroteam' } }))} title="Écrire la date Géo'DAE dans le champ « Date dernière maintenance » de l'équipement Synchroteam, après confirmation">
                            Reporter dans Synchroteam
                          </Button>
                        )}
                        {!w && s === 'synchroteam_recent' && (
                          <span className="inline-flex items-center gap-1">
                            <Button variant="soft" size="xs" icon={Upload} onClick={() => setWrites((p) => ({ ...p, [key]: { status: 'confirm', target: 'geodae' } }))} title="Écrire la date de dernière intervention Synchroteam dans la fiche Géo'DAE (champ « date de dernière maintenance »), après confirmation">
                              Mettre à jour Géo&apos;DAE
                            </Button>
                            <a href={geodaeSheetUrl(r.geo_dae_id)} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'xs')} title="Ouvrir la fiche sur le portail Géo'DAE">
                              <ExternalLink className="h-3.5 w-3.5" />Fiche
                            </a>
                          </span>
                        )}
                        {!w && !canWrite && s !== 'synchroteam_recent' && <span className="text-border-strong">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className={tableFooterClass}>
              <span className="tabular-nums">Page {safePage} / {totalPages}, {filtered.length} DAE</span>
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="xs" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>Précédent</Button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const p = totalPages <= 7 ? i + 1 : safePage <= 4 ? i + 1 : safePage >= totalPages - 3 ? totalPages - 6 + i : safePage - 3 + i
                  return <button key={p} type="button" onClick={() => setPage(p)} aria-current={p === safePage ? 'page' : undefined} className={pageButtonClass(p === safePage)}>{p}</button>
                })}
                <Button variant="secondary" size="xs" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}>Suivant</Button>
              </div>
            </div>
          )}
        </>
      ))}
    </Card>
  )
}
