// Comparaison des dates de dernière maintenance Synchroteam ↔ Géo'DAE, pour
// chaque DAE actif en location déjà apparié (identifiant Géo'DAE renseigné).
//
//   - Côté Synchroteam, la référence est le champ « Date dernière Maintenance »
//     de la fiche équipement (champ interne last_maintenance_field, recopié par
//     la synchronisation dans custom_fields). Décision du 30/09/2026 : la
//     dernière intervention terminée n'est pas forcément une maintenance (un
//     dépannage, par exemple) ; elle reste affichée à titre d'information.
//   - Côté Géo'DAE, la date déclarée vient de l'open data (colonne c_dermnt),
//     publiée pour toutes les fiches du SIREN, sans compte.
//
// Le module ne décide rien : il calcule l'écart en jours, la page en déduit la
// situation pour la tolérance choisie (maintenanceSituation dans types.ts).
// Aucune écriture ici ; l'écriture vers Synchroteam est dans writeback.ts.
// Fichier serveur uniquement.

import { createServiceClient } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/supabase-rows'
import { LOCATION_TYPES } from '@/lib/contract-groups'
import { listOpenDataBySiren } from '@/lib/geodae/client'
import { splitSynchroteamId } from '@/lib/geodae/extract-supabase'
import type { MaintenanceResult, MaintenanceRow } from '@/lib/geodae/types'

const CACHE_TTL_MS = 60_000

interface DbRow {
  id: string
  synchroteam_id: string
  serial_number: string | null
  geo_dae_id: string | null
  last_maintenance_date: string | null
  synced_at: string | null
  custom_fields: Record<string, unknown> | null
  client: { name: string | null } | null
  site: { name: string | null } | null
}

function str(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

/** Date Synchroteam ou Géo'DAE → yyyy-mm-dd (accepte dd/mm/yyyy, ISO, horodatage) */
export function toIsoDate(val: unknown): string | null {
  const raw = str(val)
  if (!raw) return null
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw)
  const normalized = fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : raw
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000)
}

async function compute(): Promise<MaintenanceResult> {
  const siren = process.env.GEODAE_SIREN?.trim()
  if (!siren) throw new Error("GEODAE_SIREN non configuré : impossible de lire les dates Géo'DAE")
  const supabase = createServiceClient()

  const [rows, openData] = await Promise.all([
    fetchAllRows<DbRow>('lecture des DAE en location appariés', (from, to, withCount) =>
      supabase
        .from('defibrillators')
        .select('id, synchroteam_id, serial_number, geo_dae_id, last_maintenance_date, synced_at, custom_fields, client:clients(name), site:sites(name)', withCount ? { count: 'exact' } : undefined)
        .eq('active', true)
        .in('contract_type', LOCATION_TYPES)
        .not('geo_dae_id', 'is', null)
        .order('synchroteam_id')
        .range(from, to),
      { expectedPages: 2 }
    ),
    listOpenDataBySiren(siren),
  ])

  const geoByGid = new Map(openData.map((g) => [g.gid, g]))
  let geodaeUpdatedAt: string | null = null
  for (const g of openData) if (g.maj_don && (!geodaeUpdatedAt || g.maj_don > geodaeUpdatedAt)) geodaeUpdatedAt = g.maj_don

  let fieldMapped = false
  let newest: string | null = null
  let unpaired = 0
  const out: MaintenanceRow[] = []
  for (const r of rows) {
    if (r.synced_at && (!newest || r.synced_at > newest)) newest = r.synced_at
    const gid = str(r.geo_dae_id)
    if (!gid) continue
    const geo = geoByGid.get(gid)
    if (!geo) { unpaired++; continue }
    const { account, rawId } = splitSynchroteamId(r.synchroteam_id)
    const fieldRaw = r.custom_fields?.last_maintenance_field
    if (fieldRaw !== undefined) fieldMapped = true
    const synchroteamDate = toIsoDate(fieldRaw)
    const geodaeDate = toIsoDate(geo.dermnt)
    out.push({
      account,
      synchroteam_id: rawId,
      defibrillator_id: r.id,
      serial_number: str(r.serial_number),
      geo_dae_id: gid,
      customer_name: str(r.client?.name),
      site_name: str(r.site?.name),
      synchroteam_date: synchroteamDate,
      last_intervention_date: toIsoDate(r.last_maintenance_date),
      geodae_date: geodaeDate,
      geodae_name: geo.nom,
      gap_days: synchroteamDate && geodaeDate ? daysBetween(synchroteamDate, geodaeDate) : null,
    })
  }

  return {
    extracted_at: newest ?? new Date().toISOString(),
    geodae_updated_at: geodaeUpdatedAt,
    field_mapped: fieldMapped,
    totals: { location_with_gid: rows.length, paired: out.length, unpaired },
    rows: out,
    warning: rows.length === 0 ? 'Aucun DAE en location avec identifiant Géo\'DAE dans la copie Supabase.' : null,
  }
}

// ── Cache mémoire (par instance serveur) ─────────────────────────────────────
let cache: { at: number; promise: Promise<MaintenanceResult> } | null = null

export function invalidateMaintenanceCache(): void {
  cache = null
}

/** Comparaison des dates, gardée une minute en mémoire ; `fresh` force la relecture. */
export async function compareMaintenance(opts: { fresh?: boolean } = {}): Promise<MaintenanceResult> {
  if (opts.fresh || !cache || Date.now() - cache.at > CACHE_TTL_MS) {
    const promise = compute().catch((err: unknown) => {
      cache = null
      throw err
    })
    cache = { at: Date.now(), promise }
  }
  const result = await cache.promise
  return { ...result, rows: result.rows.map((r) => ({ ...r })) }
}
