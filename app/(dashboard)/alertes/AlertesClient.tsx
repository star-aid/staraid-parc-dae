'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { DAEStatusBadge } from '@/components/table/StatusBadge'
import BackButton from '@/components/BackButton'

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
    [
      row.battery_expiry,
      row.electrodes_adult_expiry,
      row.electrodes_pediatric_expiry,
      row.next_maintenance_date,
    ]
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
  const headers = [
    'N° série', 'Marque/Modèle', 'Client', 'Site',
    'Territoire', 'Statut', 'Raison', 'Prochaine échéance',
  ]
  const lines = [
    headers.join(';'),
    ...rows.map((r) =>
      [
        r.serial_number ?? '',
        [r.brand, r.model].filter(Boolean).join(' '),
        r.client_name ?? '',
        r.site_name ?? '',
        TERRITORY_LABELS[r.territory_code ?? ''] ?? r.territory_code ?? '',
        r.status === 'critique' ? 'Critique' : 'Vigilance',
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
  const nInconnu   = useMemo(() => rows.filter((r) => r.status === 'inconnu').length,   [rows])

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
          const hay = [r.serial_number, r.client_name, r.site_name]
            .join(' ')
            .toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        // Critique en premier
        if (a.status !== b.status) return a.status === 'critique' ? -1 : 1
        // Puis par date d'échéance ASC (plus urgent en haut)
        const da = nextExpiry(a)
        const db = nextExpiry(b)
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return da.localeCompare(db)
      })
  }, [rows, actif, territory, showCritique, showVigilance, raison, search])

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

  return (
    <div className="p-6 lg:p-8 max-w-screen-xl mx-auto">

      <div className="mb-4">
        <BackButton label="Tableau de bord" />
      </div>

      {/* ── En-tête ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Alertes</h1>
          <p className="text-sm text-slate-500 mt-1">
            <span className="inline-flex items-center gap-1 font-semibold text-red-600">
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              {nCritique} critique{nCritique > 1 ? 's' : ''}
            </span>
            <span className="text-slate-300 mx-2">·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              {nVigilance} vigilance
            </span>
            <span className="text-slate-300 mx-2">·</span>
            <span className="text-slate-500">{rows.length} alertes au total</span>
          </p>
        </div>

        <button
          onClick={() => exportCSV(filtered)}
          className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Exporter ({filtered.length})
        </button>
      </div>

      {/* ── Barre de filtres ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">

          {/* Recherche texte */}
          <div className="flex-1 min-w-52">
            <label className="block text-xs font-medium text-slate-500 mb-1">Recherche</label>
            <div className="relative">
              <svg className="absolute left-2.5 top-2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={search}
                placeholder="N° série, client, site…"
                onChange={(e) => { setSearch(e.target.value); resetPage() }}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Territoire */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Territoire</label>
            <select
              value={territory}
              onChange={(e) => { setTerritory(e.target.value); resetPage() }}
              className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="all">Tous</option>
              <option value="REU">La Réunion</option>
              <option value="MYT">Mayotte</option>
              <option value="GLP">Guadeloupe</option>
            </select>
          </div>

          {/* Actif / Inactif */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Équipements</label>
            <select
              value={actif}
              onChange={(e) => { setActif(e.target.value as typeof actif); resetPage() }}
              className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="actif">Actifs uniquement</option>
              <option value="inactif">Inactifs uniquement</option>
              <option value="tous">Tous</option>
            </select>
          </div>

          {/* Raison */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Raison</label>
            <select
              value={raison}
              onChange={(e) => { setRaison(e.target.value as RaisonFilter); resetPage() }}
              className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="all">Toutes les raisons</option>
              <option value="batterie">Batterie expirée</option>
              <option value="electrodes">Électrodes expirées</option>
              <option value="maintenance">Maintenance échue</option>
              <option value="vigilance30">Échéance &lt; 30 jours</option>
            </select>
          </div>

          {/* Statuts (checkboxes) */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Statut</label>
            <div className="flex items-center gap-3 py-1.5">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showCritique}
                  onChange={(e) => { setShowCritique(e.target.checked); resetPage() }}
                  className="w-3.5 h-3.5 accent-red-600 cursor-pointer"
                />
                <span className="text-sm text-slate-700">Critique</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showVigilance}
                  onChange={(e) => { setShowVigilance(e.target.checked); resetPage() }}
                  className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                />
                <span className="text-sm text-slate-700">Vigilance</span>
              </label>
              {nInconnu > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showInconnu}
                    onChange={(e) => { setShowInconnu(e.target.checked); resetPage() }}
                    className="w-3.5 h-3.5 accent-slate-500 cursor-pointer"
                  />
                  <span className="text-sm text-slate-700">Inconnu</span>
                </label>
              )}
            </div>
          </div>

          {/* Reset */}
          {(territory !== 'all' || raison !== 'all' || actif !== 'actif' || !showCritique || !showVigilance || showInconnu || search) && (
            <button
              onClick={() => {
                setTerritory('all')
                setRaison('all')
                setActif('actif')
                setShowCritique(true)
                setShowVigilance(true)
                setShowInconnu(false)
                setSearch('')
                setPage(1)
              }}
              className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2 py-1.5"
            >
              Réinitialiser
            </button>
          )}
        </div>
      </div>

      {/* ── Tableau ──────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-20 flex flex-col items-center gap-2 text-center">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <p className="text-sm text-slate-400">Aucune alerte ne correspond aux filtres sélectionnés.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {['N° série', 'Marque / Modèle', 'Client', 'Site', 'Territoire', 'Statut', 'Raison', 'Prochaine échéance'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                    <th className="sticky right-0 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pageRows.map((row) => {
                    const expiry  = nextExpiry(row)
                    const expired = isExpired(expiry)
                    const brand   = [row.brand, row.model].filter(Boolean).join(' ')

                    return (
                      <tr key={row.id} className="hover:bg-blue-50/30 transition-colors">
                        {/* N° série */}
                        <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                          {row.serial_number ?? <span className="text-slate-400">—</span>}
                        </td>

                        {/* Marque / Modèle */}
                        <td className="px-4 py-3 max-w-[180px]">
                          <span className="block truncate text-slate-700" title={brand || undefined}>
                            {brand || <span className="text-slate-400">—</span>}
                          </span>
                        </td>

                        {/* Client */}
                        <td className="px-4 py-3 max-w-[160px]">
                          <span className="block truncate text-slate-600" title={row.client_name ?? undefined}>
                            {row.client_name ?? <span className="text-slate-400">—</span>}
                          </span>
                        </td>

                        {/* Site */}
                        <td className="px-4 py-3 max-w-[160px]">
                          <span className="block truncate text-slate-600" title={row.site_name ?? undefined}>
                            {row.site_name ?? <span className="text-slate-400">—</span>}
                          </span>
                        </td>

                        {/* Territoire */}
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {TERRITORY_LABELS[row.territory_code ?? ''] ?? row.territory_code ?? (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Statut */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <DAEStatusBadge status={row.status} />
                        </td>

                        {/* Raison */}
                        <td className="px-4 py-3 max-w-[200px]">
                          <span className="block truncate text-slate-600" title={row.status_reason ?? undefined}>
                            {row.status_reason ?? <span className="text-slate-400">—</span>}
                          </span>
                        </td>

                        {/* Prochaine échéance */}
                        <td className={`px-4 py-3 whitespace-nowrap font-medium tabular-nums ${expired ? 'text-red-600' : 'text-slate-700'}`}>
                          {fmtDate(expiry)}
                          {expired && (
                            <span className="ml-1 text-[10px] font-semibold text-red-500 uppercase tracking-wide">
                              échue
                            </span>
                          )}
                        </td>

                        {/* Actions — sticky droite */}
                        <td className="sticky right-0 bg-white px-4 py-3 whitespace-nowrap shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.06)]">
                          <Link
                            href={`/parc/${row.id}`}
                            className="text-xs font-semibold text-[#AF2125] hover:underline"
                          >
                            Voir la fiche →
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              <p className="text-xs text-slate-500">
                {filtered.length === 0 ? '0' : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)}`}
                {' '}sur{' '}
                <span className="font-medium text-slate-700">{filtered.length}</span> alertes
                {filtered.length !== rows.length && (
                  <span className="text-slate-400"> (filtrées sur {rows.length})</span>
                )}
              </p>

              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Préc.
                  </button>
                  {pageNumbers().map((n) => (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      className={`w-7 py-1 text-xs font-medium rounded border transition-colors ${
                        n === safePage
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Suiv. →
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
