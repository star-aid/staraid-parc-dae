import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { ArrowUp, ChevronRight, ChevronsUpDown, MapPin, SearchX, Table2 } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
import ParcFiltersBar from '@/components/table/ParcFiltersBar'
import { DAEStatusBadge, ConsumableStatus } from '@/components/table/StatusBadge'
import type { MapMarker } from '@/components/map/ParcMap'
import { parseContratParam, parseAutreTypesParam, buildContratOrFilter } from '@/lib/contract-groups'
import {
  EmptyState, LinkButton, Notice, PageContainer, PageHeader, Tag, cx, pageButtonClass, stickyColClass, tableFooterClass,
  tableClass, tableWrapClass, tbodyClass, tdClass, thClass, theadClass, trClass,
} from '@/components/ui/primitives'

const ParcMapDynamic = dynamicImport(() => import('@/components/map/ParcMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-muted text-fg-faint">
      <MapPin className="h-7 w-7 animate-pulse" />
      <span className="text-body">Chargement de la carte…</span>
    </div>
  ),
})

const PAGE_SIZE = 50

type SortCol = 'serial_number' | 'model' | 'active' | 'status' | 'next_maintenance_date' | 'last_maintenance_date' | 'battery_expiry'
type SortDir = 'asc' | 'desc'

interface SearchParams {
  q?: string
  territoire?: string
  statut?: string
  contrat?: string
  autreTypes?: string
  client?: string
  actif?: string
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
  active: boolean
  status: string
  status_reason: string | null
  battery_status: string
  electrodes_status: string
  last_maintenance_date: string | null
  next_maintenance_date: string | null
  battery_expiry: string | null
  electrodes_adult_expiry: string | null
  electrodes_pediatric_expiry: string | null
  clients:     { name: string } | null
  sites:       { name: string } | null
  territories: { code: string; name: string } | null
}

/** Retourne la date la plus critique (la plus proche ou expirée) entre deux dates */
function criticalDate(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a <= b ? a : b
}

/** Vrai si b est strictement plus urgente que a */
function isPediatricMoreCritical(adult: string | null, ped: string | null): boolean {
  if (!ped) return false
  if (!adult) return true
  return ped < adult
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function urgencyClass(s: string | null) {
  if (!s) return ''
  const d = new Date(s)
  const now = new Date()
  if (d < now) return 'text-danger font-semibold'
  const days = (d.getTime() - now.getTime()) / 86_400_000
  if (days <= 30) return 'text-warning font-medium'
  return 'text-fg-secondary'
}

function sortUrl(col: string, activeSort: string, activeDir: string, sp: SearchParams) {
  const p = new URLSearchParams()
  if (sp.q)          p.set('q', sp.q)
  if (sp.territoire) p.set('territoire', sp.territoire)
  if (sp.statut)     p.set('statut', sp.statut)
  if (sp.contrat)    p.set('contrat', sp.contrat)
  if (sp.autreTypes) p.set('autreTypes', sp.autreTypes)
  if (sp.client)     p.set('client', sp.client)
  if (sp.actif && sp.actif !== 'actif') p.set('actif', sp.actif)
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
  if (sp.contrat)    p.set('contrat', sp.contrat)
  if (sp.autreTypes) p.set('autreTypes', sp.autreTypes)
  if (sp.client)     p.set('client', sp.client)
  if (sp.actif && sp.actif !== 'actif') p.set('actif', sp.actif)
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
  if (sp.contrat)    p.set('contrat', sp.contrat)
  if (sp.client)     p.set('client', sp.client)
  if (sp.actif && sp.actif !== 'actif') p.set('actif', sp.actif)
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
    <th className={cx(thClass, className)} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <Link href={sortUrl(col, sort, dir, sp)} className={cx('group inline-flex items-center gap-1 transition-colors hover:text-fg', active && 'text-fg')}>
        {label}
        {active
          ? <ArrowUp className={cx('h-3 w-3 text-brand transition-transform', dir === 'desc' && 'rotate-180')} />
          : <ChevronsUpDown className="h-3 w-3 text-border-strong group-hover:text-fg-faint" />}
      </Link>
    </th>
  )
}

// Sélecteur Tableau / Carte : pastilles sur rail gris, même dessin que les filtres
const VIEW_TAB        = 'inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-caption font-semibold transition-colors'
const VIEW_TAB_ACTIVE = 'bg-fg text-white shadow-sm'
const VIEW_TAB_IDLE   = 'text-fg-secondary hover:bg-surface hover:text-fg'

export default async function ParcPage({ searchParams }: { searchParams: SearchParams }) {
  const q         = (searchParams.q ?? '').trim()
  const terr      = searchParams.territoire?.split(',').filter(Boolean) ?? []
  const stat      = searchParams.statut?.split(',').filter(Boolean) ?? []
  const actif     = searchParams.actif ?? 'actif'
  const vue       = searchParams.vue === 'carte' ? 'carte' : 'tableau'
  const sort: SortCol = (['serial_number','model','active','status','next_maintenance_date','last_maintenance_date','battery_expiry'].includes(searchParams.sort ?? '')
    ? searchParams.sort! : 'next_maintenance_date')
  const dir: SortDir  = searchParams.dir === 'desc' ? 'desc' : 'asc'
  const page      = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const offset    = (page - 1) * PAGE_SIZE
  const contratGroups = parseContratParam(searchParams.contrat)
  const contratFilter = buildContratOrFilter(contratGroups, parseAutreTypesParam(searchParams.autreTypes))
  const clientId  = searchParams.client ?? null

  const supabase = createServiceClient()

  // Pré-requête sites du client sélectionné → filtre OR (client_id OU site_id)
  // Nécessaire car defibrillators.client_id peut être NULL quand l'association
  // est portée par le site et non l'équipement dans Synchroteam.
  let clientSiteIds: string[] = []
  let selectedClientName: string | null = null
  if (clientId) {
    const [{ data: cs }, { data: cl }] = await Promise.all([
      supabase.from('sites').select('id').eq('client_id', clientId).limit(100),
      supabase.from('clients').select('name').eq('id', clientId).maybeSingle(),
    ])
    clientSiteIds = (cs ?? []).map((s: { id: string }) => s.id)
    selectedClientName = cl?.name ?? null
  }
  function buildClientOrFilter(): string | null {
    if (!clientId) return null
    const parts = [`client_id.eq.${clientId}`]
    if (clientSiteIds.length > 0) parts.push(`site_id.in.(${clientSiteIds.join(',')})`)
    return parts.join(',')
  }
  const clientOrFilter = buildClientOrFilter()

  // ── Vue carte : marqueurs GPS depuis defibrillators → sites ─────────────
  const mapMarkers: MapMarker[] = []
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
      let batchQ = supabase
        .from('defibrillators')
        .select(`
          id, serial_number, model, status, status_reason,
          battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry, next_maintenance_date,
          clients(name),
          territories(code),
          sites(name, latitude, longitude)
        `)
        .order('id')
        .range(p * PAGE, (p + 1) * PAGE - 1)
      if (actif === 'actif')   batchQ = batchQ.eq('active', true)
      if (actif === 'inactif') batchQ = batchQ.eq('active', false)
      if (contratFilter)   batchQ = batchQ.or(contratFilter)
      if (clientOrFilter)  batchQ = batchQ.or(clientOrFilter)
      const { data: batch } = await batchQ

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
  // Requêtes préparatoires (territoires filtrés, clients correspondant à la
  // recherche) lancées en parallèle : un seul aller-retour au lieu de deux.
  const [terrsRes, matchedClientsRes] = await Promise.all([
    terr.length > 0
      ? supabase.from('territories').select('id').in('code', terr)
      : Promise.resolve({ data: null as Array<{ id: string }> | null }),
    q
      // Limites volontairement basses pour rester dans les limites d'URL PostgREST
      ? supabase.from('clients').select('id').ilike('name', `%${q}%`).order('name').limit(20)
      : Promise.resolve({ data: null as Array<{ id: string }> | null }),
  ])
  const territoryIds: string[] = (terrsRes.data ?? []).map((t: { id: string }) => t.id)

  let query = supabase
    .from('defibrillators')
    .select(
      `id, serial_number, model, brand, active,
       status, status_reason, battery_status, electrodes_status,
       last_maintenance_date, next_maintenance_date, battery_expiry,
       electrodes_adult_expiry, electrodes_pediatric_expiry,
       clients(name), sites(name), territories(code, name)`,
      { count: 'exact' }
    )
  if (actif === 'actif')   query = query.eq('active', true)
  if (actif === 'inactif') query = query.eq('active', false)

  // Recherche texte : N° série, modèle, marque + noms de clients correspondants
  if (q) {
    const matchedClientIds = (matchedClientsRes.data ?? []).map((c: { id: string }) => c.id)

    // Sites des clients trouvés (fallback quand client_id est NULL sur le DAE)
    let matchedSiteIds: string[] = []
    if (matchedClientIds.length > 0) {
      const { data: matchedSites } = await supabase
        .from('sites')
        .select('id')
        .in('client_id', matchedClientIds)
        .limit(80)
      matchedSiteIds = (matchedSites ?? []).map((s: { id: string }) => s.id)
    }

    const orParts = [`serial_number.ilike.%${q}%`, `model.ilike.%${q}%`, `brand.ilike.%${q}%`]
    if (matchedClientIds.length > 0) orParts.push(`client_id.in.(${matchedClientIds.join(',')})`)
    if (matchedSiteIds.length > 0) orParts.push(`site_id.in.(${matchedSiteIds.join(',')})`)
    query = query.or(orParts.join(','))
  }

  if (terr.length > 0 && territoryIds.length > 0) query = query.in('territory_id', territoryIds)
  if (stat.length > 0) query = query.in('status', stat)
  if (contratFilter)  query = query.or(contratFilter)
  if (clientOrFilter) query = query.or(clientOrFilter)

  query = query
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })
    .range(offset, offset + PAGE_SIZE - 1)

  const { data: rows, count, error } = await query

  const daes   = (rows ?? []) as unknown as ParcRow[]
  const total  = count ?? 0
  const pages  = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <PageContainer className="max-w-[1600px]">
      <PageHeader
        title="Parc DAE"
        subtitle={
          selectedClientName
            ? <>Client : <span className="font-medium text-fg-secondary">{selectedClientName}</span></>
            : vue === 'tableau'
              ? <span className="tabular-nums">
                  {total.toLocaleString('fr-FR')} équipement{total > 1 ? 's' : ''}
                  {actif === 'actif' ? ' actifs' : actif === 'inactif' ? ' inactifs' : ''}
                  {(terr.length > 0 || stat.length > 0 || q) ? ', filtrés' : ''}
                </span>
              : <span className="tabular-nums">{mapMarkers.length.toLocaleString('fr-FR')} DAE géolocalisés</span>
        }
        actions={
          <div className="inline-flex items-center gap-0.5 rounded-control bg-surface-sunken p-0.5" aria-label="Mode d'affichage">
            <Link href={viewUrl('tableau', searchParams)} aria-current={vue === 'tableau' ? 'page' : undefined} className={cx(VIEW_TAB, vue === 'tableau' ? VIEW_TAB_ACTIVE : VIEW_TAB_IDLE)}>
              <Table2 className="h-3.5 w-3.5" />
              Tableau
            </Link>
            <Link href={viewUrl('carte', searchParams)} aria-current={vue === 'carte' ? 'page' : undefined} className={cx(VIEW_TAB, vue === 'carte' ? VIEW_TAB_ACTIVE : VIEW_TAB_IDLE)}>
              <MapPin className="h-3.5 w-3.5" />
              Carte
            </Link>
          </div>
        }
      />

      {/* Barre de filtres (commune tableau + carte) */}
      <ParcFiltersBar
        total={vue === 'tableau' ? total : mapMarkers.length}
        shown={vue === 'tableau' ? daes.length : mapMarkers.length}
      />

      {error && vue === 'tableau' && (
        <Notice tone="danger" className="mb-3">Erreur de chargement : {error.message}</Notice>
      )}

      {/* ── Vue carte ──────────────────────────────────────────────────────── */}
      {vue === 'carte' && (
        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card" style={{ height: 'calc(100vh - 240px)', minHeight: '480px' }}>
          {mapMarkers.length === 0 ? (
            <EmptyState
              icon={MapPin}
              className="h-full"
              title="Aucun DAE localisé sur la carte"
              description="Les coordonnées GPS sont géocodées automatiquement depuis les adresses. La couverture augmente à chaque synchronisation."
            />
          ) : (
            <ParcMapDynamic
              key={`map-${searchParams.contrat ?? 'all'}-${clientId ?? 'all'}`}
              markers={mapMarkers}
              statusFilter={stat}
              territoryFilter={terr}
            />
          )}
        </div>
      )}

      {/* ── Vue tableau ────────────────────────────────────────────────────── */}
      {vue === 'tableau' && (
        <div className={cx(tableWrapClass, 'overflow-hidden')}>
          {/* rotateX(180deg) fait remonter la barre de défilement sous l'en-tête */}
          <div className="overflow-x-auto" style={{ transform: 'rotateX(180deg)' }}>
            <div style={{ transform: 'rotateX(180deg)' }}>
              <table className={cx(tableClass, 'min-w-full w-max')}>
                <thead className={theadClass}>
                  <tr>
                    <SortTh col="serial_number"        label="N° série"              sort={sort} dir={dir} sp={searchParams} />
                    <SortTh col="model"                label="Modèle"                sort={sort} dir={dir} sp={searchParams} />
                    <th className={thClass}>Client</th>
                    <th className={thClass}>Site</th>
                    <th className={thClass}>Territoire</th>
                    {actif === 'tous' && (
                      <SortTh col="active" label="Parc" sort={sort} dir={dir} sp={searchParams} />
                    )}
                    <SortTh col="status"                label="Statut"                sort={sort} dir={dir} sp={searchParams} />
                    <SortTh col="last_maintenance_date" label="Dernière maintenance"  sort={sort} dir={dir} sp={searchParams} />
                    <SortTh col="next_maintenance_date" label="Prochaine échéance"    sort={sort} dir={dir} sp={searchParams} />
                    <SortTh col="battery_expiry"        label="Batterie"              sort={sort} dir={dir} sp={searchParams} />
                    <th className={thClass}>Électrodes</th>
                    <th className={cx(thClass, stickyColClass, 'bg-surface-muted text-right')}>Fiche</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {daes.length === 0 ? (
                    <tr>
                      <td colSpan={actif === 'tous' ? 12 : 11}>
                        <EmptyState icon={SearchX} title="Aucun DAE ne correspond aux filtres sélectionnés." description="Élargissez les filtres ou effacez la recherche." />
                      </td>
                    </tr>
                  ) : (
                    daes.map((dae) => (
                      <tr key={dae.id} className={trClass}>
                        <td className={cx(tdClass, 'whitespace-nowrap font-mono text-caption font-medium text-fg')}>
                          {dae.serial_number ?? <span className="text-border-strong">—</span>}
                        </td>
                        <td className={tdClass}>
                          <div className="leading-tight text-fg">{dae.model ?? '—'}</div>
                          {dae.brand && dae.brand !== dae.model && (
                            <div className="text-label text-fg-faint">{dae.brand}</div>
                          )}
                        </td>
                        <td className={cx(tdClass, 'max-w-[170px]')}>
                          <span className="block truncate text-fg-secondary" title={dae.clients?.name ?? ''}>{dae.clients?.name ?? '—'}</span>
                        </td>
                        <td className={cx(tdClass, 'max-w-[150px]')}>
                          <span className="block truncate text-fg-muted" title={dae.sites?.name ?? ''}>{dae.sites?.name ?? '—'}</span>
                        </td>
                        <td className={tdClass}>
                          {dae.territories ? (
                            <Tag tone="neutral" className="font-mono">{dae.territories.code}</Tag>
                          ) : '—'}
                        </td>
                        {actif === 'tous' && (
                          <td className={tdClass}>
                            {dae.active ? (
                              <span className="inline-flex items-center gap-1.5 rounded-control bg-success-soft px-1.5 py-0.5 text-label font-semibold text-success ring-1 ring-inset ring-success/20">
                                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />Actif
                              </span>
                            ) : (
                              <Tag tone="neutral" dot>Inactif</Tag>
                            )}
                          </td>
                        )}
                        <td className={tdClass}>
                          <DAEStatusBadge status={dae.status} />
                          {dae.status_reason && <div className="mt-0.5 text-label text-fg-faint">{dae.status_reason}</div>}
                        </td>
                        <td className={cx(tdClass, 'whitespace-nowrap text-caption text-fg-muted tabular-nums')}>{fmtDate(dae.last_maintenance_date)}</td>
                        <td className={cx(tdClass, 'whitespace-nowrap text-caption tabular-nums', urgencyClass(dae.next_maintenance_date))}>
                          {fmtDate(dae.next_maintenance_date)}
                        </td>
                        <td className={cx(tdClass, 'whitespace-nowrap')}>
                          <ConsumableStatus status={dae.battery_status} date={dae.battery_expiry} />
                        </td>
                        <td className={cx(tdClass, 'whitespace-nowrap')}>
                          <ConsumableStatus
                            status={dae.electrodes_status}
                            date={criticalDate(dae.electrodes_adult_expiry, dae.electrodes_pediatric_expiry)}
                          />
                          {isPediatricMoreCritical(dae.electrodes_adult_expiry, dae.electrodes_pediatric_expiry) && (
                            <div className="mt-0.5 text-label font-medium text-warning">pédiatriques</div>
                          )}
                        </td>
                        <td className={cx(tdClass, stickyColClass, 'whitespace-nowrap bg-surface text-right')}>
                          <Link prefetch={false} href={`/parc/${dae.id}`} className="inline-flex items-center gap-0.5 text-caption font-semibold text-brand hover:underline">
                            Voir
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className={tableFooterClass}>
              <span className="tabular-nums">
                Page {page} / {pages}, {total.toLocaleString('fr-FR')} résultats
              </span>
              <div className="flex items-center gap-1">
                {page > 1 && (
                  <LinkButton href={pageUrl(page - 1, searchParams)} variant="secondary" size="xs">Précédent</LinkButton>
                )}
                {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
                  const p = pages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= pages - 3 ? pages - 6 + i : page - 3 + i
                  return (
                    <Link key={p} href={pageUrl(p, searchParams)} aria-current={p === page ? 'page' : undefined} className={pageButtonClass(p === page)}>
                      {p}
                    </Link>
                  )
                })}
                {page < pages && (
                  <LinkButton href={pageUrl(page + 1, searchParams)} variant="secondary" size="xs">Suivant</LinkButton>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  )
}