// Journal du contrôle Synchroteam ↔ Géo'DAE : exécutions et anomalies.
// Fichier serveur uniquement (client Supabase avec rôle service).
//
// Tables : geodae_reconciliation_runs et geodae_anomalies, créées par la
// migration 20260922000009_geodae_reconciliation.sql. Tant qu'elle n'est pas
// appliquée, les fonctions signalent l'indisponibilité au lieu d'échouer.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase'
import type {
  AnomalyRow, AnomalyType, JournalItem, JournalRun, JournalSummary, WritebackRequest, WritebackResult, WritebackRow,
} from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

export const MIGRATION_HINT =
  'Tables du journal absentes : appliquer la migration supabase/migrations/20260922000009_geodae_reconciliation.sql dans Supabase.'

export const GRANTS_HINT =
  'Droits manquants sur les tables du journal : appliquer la migration supabase/migrations/20260928000010_geodae_grants.sql dans Supabase.'

export const WRITEBACK_HINT =
  'Table des reports absente : appliquer la migration supabase/migrations/20260928000011_geodae_writebacks.sql dans Supabase.'

// Préfixe des identifiants Synchroteam dans la table defibrillators, par compte
// (cf. buildAccounts dans lib/sync-territory-route.ts)
const ID_PREFIX: Record<TerritoryCode, string> = { REU: '', GLP: 'GLP_', MYT: 'MYT_' }

type PgError = { code?: string; message?: string } | null

/** Vrai si l'erreur signale une table inexistante (migration non appliquée). */
function isMissingTable(error: PgError): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|Could not find the table/i.test(error.message ?? '')
}

/** Vrai si le rôle service n'a pas les droits sur la table (migration des droits non appliquée). */
function isPermissionDenied(error: PgError): boolean {
  if (!error) return false
  return error.code === '42501' || /permission denied/i.test(error.message ?? '')
}

/** Raison d'indisponibilité du journal, ou null si l'erreur est d'une autre nature. */
function unavailableReason(error: PgError, hints = { missing: MIGRATION_HINT, denied: GRANTS_HINT }): string | null {
  if (isMissingTable(error)) return hints.missing
  if (isPermissionDenied(error)) return hints.denied
  return null
}

// La migration 11 crée la table et ses droits : un seul indice dans les deux cas
const WRITEBACK_HINTS = { missing: WRITEBACK_HINT, denied: WRITEBACK_HINT }

function outcomeType(item: JournalItem): AnomalyType | null {
  if (item.outcome === 'not_found') return 'absent_geodae'
  if (item.outcome === 'ambiguous') return 'ambigu'
  if (item.outcome === 'error') return 'erreur_recherche'
  return null
}

/** Résout les UUID locaux des DAE (table defibrillators) pour lier les anomalies aux fiches. */
async function resolveDefibrillatorIds(
  supabase: SupabaseClient,
  items: Array<{ account: TerritoryCode; synchroteam_id: string }>
): Promise<Map<string, string>> {
  const keys = Array.from(new Set(items.map((i) => `${ID_PREFIX[i.account] ?? ''}${i.synchroteam_id}`)))
  const map = new Map<string, string>()
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await supabase
      .from('defibrillators')
      .select('id, synchroteam_id')
      .in('synchroteam_id', keys.slice(i, i + 200))
    for (const d of (data ?? []) as Array<{ id: string; synchroteam_id: string }>) map.set(d.synchroteam_id, d.id)
  }
  return map
}

export interface RecordResult {
  persisted: boolean
  reason?: string
  run_id: string | null
  anomalies_upserted: number
  resolved: number
}

/**
 * Enregistre le résultat d'une ou plusieurs recherches.
 * - introuvable / ambigu / erreur → anomalie ouverte (créée ou rouverte)
 * - trouvé → clôture des anomalies ouvertes du DAE
 * - createRun → une ligne d'exécution regroupe le lot (recherche groupée)
 */
export async function recordLookupRun(params: {
  items: JournalItem[]
  triggeredBy: string | null
  scope: string | null
  createRun: boolean
}): Promise<RecordResult> {
  const { items, triggeredBy, scope, createRun } = params
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  const counts = {
    examined:  items.length,
    found:     items.filter((i) => i.outcome === 'found').length,
    ambiguous: items.filter((i) => i.outcome === 'ambiguous').length,
    not_found: items.filter((i) => i.outcome === 'not_found').length,
    errors:    items.filter((i) => i.outcome === 'error').length,
  }
  const sources = items.find((i) => i.sources)?.sources ?? null

  // ── Exécution ─────────────────────────────────────────────────────────────
  let runId: string | null = null
  if (createRun) {
    const { data, error } = await supabase
      .from('geodae_reconciliation_runs')
      .insert({ triggered_by: triggeredBy, scope, ...counts, sources, started_at: now, finished_at: now })
      .select('id')
      .single()
    if (error) {
      const reason = unavailableReason(error)
      if (reason) return { persisted: false, reason, run_id: null, anomalies_upserted: 0, resolved: 0 }
      throw new Error(`journal (exécution) : ${error.message}`)
    }
    runId = (data as { id: string }).id
  }

  const daeIds = await resolveDefibrillatorIds(supabase, items)

  // ── Anomalies à ouvrir ou rouvrir ─────────────────────────────────────────
  const rows = items.flatMap((item) => {
    const type = outcomeType(item)
    if (!type) return []
    return [{
      run_id: runId,
      type,
      account: item.account,
      synchroteam_id: item.synchroteam_id,
      defibrillator_id: daeIds.get(`${ID_PREFIX[item.account] ?? ''}${item.synchroteam_id}`) ?? null,
      serial_number: item.serial_number,
      synchroteam_geo_dae_id: item.synchroteam_geo_dae_id,
      geodae_gid: item.candidates.length === 1 ? item.candidates[0].gid : null,
      details: {
        candidates: item.candidates.map((c) => ({ gid: c.gid, nom: c.nom, source: c.source, etat_fonct: c.etat_fonct })),
        error: item.error ?? null,
        sources: item.sources ?? null,
      },
      last_seen_at: now,
      resolved_at: null,   // une anomalie revue est rouverte
      resolution: null,
    }]
  })

  let upserted = 0
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200)
    const { error } = await supabase.from('geodae_anomalies').upsert(batch, { onConflict: 'anomaly_key' })
    if (error) {
      const reason = unavailableReason(error)
      if (reason) return { persisted: false, reason, run_id: runId, anomalies_upserted: 0, resolved: 0 }
      throw new Error(`journal (anomalies) : ${error.message}`)
    }
    upserted += batch.length
  }

  // ── Clôture des anomalies des DAE désormais trouvés ───────────────────────
  let resolved = 0
  const found = items.filter((i) => i.outcome === 'found')
  const byAccount = new Map<TerritoryCode, JournalItem[]>()
  for (const f of found) byAccount.set(f.account, [...(byAccount.get(f.account) ?? []), f])

  for (const [account, list] of Array.from(byAccount.entries())) {
    for (let i = 0; i < list.length; i += 200) {
      const slice: JournalItem[] = list.slice(i, i + 200)
      const { data, error } = await supabase
        .from('geodae_anomalies')
        .update({ resolved_at: now, resolution: 'identifiant retrouvé par la recherche' })
        .eq('account', account)
        .in('synchroteam_id', slice.map((s) => s.synchroteam_id))
        .in('type', ['absent_geodae', 'ambigu', 'erreur_recherche'])
        .is('resolved_at', null)
        .select('id')
      if (error) throw new Error(`journal (clôture) : ${error.message}`)
      resolved += (data ?? []).length
    }
  }

  return { persisted: true, run_id: runId, anomalies_upserted: upserted, resolved }
}

export interface WritebackRecord {
  persisted: boolean
  reason?: string
  /** Anomalies ouvertes du DAE clôturées par le report */
  resolved: number
}

/**
 * Trace un report d'identifiant vers Synchroteam (réussi ou non), puis, en cas
 * de succès, clôt les anomalies ouvertes du DAE et met à jour la copie locale
 * (table defibrillators) sans attendre la synchronisation du matin.
 */
export async function recordWriteback(params: {
  request: WritebackRequest
  result: WritebackResult
  writtenBy: string | null
}): Promise<WritebackRecord> {
  const { request, result, writtenBy } = params
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  const localKey = `${ID_PREFIX[request.account] ?? ''}${request.synchroteam_id}`
  const localId = (await resolveDefibrillatorIds(supabase, [request])).get(localKey) ?? null

  const { error } = await supabase.from('geodae_writebacks').insert({
    account: request.account,
    synchroteam_id: request.synchroteam_id,
    defibrillator_id: localId,
    serial_number: request.serial_number,
    geodae_gid: request.gid,
    previous_value: result.ok ? result.previous_value : null,
    status: result.ok ? 'ok' : 'erreur',
    verified: result.ok ? result.verified : false,
    error: result.ok ? null : result.error,
    written_by: writtenBy,
    written_at: now,
  })
  if (error) {
    const reason = unavailableReason(error, WRITEBACK_HINTS)
    if (reason) return { persisted: false, reason, resolved: 0 }
    throw new Error(`journal (report) : ${error.message}`)
  }
  if (!result.ok) return { persisted: true, resolved: 0 }

  // L'identifiant est désormais dans Synchroteam : les anomalies du DAE n'ont plus lieu d'être
  let resolved = 0
  const { data, error: closeErr } = await supabase
    .from('geodae_anomalies')
    .update({ resolved_at: now, resolution: `identifiant ${request.gid} reporté dans Synchroteam` })
    .eq('account', request.account)
    .eq('synchroteam_id', request.synchroteam_id)
    .is('resolved_at', null)
    .select('id')
  if (closeErr) {
    if (!unavailableReason(closeErr)) throw new Error(`journal (clôture) : ${closeErr.message}`)
  } else {
    resolved = (data ?? []).length
  }

  // Copie locale, au mieux : la synchronisation quotidienne fera foi de toute façon
  if (localId) await supabase.from('defibrillators').update({ geo_dae_id: request.gid }).eq('id', localId)

  return { persisted: true, resolved }
}

/** Dernières exécutions, anomalies ouvertes et reports, pour l'encart « Journal des contrôles ». */
export async function getJournalSummary(): Promise<JournalSummary> {
  const supabase = createServiceClient()

  const [runsRes, openRes, wbRes] = await Promise.all([
    supabase.from('geodae_reconciliation_runs').select('*').order('started_at', { ascending: false }).limit(10),
    supabase.from('geodae_anomalies').select('*').is('resolved_at', null).order('last_seen_at', { ascending: false }).limit(200),
    supabase.from('geodae_writebacks').select('*', { count: 'exact' }).order('written_at', { ascending: false }).limit(10),
  ])

  const err = runsRes.error ?? openRes.error
  if (err) {
    const reason = unavailableReason(err)
    if (reason) return { available: false, reason, runs: [], open_by_type: {}, open_anomalies: [], open_total: 0, writebacks: [], writebacks_total: 0 }
    throw new Error(`journal (lecture) : ${err.message}`)
  }

  // Les reports (migration 11) sont optionnels : leur absence n'invalide pas le journal
  let writebacks: WritebackRow[] = []
  let writebacks_total = 0
  let writebacks_reason: string | undefined
  if (wbRes.error) {
    writebacks_reason = unavailableReason(wbRes.error, WRITEBACK_HINTS) ?? `reports illisibles : ${wbRes.error.message}`
  } else {
    writebacks = (wbRes.data ?? []) as WritebackRow[]
    writebacks_total = wbRes.count ?? writebacks.length
  }

  // Compte par type sur l'ensemble des anomalies ouvertes (pas seulement les 200 affichées)
  const types: AnomalyType[] = ['absent_geodae', 'ambigu', 'erreur_recherche', 'divergence_id', 'non_reference_synchroteam']
  const countRes = await Promise.all(
    types.map((t) => supabase.from('geodae_anomalies').select('id', { count: 'exact', head: true }).eq('type', t).is('resolved_at', null))
  )
  const open_by_type: Record<string, number> = {}
  let open_total = 0
  types.forEach((t, i) => { const n = countRes[i].count ?? 0; if (n > 0) open_by_type[t] = n; open_total += n })

  return {
    available: true,
    runs: (runsRes.data ?? []) as JournalRun[],
    open_by_type,
    open_total,
    open_anomalies: (openRes.data ?? []) as AnomalyRow[],
    writebacks,
    writebacks_total,
    ...(writebacks_reason ? { writebacks_reason } : {}),
  }
}
