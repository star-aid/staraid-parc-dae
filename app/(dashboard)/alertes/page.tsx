export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
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

async function getAlerts(contratFilter: string | null, clientId: string | null): Promise<AlertRow[]> {
  try {
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

    let q = supabase
      .from('defibrillators')
      .select(`
        id, serial_number, model, brand, status, status_reason,
        battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry, next_maintenance_date,
        active,
        clients(name),
        sites(name),
        territories(code, name)
      `)
      .in('status', ['critique', 'vigilance'])
      .limit(1000)
    if (contratFilter)  q = q.or(contratFilter)
    if (clientOrFilter) q = q.or(clientOrFilter)
    const { data, error } = await q

    if (error) throw error

    return ((data ?? []) as unknown as RawRow[]).map((d) => ({
      id:                       d.id,
      serial_number:            d.serial_number,
      model:                    d.model,
      brand:                    d.brand,
      status:                   d.status as 'critique' | 'vigilance',
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
  } catch (err) {
    console.error('getAlerts:', err)
    return []
  }
}

export default async function AlertesPage({
  searchParams,
}: {
  searchParams?: { contrat?: string; autreTypes?: string; client?: string; [key: string]: string | undefined }
}) {
  const contratFilter = buildContratOrFilter(
    parseContratParam(searchParams?.contrat),
    parseAutreTypesParam(searchParams?.autreTypes),
  )
  const clientId = searchParams?.client ?? null
  const rows = await getAlerts(contratFilter, clientId)
  return <AlertesClient rows={rows} />
}
