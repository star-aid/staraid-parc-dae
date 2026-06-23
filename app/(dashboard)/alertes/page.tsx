export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import AlertesClient, { type AlertRow } from './AlertesClient'

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
  clients: { name: string } | null
  sites: { name: string } | null
  territories: { code: string; name: string } | null
}

async function getAlerts(): Promise<AlertRow[]> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('defibrillators')
      .select(`
        id, serial_number, model, brand, status, status_reason,
        battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry, next_maintenance_date,
        clients(name),
        sites(name),
        territories(code, name)
      `)
      .eq('active', true)
      .in('status', ['critique', 'vigilance'])
      .limit(1000)

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

export default async function AlertesPage() {
  const rows = await getAlerts()
  return <AlertesClient rows={rows} />
}
