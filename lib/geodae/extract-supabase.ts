// Contrôle Géo'DAE, source par défaut : la copie Supabase des équipements
// Synchroteam (table defibrillators, remplie par la synchronisation quotidienne).
//
// Produit exactement la même forme que l'extraction directe (extract-synchroteam.ts)
// pour que la page ne connaisse qu'un seul format. Différences :
//   - réponse immédiate, données datées de la dernière synchronisation ;
//   - le compte d'origine est déduit du préfixe de l'identifiant Synchroteam
//     ('' Réunion, 'GLP_' Guadeloupe, 'MYT_' Mayotte, cf. buildAccounts) ;
//   - le mapping des champs a déjà été appliqué par la synchronisation.
//
// Performance : chaque aller-retour vers Supabase coûte 250 à 400 ms depuis les
// territoires. Les pages d'une même requête sont donc chargées en parallèle,
// les deux requêtes (DAE en location avec jointures, DAE actifs sans jointure
// pour les compteurs) aussi, et le résultat est gardé une minute en mémoire.
// Fichier serveur uniquement.

import { createServiceClient } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/supabase-rows'
import { buildAccounts } from '@/lib/sync-territory-route'
import { LOCATION_TYPES } from '@/lib/contract-groups'
import { isLocationContract } from '@/lib/geodae/extract-synchroteam'
import type { AccountExtraction, ContractTypeCount, ExtractionResult, LocationDae } from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

const ACCOUNTS: TerritoryCode[] = ['REU', 'MYT', 'GLP']
const CACHE_TTL_MS = 60_000

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

/** Ligne légère pour les compteurs par compte (tous les DAE actifs) */
interface LightRow {
  synchroteam_id: string
  contract_type: string | null
  synced_at: string | null
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

async function computeExtraction(): Promise<ExtractionResult> {
  const started = Date.now()
  const supabase = createServiceClient()

  const [located, actives] = await Promise.all([
    // DAE actifs en location, avec client et site : la liste de travail
    fetchAllRows<DbRow>('lecture de la copie Supabase (defibrillators)', (from, to, withCount) =>
      supabase
        .from('defibrillators')
        .select('synchroteam_id, serial_number, geo_dae_id, contract_type, brand, model, synced_at, client:clients(name), site:sites(name)', withCount ? { count: 'exact' } : undefined)
        .eq('active', true)
        .in('contract_type', LOCATION_TYPES)
        .order('synchroteam_id')
        .range(from, to),
      { expectedPages: 2 } // ~1 100 DAE en location : deux pages demandées d'emblée
    ),
    // Tous les DAE actifs, sans jointure : compteurs et types de contrat par compte
    fetchAllRows<LightRow>('lecture des DAE actifs', (from, to, withCount) =>
      supabase
        .from('defibrillators')
        .select('synchroteam_id, contract_type, synced_at', withCount ? { count: 'exact' } : undefined)
        .eq('active', true)
        .order('synchroteam_id')
        .range(from, to),
      { expectedPages: 3 } // ~2 300 DAE actifs : trois pages demandées d'emblée
    ),
  ])

  const summaries = new Map<TerritoryCode, AccountExtraction>(ACCOUNTS.map((account) => [account, {
    account,
    configured: buildAccounts(account) !== null,
    active_total: 0,
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
  }]))
  const typeCounts = new Map<TerritoryCode, Map<string, number>>(ACCOUNTS.map((a) => [a, new Map()]))
  let newest: string | null = null

  for (const r of actives) {
    const { account } = splitSynchroteamId(r.synchroteam_id)
    const s = summaries.get(account)!
    s.active_total++
    // Un compte est « configuré » s'il a ses variables ou si la synchronisation l'a déjà alimenté
    s.configured = true
    const contractType = str(r.contract_type) ?? '(aucun)'
    const tc = typeCounts.get(account)!
    tc.set(contractType, (tc.get(contractType) ?? 0) + 1)
    if (r.synced_at && (!s.synced_at || r.synced_at > s.synced_at)) s.synced_at = r.synced_at
    if (r.synced_at && (!newest || r.synced_at > newest)) newest = r.synced_at
  }

  const rows: LocationDae[] = []
  for (const r of located) {
    const { account, rawId } = splitSynchroteamId(r.synchroteam_id)
    const contractType = str(r.contract_type) ?? '(aucun)'
    if (!isLocationContract(contractType)) continue
    const row: LocationDae = {
      account,
      synchroteam_id: rawId,
      name: str([r.brand, r.model].filter(Boolean).join(' ')),
      customer_name: str(r.client?.name),
      site_name: str(r.site?.name),
      serial_number: str(r.serial_number),
      geo_dae_id: str(r.geo_dae_id),
      contract_type: contractType,
    }
    rows.push(row)
    const s = summaries.get(account)!
    s.location_total++
    if (row.geo_dae_id) s.with_geo_dae_id++
    else s.without_geo_dae_id++
    if (!row.serial_number) s.without_serial++
  }

  const accounts = ACCOUNTS.map((account) => {
    const s = summaries.get(account)!
    s.contract_types_seen = Array.from(typeCounts.get(account)!, ([type, count]): ContractTypeCount => ({
      type, count, is_location: isLocationContract(type),
    })).sort((a, b) => b.count - a.count)
    s.duration_ms = Date.now() - started
    return s
  })

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
    warning: actives.length === 0 ? 'Aucun DAE actif dans la copie Supabase : lancer une synchronisation (bouton « Actualiser depuis Synchroteam »).' : null,
  }
}

// ── Cache mémoire (par instance serveur) ─────────────────────────────────────
let cache: { at: number; promise: Promise<ExtractionResult> } | null = null

/** À appeler quand la copie change hors synchronisation (report d'identifiant, par exemple). */
export function invalidateExtractCache(): void {
  cache = null
}

/**
 * DAE actifs sous contrat de location, d'après la copie Supabase.
 * Résultat gardé une minute en mémoire ; `fresh` force la relecture.
 * Le résultat renvoyé est une copie : les appelants peuvent l'enrichir sans toucher au cache.
 */
export async function extractLocationDaeFromDb(opts: { fresh?: boolean } = {}): Promise<ExtractionResult> {
  if (opts.fresh || !cache || Date.now() - cache.at > CACHE_TTL_MS) {
    const promise = computeExtraction().catch((err: unknown) => {
      cache = null
      throw err
    })
    cache = { at: Date.now(), promise }
  }
  const result = await cache.promise
  return { ...result, accounts: result.accounts.map((a) => ({ ...a })), rows: result.rows.map((r) => ({ ...r })) }
}
