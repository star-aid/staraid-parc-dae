import { Suspense } from 'react'
export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/supabase-rows'
import AlertesClient, { type AlertRow } from './AlertesClient'
import { parseContratParam, parseAutreTypesParam, buildContratOrFilter } from '@/lib/contract-groups'

// Forme des lignes retournées par Supabase avec les relations imbriquées
type RawRow = {
  id: string
  serial_number: string | null
  model: string | null
  brand: string | null
  status: string
  status_reason: string | null
  battery_expiry: string | null
  electrodes_adult_expiry: string | null
  electrodes_pediatric_expiry: string | null
  next_maintenance_date: string | null
  active: boolean
  clients: { name: string } | null
  sites: { name: string } | null
  territories: { code: string; name: string } | null
}

// Cache mémoire par instance serveur : la liste ne change qu'à la synchronisation
// quotidienne et au recalcul des statuts. Une minute suffit pour rendre les
// retours sur la page instantanés sans afficher de données périmées.
const ALERTS_TTL_MS = 60_000
const alertsCache = new Map<string, { at: number; promise: Promise<AlertRow[]> }>()

async function fetchAlerts(contratFilter: string | null, clientId: string | null): Promise<AlertRow[]> {
  const supabase = createServiceClient()

  // Filtre client via OR (client_id direct OU site_id via le site du client)
  let clientOrFilter: string | null = null
  if (clientId) {
    const { data: cs } = await supabase.from('sites').select('id').eq('client_id', clientId).limit(100)
    const siteIds = (cs ?? []).map((s: { id: string }) => s.id)
    const parts = [`client_id.eq.${clientId}`]
    if (siteIds.length > 0) parts.push(`site_id.in.(${siteIds.join(',')})`)
    clientOrFilter = parts.join(',')
  }

  // Toutes les lignes, pages lues en parallèle : l'ancienne limite à 1 000 lignes
  // laissait de côté les DAE au-delà (1 293 concernés le 28/09/2026) sans prévenir.
  const rows = await fetchAllRows<RawRow>('alertes', (from, to, withCount) => {
    let q = supabase
      .from('defibrillators')
      .select(`
        id, serial_number, model, brand, status, status_reason,
        battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry, next_maintenance_date,
        active,
        clients(name),
        sites(name),
        territories(code, name)
      `, withCount ? { count: 'exact' } : undefined)
      .in('status', ['critique', 'vigilance', 'inconnu'])
      .order('id')
      .range(from, to)
    if (contratFilter)  q = q.or(contratFilter)
    if (clientOrFilter) q = q.or(clientOrFilter)
    return q
  }, { expectedPages: 2 })

  return rows.map((d) => ({
    id:                       d.id,
    serial_number:            d.serial_number,
    model:                    d.model,
    brand:                    d.brand,
    status:                   d.status as 'critique' | 'vigilance' | 'inconnu',
    status_reason:            d.status_reason,
    battery_expiry:           d.battery_expiry,
    electrodes_adult_expiry:  d.electrodes_adult_expiry,
    electrodes_pediatric_expiry: d.electrodes_pediatric_expiry,
    next_maintenance_date:    d.next_maintenance_date,
    active:                   d.active,
    client_name:    (d.clients    as { name: string } | null)?.name    ?? null,
    site_name:      (d.sites      as { name: string } | null)?.name    ?? null,
    territory_code: (d.territories as { code: string; name: string } | null)?.code ?? null,
    territory_name: (d.territories as { code: string; name: string } | null)?.name ?? null,
  }))
}

async function getAlerts(contratFilter: string | null, clientId: string | null): Promise<AlertRow[]> {
  const key = `${contratFilter ?? ''}|${clientId ?? ''}`
  const hit = alertsCache.get(key)
  if (hit && Date.now() - hit.at < ALERTS_TTL_MS) return hit.promise
  const promise = fetchAlerts(contratFilter, clientId).catch((err: unknown) => {
    alertsCache.delete(key)
    console.error('getAlerts:', err)
    return [] as AlertRow[]
  })
  alertsCache.set(key, { at: Date.now(), promise })
  return promise
}

export default async function AlertesPage({
  searchParams,
}: {
  searchParams?: { contrat?: string; autreTypes?: string; client?: string; statut?: string; [key: string]: string | undefined }
}) {
  const contratFilter = buildContratOrFilter(
    parseContratParam(searchParams?.contrat),
    parseAutreTypesParam(searchParams?.autreTypes),
  )
  const clientId = searchParams?.client ?? null
  const rows = await getAlerts(contratFilter, clientId)
  return <Suspense><AlertesClient rows={rows} /></Suspense>
}
