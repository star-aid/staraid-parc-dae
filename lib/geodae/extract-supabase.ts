// Contrôle Géo'DAE, source par défaut : la copie Supabase des équipements
// Synchroteam (table defibrillators, remplie par la synchronisation quotidienne).
//
// Produit exactement la même forme que l'extraction directe (extract-synchroteam.ts)
// pour que la page ne connaisse qu'un seul format. Différences :
//   - réponse immédiate, données datées de la dernière synchronisation ;
//   - le compte d'origine est déduit du préfixe de l'identifiant Synchroteam
//     ('' Réunion, 'GLP_' Guadeloupe, 'MYT_' Mayotte, cf. buildAccounts) ;
//   - le mapping des champs a déjà été appliqué par la synchronisation.
// Fichier serveur uniquement.

import { createServiceClient } from '@/lib/supabase'
import { buildAccounts } from '@/lib/sync-territory-route'
import { isLocationContract } from '@/lib/geodae/extract-synchroteam'
import type { AccountExtraction, ContractTypeCount, ExtractionResult, LocationDae } from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

const ACCOUNTS: TerritoryCode[] = ['REU', 'MYT', 'GLP']
const PAGE = 1000

/** Ligne lue dans defibrillators, avec les noms du client et du site */
interface DbRow {
  synchroteam_id: string
  serial_number: string | null
  geo_dae_id: string | null
  contract_type: string | null
  brand: string | null
  model: string | null
  synced_at: string | null
  client: { name: string | null } | null
  site: { name: string | null } | null
}

/** Compte Synchroteam et identifiant brut, d'après le préfixe posé par la synchronisation */
export function splitSynchroteamId(id: string): { account: TerritoryCode; rawId: string } {
  if (id.startsWith('GLP_')) return { account: 'GLP', rawId: id.slice(4) }
  if (id.startsWith('MYT_')) return { account: 'MYT', rawId: id.slice(4) }
  return { account: 'REU', rawId: id }
}

function str(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

async function fetchActiveRows(): Promise<DbRow[]> {
  const supabase = createServiceClient()
  const rows: DbRow[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('defibrillators')
      .select('synchroteam_id, serial_number, geo_dae_id, contract_type, brand, model, synced_at, client:clients(name), site:sites(name)')
      .eq('active', true)
      .order('synchroteam_id')
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw new Error(`lecture de la copie Supabase (defibrillators) : ${error.message}`)
    const batch = (data ?? []) as unknown as DbRow[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

/** DAE actifs sous contrat de location, d'après la copie Supabase. */
export async function extractLocationDaeFromDb(): Promise<ExtractionResult> {
  const started = Date.now()
  const all = await fetchActiveRows()

  const byAccount = new Map<TerritoryCode, DbRow[]>(ACCOUNTS.map((a) => [a, []]))
  for (const row of all) byAccount.get(splitSynchroteamId(row.synchroteam_id).account)!.push(row)

  const accounts: AccountExtraction[] = []
  const rows: LocationDae[] = []
  let newest: string | null = null

  for (const account of ACCOUNTS) {
    const list = byAccount.get(account)!
    const typeCounts = new Map<string, number>()
    let syncedAt: string | null = null
    const summary: AccountExtraction = {
      account,
      // Un compte est « configuré » s'il a ses variables ou si la synchronisation l'a déjà alimenté
      configured: buildAccounts(account) !== null || list.length > 0,
      active_total: list.length,
      location_total: 0,
      with_geo_dae_id: 0,
      without_geo_dae_id: 0,
      without_serial: 0,
      contract_types_seen: [],
      mapping_source: 'copie Supabase (synchronisation quotidienne)',
      missing_fields: [],
      error: null,
      duration_ms: 0,
      synced_at: null,
    }

    for (const r of list) {
      const contractType = str(r.contract_type) ?? '(aucun)'
      typeCounts.set(contractType, (typeCounts.get(contractType) ?? 0) + 1)
      if (r.synced_at && (!syncedAt || r.synced_at > syncedAt)) syncedAt = r.synced_at
      if (!isLocationContract(contractType)) continue

      const row: LocationDae = {
        account,
        synchroteam_id: splitSynchroteamId(r.synchroteam_id).rawId,
        name: str([r.brand, r.model].filter(Boolean).join(' ')),
        customer_name: str(r.client?.name),
        site_name: str(r.site?.name),
        serial_number: str(r.serial_number),
        geo_dae_id: str(r.geo_dae_id),
        contract_type: contractType,
      }
      rows.push(row)
      summary.location_total++
      if (row.geo_dae_id) summary.with_geo_dae_id++
      else summary.without_geo_dae_id++
      if (!row.serial_number) summary.without_serial++
    }

    summary.contract_types_seen = Array.from(typeCounts, ([type, count]): ContractTypeCount => ({
      type, count, is_location: isLocationContract(type),
    })).sort((a, b) => b.count - a.count)
    summary.synced_at = syncedAt
    summary.duration_ms = Date.now() - started
    if (syncedAt && (!newest || syncedAt > newest)) newest = syncedAt
    accounts.push(summary)
  }

  rows.sort((a, b) => a.account.localeCompare(b.account) || (a.serial_number ?? '').localeCompare(b.serial_number ?? ''))

  const totals = accounts.reduce(
    (acc, a) => ({
      active_total: acc.active_total + a.active_total,
      location_total: acc.location_total + a.location_total,
      with_geo_dae_id: acc.with_geo_dae_id + a.with_geo_dae_id,
      without_geo_dae_id: acc.without_geo_dae_id + a.without_geo_dae_id,
      without_serial: acc.without_serial + a.without_serial,
    }),
    { active_total: 0, location_total: 0, with_geo_dae_id: 0, without_geo_dae_id: 0, without_serial: 0 }
  )

  return {
    extracted_at: newest ?? new Date().toISOString(),
    source: 'supabase',
    accounts,
    totals,
    rows,
    warning: all.length === 0 ? 'Aucun DAE actif dans la copie Supabase : lancer une synchronisation (bouton « Actualiser depuis Synchroteam »).' : null,
  }
}
