'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { BellOff, ChevronRight, Download, Search, X } from 'lucide-react'
import { DAEStatusBadge } from '@/components/table/StatusBadge'
import BackButton from '@/components/BackButton'
import {
  Button, Chip, ChipGroup, EmptyState, PageContainer, PageHeader, Select, Tag, cx, inputClass,
  pageButtonClass, stickyColClass, tableClass, tableFooterClass, tableWrapClass, tbodyClass, tdClass, thClass, theadClass, trClass,
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
            <span className="inline-flex items-center gap-1.5 font-medium text-danger">
              <span className="h-2 w-2 rounded-full bg-danger" aria-hidden />
              {nCritique} critique{nCritique > 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-warning">
              <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
              {nVigilance} vigilance
            </span>
            <span className="text-fg-faint">{rows.length} au total</span>
          </span>
        }
        actions={
          <Button variant="secondary" icon={Download} onClick={() => exportCSV(filtered)} disabled={filtered.length === 0}>
            Exporter CSV ({filtered.length})
          </Button>
        }
      />

      {/* ── Filtres ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
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
            <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />Critique
          </Chip>
          <Chip active={showVigilance} onClick={() => { setShowVigilance((v) => !v); resetPage() }}>
            <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />Vigilance
          </Chip>
          <Chip active={showInconnu} onClick={() => { setShowInconnu((v) => !v); resetPage() }}>
            <span className="h-1.5 w-1.5 rounded-full bg-fg-faint" aria-hidden />Inconnu
          </Chip>
        </ChipGroup>

        <Select value={territory} onChange={(e) => { setTerritory(e.target.value); resetPage() }} aria-label="Territoire">
          <option value="all">Tous les territoires</option>
          <option value="REU">La Réunion</option>
          <option value="MYT">Mayotte</option>
          <option value="GLP">Guadeloupe</option>
        </Select>

        <Select value={actif} onChange={(e) => { setActif(e.target.value as typeof actif); resetPage() }} aria-label="Équipements">
          <option value="actif">Actifs</option>
          <option value="inactif">Inactifs</option>
          <option value="tous">Tous les équipements</option>
        </Select>

        <Select value={raison} onChange={(e) => { setRaison(e.target.value as RaisonFilter); resetPage() }} aria-label="Raison">
          <option value="all">Toutes les raisons</option>
          <option value="batterie">Batterie expirée</option>
          <option value="electrodes">Électrodes expirées</option>
          <option value="maintenance">Maintenance échue</option>
          <option value="vigilance30">Échéance sous 30 jours</option>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" icon={X} onClick={resetAll}>Réinitialiser</Button>
        )}

        <span className="ml-auto text-caption text-fg-muted tabular-nums">
          {filtered.length.toLocaleString('fr-FR')} / {rows.length.toLocaleString('fr-FR')} alertes
        </span>
      </div>

      {/* ── Tableau ─────────────────────────────────────────────────────────── */}
      <div className={cx(tableWrapClass, 'overflow-hidden')}>
        {filtered.length === 0 ? (
          <EmptyState icon={BellOff} className="py-16" title="Aucune alerte ne correspond aux filtres sélectionnés." description="Élargissez les statuts, le territoire ou la raison." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={cx(tableClass, 'min-w-full w-max')}>
                <thead className={theadClass}>
                  <tr>
                    {HEADERS.map((h) => <th key={h} className={thClass}>{h}</th>)}
                    <th className={cx(thClass, stickyColClass, 'bg-surface-muted text-right')}>Fiche</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {pageRows.map((row) => {
                    const expiry  = nextExpiry(row)
                    const expired = isExpired(expiry)
                    const brand   = [row.brand, row.model].filter(Boolean).join(' ')
                    return (
                      <tr key={row.id} className={trClass}>
                        <td className={cx(tdClass, 'whitespace-nowrap font-mono text-caption font-medium text-fg')}>
                          {row.serial_number ?? <span className="text-border-strong">—</span>}
                        </td>
                        <td className={cx(tdClass, 'max-w-[180px]')}>
                          <span className="block truncate text-fg-secondary" title={brand || undefined}>{brand || <span className="text-border-strong">—</span>}</span>
                        </td>
                        <td className={cx(tdClass, 'max-w-[170px]')}>
                          <span className="block truncate text-fg-secondary" title={row.client_name ?? undefined}>{row.client_name ?? <span className="text-border-strong">—</span>}</span>
                        </td>
                        <td className={cx(tdClass, 'max-w-[160px]')}>
                          <span className="block truncate text-fg-muted" title={row.site_name ?? undefined}>{row.site_name ?? <span className="text-border-strong">—</span>}</span>
                        </td>
                        <td className={cx(tdClass, 'whitespace-nowrap text-caption text-fg-muted')}>
                          {TERRITORY_LABELS[row.territory_code ?? ''] ?? row.territory_code ?? <span className="text-border-strong">—</span>}
                        </td>
                        <td className={cx(tdClass, 'whitespace-nowrap')}><DAEStatusBadge status={row.status} /></td>
                        <td className={cx(tdClass, 'max-w-[220px]')}>
                          <span className="block truncate text-fg-secondary" title={row.status_reason ?? undefined}>{row.status_reason ?? <span className="text-border-strong">—</span>}</span>
                        </td>
                        <td className={cx(tdClass, 'whitespace-nowrap tabular-nums', expired ? 'font-medium text-danger' : 'text-fg-secondary')}>
                          {fmtDate(expiry)}
                          {expired && <Tag tone="danger" className="ml-1.5 uppercase">échue</Tag>}
                        </td>
                        <td className={cx(tdClass, stickyColClass, 'whitespace-nowrap bg-surface text-right')}>
                          <Link prefetch={false} href={`/parc/${row.id}`} className="inline-flex items-center gap-0.5 text-caption font-semibold text-brand hover:underline">
                            Voir
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ──────────────────────────────────────────────── */}
            <div className={tableFooterClass}>
              <p className="tabular-nums">
                {`${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)}`} sur{' '}
                <span className="font-semibold text-fg-secondary">{filtered.length}</span>
                {filtered.length !== rows.length && <span className="text-fg-faint"> (filtrées sur {rows.length})</span>}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="secondary" size="xs" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>Précédent</Button>
                  {pageNumbers().map((n) => (
                    <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === safePage ? 'page' : undefined} className={pageButtonClass(n === safePage)}>
                      {n}
                    </button>
                  ))}
                  <Button variant="secondary" size="xs" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Suivant</Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PageContainer>
  )
}
