'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { DAEStatusBadge } from '@/components/table/StatusBadge'
import BackButton from '@/components/BackButton'
import {
  Button, Chip, ChipGroup, EmptyState, PageContainer, PageHeader, cx, inputClass, selectClass,
  tableClass, tableWrapClass, tbodyClass, tdClass, thClass, theadClass, trClass,
} from '@/components/ui/primitives'

export type AlertRow = {
  id: string
  serial_number: string | null
  model: string | null
  brand: string | null
  status: 'critique' | 'vigilance' | 'inconnu'
  status_reason: string | null
  battery_expiry: string | null
  electrodes_adult_expiry: string | null
  electrodes_pediatric_expiry: string | null
  next_maintenance_date: string | null
  active: boolean
  client_name: string | null
  site_name: string | null
  territory_code: string | null
  territory_name: string | null
}

type RaisonFilter = 'all' | 'batterie' | 'electrodes' | 'maintenance' | 'vigilance30'

const PAGE_SIZE = 50

const TERRITORY_LABELS: Record<string, string> = {
  REU: 'La Réunion',
  MYT: 'Mayotte',
  GLP: 'Guadeloupe',
}

// Date la plus proche parmi les échéances du DAE
function nextExpiry(row: AlertRow): string | null {
  return (
    [row.battery_expiry, row.electrodes_adult_expiry, row.electrodes_pediatric_expiry, row.next_maintenance_date]
      .filter((d): d is string => !!d)
      .sort()[0] ?? null
  )
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return d
  }
}

function isExpired(d: string | null): boolean {
  if (!d) return false
  return new Date(d) < new Date()
}

function matchesRaison(row: AlertRow, filter: RaisonFilter): boolean {
  if (filter === 'all') return true
  const r = row.status_reason ?? ''
  if (filter === 'batterie')    return r === 'Batterie expirée'
  if (filter === 'electrodes')  return r === 'Électrodes expirées'
  if (filter === 'maintenance') return r === 'Maintenance échue'
  if (filter === 'vigilance30') return r.includes('moins de 30')
  return true
}

function exportCSV(rows: AlertRow[]) {
  const headers = ['N° série', 'Marque/Modèle', 'Client', 'Site', 'Territoire', 'Statut', 'Raison', 'Prochaine échéance']
  const lines = [
    headers.join(';'),
    ...rows.map((r) =>
      [
        r.serial_number ?? '',
        [r.brand, r.model].filter(Boolean).join(' '),
        r.client_name ?? '',
        r.site_name ?? '',
        TERRITORY_LABELS[r.territory_code ?? ''] ?? r.territory_code ?? '',
        r.status === 'critique' ? 'Critique' : r.status === 'vigilance' ? 'Vigilance' : 'Inconnu',
        r.status_reason ?? '',
        fmtDate(nextExpiry(r)),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(';')
    ),
  ].join('\n')

  const blob = new Blob(['﻿' + lines], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `alertes-dae-${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const HEADERS = ['N° série', 'Marque / Modèle', 'Client', 'Site', 'Territoire', 'Statut', 'Raison', 'Prochaine échéance']

export default function AlertesClient({ rows, initInconnu = false }: { rows: AlertRow[]; initInconnu?: boolean }) {
  const [territory, setTerritory] = useState<string>('all')
  const [showCritique, setShowCritique] = useState(!initInconnu)
  const [showVigilance, setShowVigilance] = useState(!initInconnu)
  const [showInconnu, setShowInconnu] = useState(initInconnu)
  const [raison, setRaison] = useState<RaisonFilter>('all')
  const [actif, setActif] = useState<'actif' | 'inactif' | 'tous'>('actif')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const nCritique  = useMemo(() => rows.filter((r) => r.status === 'critique').length,  [rows])
  const nVigilance = useMemo(() => rows.filter((r) => r.status === 'vigilance').length, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (actif === 'actif'   && !r.active) return false
        if (actif === 'inactif' &&  r.active) return false
        if (territory !== 'all' && r.territory_code !== territory) return false
        if (!showCritique  && r.status === 'critique')  return false
        if (!showVigilance && r.status === 'vigilance') return false
        if (!showInconnu   && r.status === 'inconnu')   return false
        if (!matchesRaison(r, raison)) return false
        if (q) {
          const hay = [r.serial_number, r.client_name, r.site_name].join(' ').toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        // Critique en premier
        if (a.status !== b.status) return a.status === 'critique' ? -1 : 1
        // Puis par date d'échéance croissante (plus urgent en haut)
        const da = nextExpiry(a)
        const db = nextExpiry(b)
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return da.localeCompare(db)
      })
  }, [rows, actif, territory, showCritique, showVigilance, showInconnu, raison, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function resetPage() { setPage(1) }

  // Numéros de page à afficher (fenêtre glissante de 5)
  function pageNumbers(): number[] {
    const total = totalPages
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
    if (safePage <= 3) return [1, 2, 3, 4, 5]
    if (safePage >= total - 2) return [total - 4, total - 3, total - 2, total - 1, total]
    return [safePage - 2, safePage - 1, safePage, safePage + 1, safePage + 2]
  }

  const hasFilters = territory !== 'all' || raison !== 'all' || actif !== 'actif' || !showCritique || !showVigilance || showInconnu || search !== ''

  function resetAll() {
    setTerritory('all')
    setRaison('all')
    setActif('actif')
    setShowCritique(true)
    setShowVigilance(true)
    setShowInconnu(false)
    setSearch('')
    setPage(1)
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={<BackButton label="Tableau de bord" />}
        title="Alertes"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
              <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
              {nCritique} critique{nCritique > 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
              {nVigilance} vigilance
            </span>
            <span className="text-slate-400">{rows.length} au total</span>
          </span>
        }
        actions={
          <Button variant="secondary" onClick={() => exportCSV(filtered)} disabled={filtered.length === 0}>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Exporter CSV ({filtered.length})
          </Button>
        }
      />

      {/* ── Filtres ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            value={search}
            placeholder="N° série, client, site…"
            aria-label="Rechercher une alerte"
            onChange={(e) => { setSearch(e.target.value); resetPage() }}
            className={cx(inputClass, 'w-60 pl-8')}
          />
        </div>

        <ChipGroup label="Statut">
          <Chip active={showCritique} onClick={() => { setShowCritique((v) => !v); resetPage() }}>
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />Critique
          </Chip>
          <Chip active={showVigilance} onClick={() => { setShowVigilance((v) => !v); resetPage() }}>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />Vigilance
          </Chip>
          <Chip active={showInconnu} onClick={() => { setShowInconnu((v) => !v); resetPage() }}>
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden />Inconnu
          </Chip>
        </ChipGroup>

        <select value={territory} onChange={(e) => { setTerritory(e.target.value); resetPage() }} className={selectClass} aria-label="Territoire">
          <option value="all">Tous les territoires</option>
          <option value="REU">La Réunion</option>
          <option value="MYT">Mayotte</option>
          <option value="GLP">Guadeloupe</option>
        </select>

        <select value={actif} onChange={(e) => { setActif(e.target.value as typeof actif); resetPage() }} className={selectClass} aria-label="Équipements">
          <option value="actif">Actifs</option>
          <option value="inactif">Inactifs</option>
          <option value="tous">Tous les équipements</option>
        </select>

        <select value={raison} onChange={(e) => { setRaison(e.target.value as RaisonFilter); resetPage() }} className={selectClass} aria-label="Raison">
          <option value="all">Toutes les raisons</option>
          <option value="batterie">Batterie expirée</option>
          <option value="electrodes">Électrodes expirées</option>
          <option value="maintenance">Maintenance échue</option>
          <option value="vigilance30">Échéance sous 30 jours</option>
        </select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetAll}>
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
            Réinitialiser
          </Button>
        )}

        <span className="ml-auto text-xs text-slate-500 tabular-nums">
          {filtered.length.toLocaleString('fr-FR')} / {rows.length.toLocaleString('fr-FR')} alertes
        </span>
      </div>

      {/* ── Tableau ─────────────────────────────────────────────────────────── */}
      <div className={cx(tableWrapClass, 'overflow-hidden')}>
        {filtered.length === 0 ? (
          <EmptyState className="py-16">Aucune alerte ne correspond aux filtres sélectionnés.</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={cx(tableClass, 'min-w-full w-max')}>
                <thead className={theadClass}>
                  <tr>
                    {HEADERS.map((h) => <th key={h} className={thClass}>{h}</th>)}
                    <th className={cx(thClass, 'sticky right-0 bg-slate-50 text-right shadow-[-8px_0_12px_-4px_rgba(15,23,42,0.06)]')}>Fiche</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {pageRows.map((row) => {
                    const expiry  = nextExpiry(row)
                    const expired = isExpired(expiry)
                    const brand   = [row.brand, row.model].filter(Boolean).join(' ')
                    return (
                      <tr key={row.id} className={trClass}>
                        <td className={cx(tdClass, 'whitespace-nowrap font-mono text-xs font-medium text-slate-800')}>
                          {row.serial_number ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className={cx(tdClass, 'max-w-[180px]')}>
                          <span className="block truncate text-slate-700" title={brand || undefined}>{brand || <span className="text-slate-300">—</span>}</span>
                        </td>
                        <td className={cx(tdClass, 'max-w-[170px]')}>
                          <span className="block truncate text-slate-700" title={row.client_name ?? undefined}>{row.client_name ?? <span className="text-slate-300">—</span>}</span>
                        </td>
                        <td className={cx(tdClass, 'max-w-[160px]')}>
                          <span className="block truncate text-slate-500" title={row.site_name ?? undefined}>{row.site_name ?? <span className="text-slate-300">—</span>}</span>
                        </td>
                        <td className={cx(tdClass, 'whitespace-nowrap text-xs text-slate-500')}>
                          {TERRITORY_LABELS[row.territory_code ?? ''] ?? row.territory_code ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className={cx(tdClass, 'whitespace-nowrap')}><DAEStatusBadge status={row.status} /></td>
                        <td className={cx(tdClass, 'max-w-[220px]')}>
                          <span className="block truncate text-slate-600" title={row.status_reason ?? undefined}>{row.status_reason ?? <span className="text-slate-300">—</span>}</span>
                        </td>
                        <td className={cx(tdClass, 'whitespace-nowrap tabular-nums', expired ? 'font-medium text-red-700' : 'text-slate-700')}>
                          {fmtDate(expiry)}
                          {expired && <span className="ml-1.5 rounded bg-red-50 px-1 text-2xs font-semibold uppercase tracking-wide text-red-600">échue</span>}
                        </td>
                        <td className={cx(tdClass, 'sticky right-0 whitespace-nowrap bg-white text-right shadow-[-8px_0_12px_-4px_rgba(15,23,42,0.06)]')}>
                          <Link prefetch={false} href={`/parc/${row.id}`} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:underline">
                            Voir
                            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ──────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2">
              <p className="text-xs text-slate-500 tabular-nums">
                {`${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)}`} sur{' '}
                <span className="font-medium text-slate-700">{filtered.length}</span>
                {filtered.length !== rows.length && <span className="text-slate-400"> (filtrées sur {rows.length})</span>}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>Précédent</Button>
                  {pageNumbers().map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      aria-current={n === safePage ? 'page' : undefined}
                      className={cx(
                        'h-7 min-w-7 rounded-md px-2 text-xs font-medium tabular-nums transition-colors',
                        n === safePage ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                  <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Suivant</Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PageContainer>
  )
}
