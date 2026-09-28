// Résultats de recherche Géo'DAE conservés par DAE (table geodae_lookups,
// migration 20260928000012). Fichier serveur uniquement.
//
// Une ligne par DAE (compte + identifiant Synchroteam), remplacée à chaque
// contrôle. Tant que la migration n'est pas appliquée, les fonctions signalent
// l'indisponibilité sans faire échouer la recherche ni le journal.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase'
import type { JournalItem, LocationDae, PersistedLookup } from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

export const LOOKUPS_HINT =
  'Table des résultats de recherche absente : appliquer la migration supabase/migrations/20260928000012_geodae_lookups.sql dans Supabase.'

type PgError = { code?: string; message?: string } | null

/** Vrai si la table manque ou si le rôle service n'a pas ses droits (migration 12 non appliquée). */
function isUnavailable(error: PgError): boolean {
  if (!error) return false
  return (
    error.code === '42P01' || error.code === 'PGRST205' || error.code === '42501' ||
    /does not exist|Could not find the table|permission denied/i.test(error.message ?? '')
  )
}

const STATUS: Record<JournalItem['outcome'], PersistedLookup['status']> = {
  found: 'trouve',
  ambiguous: 'ambigu',
  not_found: 'introuvable',
  error: 'erreur',
}

export function lookupKey(account: TerritoryCode, synchroteamId: string): string {
  return `${account}:${synchroteamId}`
}

const PAGE = 1000

/** Charge tous les résultats conservés, indexés par compte + identifiant Synchroteam. */
export async function loadPersistedLookups(): Promise<{ byKey: Map<string, PersistedLookup>; reason: string | null }> {
  const supabase = createServiceClient()
  const byKey = new Map<string, PersistedLookup>()
  type Row = PersistedLookup & { account: TerritoryCode; synchroteam_id: string }
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('geodae_lookups')
      .select('account, synchroteam_id, status, geodae_gid, candidates, sources, error, checked_at, checked_by, reported_at')
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) {
      return { byKey, reason: isUnavailable(error) ? LOOKUPS_HINT : `résultats de recherche illisibles : ${error.message}` }
    }
    const batch = (data ?? []) as unknown as Row[]
    for (const { account, synchroteam_id, ...rest } of batch) byKey.set(lookupKey(account, synchroteam_id), rest)
    if (batch.length < PAGE) break
  }
  return { byKey, reason: null }
}

/** Attache à chaque ligne extraite son dernier résultat de recherche conservé. */
export function attachLookups(rows: LocationDae[], byKey: Map<string, PersistedLookup>): void {
  for (const r of rows) r.lookup = byKey.get(lookupKey(r.account, r.synchroteam_id)) ?? null
}

/**
 * Enregistre (ou remplace) le résultat de recherche de chaque DAE.
 * Un nouveau contrôle annule la trace d'un report précédent (reported_at) :
 * si le DAE est de nouveau sans identifiant, la situation est à reprendre.
 */
export async function saveLookups(
  supabase: SupabaseClient,
  items: JournalItem[],
  defibrillatorIdFor: (item: JournalItem) => string | null,
  checkedBy: string | null,
  runId: string | null
): Promise<{ saved: number; reason?: string }> {
  const now = new Date().toISOString()
  const rows = items.map((item) => ({
    account: item.account,
    synchroteam_id: item.synchroteam_id,
    defibrillator_id: defibrillatorIdFor(item),
    serial_number: item.serial_number,
    status: STATUS[item.outcome],
    geodae_gid: item.outcome === 'found' && item.candidates.length === 1 ? item.candidates[0].gid : null,
    candidates: item.candidates,
    sources: item.sources ?? null,
    error: item.error ?? null,
    checked_at: now,
    checked_by: checkedBy,
    run_id: runId,
    reported_at: null,
    updated_at: now,
  }))

  let saved = 0
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200)
    const { error } = await supabase.from('geodae_lookups').upsert(batch, { onConflict: 'account,synchroteam_id' })
    if (error) {
      if (isUnavailable(error)) return { saved, reason: LOOKUPS_HINT }
      throw new Error(`résultats de recherche (enregistrement) : ${error.message}`)
    }
    saved += batch.length
  }
  return { saved }
}

/** Marque le résultat conservé d'un DAE comme reporté dans Synchroteam (au mieux). */
export async function markLookupReported(
  supabase: SupabaseClient,
  ref: { account: TerritoryCode; synchroteam_id: string },
  at: string
): Promise<void> {
  await supabase
    .from('geodae_lookups')
    .update({ reported_at: at, updated_at: at })
    .eq('account', ref.account)
    .eq('synchroteam_id', ref.synchroteam_id)
}
