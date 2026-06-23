import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
import ParcFiltersBar from '@/components/table/ParcFiltersBar'
import { DAEStatusBadge, ConsumableStatus } from '@/components/table/StatusBadge'
import type { MapMarker } from '@/components/map/ParcMap'

const ParcMapDynamic = dynamicImport(() => import('@/components/map/ParcMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <svg viewBox="0 0 24 24" className="w-8 h-8 animate-pulse" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        <span className="text-sm">Chargement de la carte…</span>
      </div>
    </div>
  ),
})

const PAGE_SIZE = 50

type SortCol = 'serial_number' | 'model' | 'status' | 'next_maintenance_date' | 'last_maintenance_date' | 'battery_expiry'
type SortDir = 'asc' | 'desc'

interface SearchParams {
  q?: string
  territoire?: string
  statut?: string
  sort?: SortCol
  dir?: SortDir
  page?: string
  vue?: string
}

type ParcRow = {
  id: string
  serial_number: string | null
  model: string | null
  brand: string | null
  status: string
  status_reason: string | null
  battery_status: string
  electrodes_status: string
  last_maintenance_date: string | null
  next_maintenance_date: string | null
  battery_expiry: string | null
  electrodes_adult_expiry: string | null
  clients:     { name: string } | null
  sites:       { name: string } | null
  territories: { code: string; name: string } | null
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function urgencyClass(s: string | null) {
  if (!s) return ''
  const d = new Date(s)
  const now = new Date()
  if (d < now) return 'text-red-600 font-semibold'
  const days = (d.getTime() - now.getTime()) / 86_400_000
  if (days <= 30) return 'text-amber-600 font-medium'
  return 'text-slate-600'
}

function sortUrl(col: string, activeSort: string, activeDir: string, sp: SearchParams) {
  const p = new URLSearchParams()
  if (sp.q)          p.set('q', sp.q)
  if (sp.territoire) p.set('territoire', sp.territoire)
  if (sp.statut)     p.set('statut', sp.statut)
  const nextDir = col === activeSort && activeDir === 'asc' ? 'desc' : 'asc'
  p.set('sort', col)
  p.set('dir', nextDir)
  return `/parc?${p.toString()}`
}

function pageUrl(page: number, sp: SearchParams) {
  const p = new URLSearchParams()
  if (sp.q)          p.set('q', sp.q)
  if (sp.territoire) p.set('territoire', sp.territoire)
  if (sp.statut)     p.set('statut', sp.statut)
  if (sp.sort)       p.set('sort', sp.sort)
  if (sp.dir)        p.set('dir', sp.dir)
  if (page > 1)      p.set('page', String(page))
  return `/parc?${p.toString()}`
}

/** Construit l'URL du toggle vue en préservant les filtres actifs */
function viewUrl(vue: 'tableau' | 'carte', sp: SearchParams) {
  const p = new URLSearchParams()
  if (sp.q)          p.set('q', sp.q)
  if (sp.territoire) p.set('territoire', sp.territoire)
  if (sp.statut)     p.set('statut', sp.statut)
  if (vue === 'carte') p.set('vue', 'carte')
  return `/parc?${p.toString()}`
}

function SortTh({
  col, label, sort, dir, sp, className = '',
}: {
  col: string; label: string; sort: string; dir: string; sp: SearchParams; className?: string
}) {
  const active = sort === col
  return (
    <th className={`px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap ${className}`}>
      <Link href={sortUrl(col, sort, dir, sp)} className="flex items-center gap-1 hover:text-slate-800 transition-colors group">
        {label}
        <span className={`text-[10px] ${active ? 'text-slate-700' : 'text-slate-300 group-hover:text-slate-400'}`}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </Link>
    </th>
  )
}

export default async function ParcPage({ searchParams }: { searchParams: SearchParams }) {
  const q         = (searchParams.q ?? '').trim()
  const terr      = searchParams.territoire?.split(',').filter(Boolean) ?? []
  const stat      = searchParams.statut?.split(',').filter(Boolean) ?? []
  const vue       = searchParams.vue === 'carte' ? 'carte' : 'tableau'
  const sort: SortCol = (['serial_number','model','status','next_maintenance_date','last_maintenance_date','battery_expiry'].includes(searchParams.sort ?? '')
    ? searchParams.sort! : 'next_maintenance_date')
  const dir: SortDir  = searchParams.dir === 'desc' ? 'desc' : 'asc'
  const page      = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const offset    = (page - 1) * PAGE_SIZE

  const supabase = createServiceClient()

  // ── Vue carte : marqueurs GPS depuis defibrillators → sites ─────────────
  let mapMarkers: MapMarker[] = []
  if (vue === 'carte') {
    type RawMapRow = {
      id: string
      serial_number: string | null
      model: string | null
      status: string
      status_reason: string | null
      battery_expiry: string | null
      electrodes_adult_expiry: string | null
      electrodes_pediatric_expiry: string | null
      next_maintenance_date: string | null
      clients:     { name: string } | null
      territories: { code: string } | null
      sites:       { name: string; latitude: number | null; longitude: number | null } | null
    }

    const PAGE = 1000
    for (let p = 0; ; p++) {
      const { data: batch } = await supabase
        .from('defibrillators')
        .select(`
          id, serial_number, model, status, status_reason,
          battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry, next_maintenance_date,
          clients(name),
          territories(code),
          sites(name, latitude, longitude)
        `)
        .eq('active', true)
        .order('id')
        .range(p * PAGE, (p + 1) * PAGE - 1)

      if (!batch?.length) break

      for (const raw of batch as unknown as RawMapRow[]) {
        const site = raw.sites
        if (!site?.latitude || !site?.longitude) continue

        const next_expiry =
          [raw.battery_expiry, raw.electrodes_adult_expiry, raw.electrodes_pediatric_expiry, raw.next_maintenance_date]
            .filter((x): x is string => !!x)
            .sort()[0] ?? null

        mapMarkers.push({
          id:             raw.id,
          latitude:       site.latitude,
          longitude:      site.longitude,
          status:         raw.status,
          status_reason:  raw.status_reason,
          site_name:      site.name,
          client_name:    raw.clients?.name ?? null,
          serial_number:  raw.serial_number,
          model:          raw.model,
          territory_code: raw.territories?.code ?? null,
          next_expiry,
        })
      }

      if (batch.length < PAGE) break
    }
  }

  // ── Vue tableau : requête paginée ────────────────────────────────────────
  let territoryIds: string[] = []
  if (terr.length > 0) {
    const { data: terrs } = await supabase.from('territories').select('id').in('code', terr)
    territoryIds = terrs?.map((t: { id: string }) => t.id) ?? []
  }

  let query = supabase
    .from('defibrillators')
    .select(
      `id, serial_number, model, brand,
       status, status_reason, battery_status, electrodes_status,
       last_maintenance_date, next_maintenance_date, battery_expiry, electrodes_adult_expiry,
       clients(name), sites(name), territories(code, name)`,
      { count: 'exact' }
    )
    .eq('active', true)

  if (q) query = query.or(`serial_number.ilike.%${q}%,model.ilike.%${q}%,brand.ilike.%${q}%`)
  if (terr.length > 0 && territoryIds.length > 0) query = query.in('territory_id', territoryIds)
  if (stat.length > 0) query = query.in('status', stat)

  query = query
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })
    .range(offset, offset + PAGE_SIZE - 1)

  const { data: rows, count, error } = await query

  const daes   = (rows ?? []) as unknown as ParcRow[]
  const total  = count ?? 0
  const pages  = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const csvData = daes.map((d) => ({
    'N° série':             d.serial_number ?? '',
    'Modèle':               d.model ?? '',
    'Marque':               d.brand ?? '',
    'Client':               d.clients?.name ?? '',
    'Site':                 d.sites?.name ?? '',
    'Territoire':           d.territories?.code ?? '',
    'Statut':               d.status,
    'Raison statut':        d.status_reason ?? '',
    'Dernière maintenance': fmtDate(d.last_maintenance_date),
    'Prochaine échéance':   fmtDate(d.next_maintenance_date),
    'Batterie':             d.battery_status,
    'DLU batterie':         fmtDate(d.battery_expiry),
    'Électrodes':           d.electrodes_status,
    'DLU électrodes':       fmtDate(d.electrodes_adult_expiry),
  }))

  return (
    <div className="p-6 lg:p-8 max-w-screen-2xl mx-auto">
      {/* En-tête */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Parc DAE</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {vue === 'tableau'
              ? <>{total.toLocaleString('fr-FR')} équipements actifs{(terr.length > 0 || stat.length > 0 || q) && ' — filtrés'}</>
              : <>{mapMarkers.length.toLocaleString('fr-FR')} marqueurs GPS disponibles</>
            }
          </p>
        </div>

        {/* Toggle tableau / carte */}
        <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden shadow-sm">
          <Link
            href={viewUrl('tableau', searchParams)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              vue === 'tableau'
                ? 'bg-slate-800 text-white'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 10h18M3 14h18M10 3v18M3 3h18v18H3z"/>
            </svg>
            Tableau
          </Link>
          <Link
            href={viewUrl('carte', searchParams)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-l border-slate-200 ${
              vue === 'carte'
                ? 'bg-slate-800 text-white'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            Carte
          </Link>
        </div>
      </div>

      {/* Barre de filtres (commune tableau + carte) */}
      <ParcFiltersBar
        total={vue === 'tableau' ? total : mapMarkers.length}
        shown={vue === 'tableau' ? daes.length : mapMarkers.length}
        csvData={vue === 'tableau' ? csvData : []}
      />

      {error && vue === 'tableau' && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Erreur chargement : {error.message}
        </div>
      )}

      {/* ── Vue carte ────────────────────────────────────────────── */}
      {vue === 'carte' && (
        <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm" style={{ height: 'calc(100vh - 280px)', minHeight: '480px' }}>
          {mapMarkers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center bg-slate-50 gap-3">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <p className="text-sm text-slate-500 font-medium">Aucun DAE localisé sur la carte</p>
              <p className="text-xs text-slate-400 max-w-xs text-center">
                Les coordonnées GPS sont géocodées automatiquement depuis les adresses.
                La couverture augmente à chaque synchronisation.
              </p>
            </div>
          ) : (
            <ParcMapDynamic
              markers={mapMarkers}
              statusFilter={stat}
              territoryFilter={terr}
            />
          )}
        </div>
      )}

      {/* ── Vue tableau ──────────────────────────────────────────── */}
      {vue === 'tableau' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <SortTh col="serial_number"         label="N° série"             sort={sort} dir={dir} sp={searchParams} />
                  <SortTh col="model"                  label="Modèle"               sort={sort} dir={dir} sp={searchParams} />
                  <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Client</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Site</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Territoire</th>
                  <SortTh col="status"                 label="Statut"               sort={sort} dir={dir} sp={searchParams} />
                  <SortTh col="last_maintenance_date"  label="Dernière maintenance"  sort={sort} dir={dir} sp={searchParams} />
                  <SortTh col="next_maintenance_date"  label="Prochaine échéance"    sort={sort} dir={dir} sp={searchParams} />
                  <SortTh col="battery_expiry"         label="Batterie"             sort={sort} dir={dir} sp={searchParams} />
                  <th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Électrodes</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {daes.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-sm text-slate-400">
                      Aucun DAE ne correspond aux filtres sélectionnés.
                    </td>
                  </tr>
                ) : (
                  daes.map((dae) => (
                    <tr key={dae.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3">
                        <span className="font-mono text-xs text-slate-700">
                          {dae.serial_number ?? <span className="text-slate-300">—</span>}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-xs text-slate-700 font-medium leading-tight">{dae.model ?? '—'}</div>
                        {dae.brand && dae.brand !== dae.model && (
                          <div className="text-[10px] text-slate-400">{dae.brand}</div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-slate-600 max-w-[140px] truncate block" title={dae.clients?.name ?? ''}>
                          {dae.clients?.name ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-slate-500 max-w-[120px] truncate block" title={dae.sites?.name ?? ''}>
                          {dae.sites?.name ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {dae.territories ? (
                          <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {dae.territories.code}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div><DAEStatusBadge status={dae.status} /></div>
                        {dae.status_reason && (
                          <div className="text-[10px] text-slate-400 mt-0.5">{dae.status_reason}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(dae.last_maintenance_date)}</td>
                      <td className="px-3 py-3">
                        <span className={`text-xs ${urgencyClass(dae.next_maintenance_date)}`}>
                          {fmtDate(dae.next_maintenance_date)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <ConsumableStatus status={dae.battery_status} date={dae.battery_expiry} />
                      </td>
                      <td className="px-3 py-3">
                        <ConsumableStatus status={dae.electrodes_status} date={dae.electrodes_adult_expiry} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/parc/${dae.id}`}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
                        >
                          Voir →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50">
              <span className="text-xs text-slate-500">
                Page {page} / {pages} — {total.toLocaleString('fr-FR')} résultats
              </span>
              <div className="flex items-center gap-1">
                {page > 1 && (
                  <Link href={pageUrl(page - 1, searchParams)} className="px-2.5 py-1.5 text-xs rounded-md border border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 transition-colors">
                    ← Préc.
                  </Link>
                )}
                {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
                  const p = pages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= pages - 3 ? pages - 6 + i : page - 3 + i
                  return (
                    <Link
                      key={p}
                      href={pageUrl(p, searchParams)}
                      className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                        p === page
                          ? 'bg-blue-600 border-blue-600 text-white font-medium'
                          : 'border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300'
                      }`}
                    >
                      {p}
                    </Link>
                  )
                })}
                {page < pages && (
                  <Link href={pageUrl(page + 1, searchParams)} className="px-2.5 py-1.5 text-xs rounded-md border border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 transition-colors">
                    Suiv. →
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
