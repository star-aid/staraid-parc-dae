import type { SupabaseClient } from '@supabase/supabase-js'
import type { SynchroteamClient } from '@/lib/synchroteam'
import { runSyncForAccount, runGlobalFinalize } from '@/lib/sync-synchroteam'
import { guessInternalField } from '@/lib/field-mapping'
import type { CustomFieldMapping } from '@/types'

/**
 * Discover les custom fields Synchroteam et met à jour custom_field_mapping.
 * Appelé en tête de chaque sync territoire pour garantir des mappings à jour.
 */
async function discoverAndUpsertMappings(
  apiClient: SynchroteamClient,
  supabase: SupabaseClient,
  errors: string[]
): Promise<void> {
  try {
    const fields = await apiClient.fetchCustomFields()
    const rows = fields
      .map((f) => {
        const guess = guessInternalField(f.label, f.type)
        if (!guess) return null
        return {
          synchroteam_field_id: f.id,
          synchroteam_label: f.label,
          internal_field: guess.internal,
          field_type: guess.type,
          updated_at: new Date().toISOString(),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    if (!rows.length) return

    const { error } = await supabase
      .from('custom_field_mapping')
      .upsert(rows, { onConflict: 'synchroteam_field_id' })
    if (error) errors.push(`discovery upsert: ${error.message}`)
  } catch (err) {
    errors.push(`discovery: ${String(err)}`)
  }
}

export type TerritoryRouteResult = {
  status: 'success' | 'partial' | 'error'
  territory: string
  clients: number
  sites: number
  technicians: number
  equipments: number
  contracts: number
  interventions: number
  statuses_updated: number
  geocoded: number
  errors: string[]
  duration_ms: number
}

/**
 * Réserve un "créneau" de synchronisation pour un territoire donné.
 * Empêche deux syncs du même territoire de tourner en parallèle (ex. clic manuel
 * + cron simultanés) — ce qui provoquait des collisions d'écriture et des durées
 * anormalement longues.
 *
 * Réinitialise d'abord les entrées "running" bloquées depuis plus de 30 min, puis
 * vérifie qu'aucune sync n'est encore active avant de créer la nouvelle entrée.
 */
export async function claimSyncSlot(
  supabase: SupabaseClient,
  logSource: string
): Promise<{ claimed: boolean; logId: string | null; alreadyRunningSince?: string }> {
  const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  await supabase
    .from('sync_logs')
    .update({ status: 'error', error_message: 'Timeout — reset automatique (running > 30 min)', finished_at: new Date().toISOString() })
    .eq('source', logSource)
    .eq('status', 'running')
    .lt('started_at', staleThreshold)

  const { data: active } = await supabase
    .from('sync_logs')
    .select('started_at')
    .eq('source', logSource)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (active) {
    return { claimed: false, logId: null, alreadyRunningSince: active.started_at }
  }

  const { data: logEntry } = await supabase
    .from('sync_logs')
    .insert({ source: logSource, status: 'running', started_at: new Date().toISOString() })
    .select('id').single()

  return { claimed: true, logId: logEntry?.id ?? null }
}

export async function syncTerritory(
  supabase: SupabaseClient,
  apiClient: SynchroteamClient,
  idPrefix: string,
  forcedTerritoryCode: string | null
): Promise<TerritoryRouteResult> {
  const started = Date.now()
  const errors: string[] = []

  // Source sync_logs propre à ce territoire
  const logSource = forcedTerritoryCode
    ? `synchroteam_${forcedTerritoryCode.toLowerCase()}`
    : 'synchroteam_reu'

  const [{ data: territories }, { data: lastSyncRow }] = await Promise.all([
    supabase.from('territories').select('id, code'),
    supabase
      .from('sync_logs')
      .select('finished_at')
      .eq('source', logSource)
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Discovery en tête de sync : met à jour custom_field_mapping avec les IDs réels
  // du compte Synchroteam courant (les IDs diffèrent entre REU / GLP / MYT)
  await discoverAndUpsertMappings(apiClient, supabase, errors)

  // Relecture après discovery pour avoir les mappings à jour
  const { data: cfMappings } = await supabase.from('custom_field_mapping').select('*')

  const territoryMap = new Map(
    (territories ?? []).map((t: { code: string; id: string }) => [t.code, t.id])
  )
  const mappings: CustomFieldMapping[] = (cfMappings ?? []) as CustomFieldMapping[]

  // Sync incrémentale : on filtre les interventions depuis la dernière sync réussie
  // moins 30 min de tampon pour éviter les trous en cas de chevauchement
  let sinceDate: Date | undefined
  if (lastSyncRow?.finished_at) {
    sinceDate = new Date(lastSyncRow.finished_at)
    sinceDate.setMinutes(sinceDate.getMinutes() - 30)
  }

  const res = await runSyncForAccount(
    apiClient, supabase, territoryMap, mappings, idPrefix, forcedTerritoryCode, sinceDate
  )
  errors.push(...res.errors)

  const { statuses_updated, geocoded } = await runGlobalFinalize(supabase, errors)

  return {
    status: errors.length > 0 ? (res.equipments > 0 ? 'partial' : 'error') : 'success',
    territory: forcedTerritoryCode ?? 'REU',
    clients: res.clients,
    sites: res.sites,
    technicians: res.technicians,
    equipments: res.equipments,
    contracts: res.contracts,
    interventions: res.interventions,
    statuses_updated,
    geocoded,
    errors,
    duration_ms: Date.now() - started,
  }
}

export function buildAccounts(territory: 'REU' | 'GLP' | 'MYT') {
  if (territory === 'REU') {
    const domain = process.env.SYNCHROTEAM_DOMAIN
    const key = process.env.SYNCHROTEAM_API_KEY
    if (!domain || !key) return null
    return { domain, key, idPrefix: '', forcedTerritoryCode: null }
  }
  if (territory === 'GLP') {
    const domain = process.env.SYNCHROTEAM_DOMAIN_GLP
    const key = process.env.SYNCHROTEAM_API_KEY_GLP
    if (!domain || !key) return null
    return { domain, key, idPrefix: 'GLP_', forcedTerritoryCode: 'GLP' }
  }
  if (territory === 'MYT') {
    const domain = process.env.SYNCHROTEAM_DOMAIN_MYT
    const key = process.env.SYNCHROTEAM_API_KEY_MYT
    if (!domain || !key) return null
    return { domain, key, idPrefix: 'MYT_', forcedTerritoryCode: 'MYT' }
  }
  return null
}
