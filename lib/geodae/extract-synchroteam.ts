// Étape 1 du contrôle de cohérence Synchroteam ↔ Géo'DAE.
//
// Interroge directement l'API Synchroteam (pas la copie Supabase, qui n'est
// rafraîchie qu'une fois par jour) pour extraire les DAE :
//   - actifs,
//   - sous contrat de location (mêmes valeurs que le filtre « Location » du dashboard),
// avec leur identifiant interne, leur numéro de série et leur identifiant Géo'DAE.
//
// Lecture seule : aucune écriture vers Synchroteam ni vers Supabase.

import type { SynchroteamClient } from '@/lib/synchroteam'
import { extractCustomFields } from '@/lib/synchroteam'
import { guessInternalField } from '@/lib/field-mapping'
import { LOCATION_TYPES } from '@/lib/contract-groups'
import type { CustomFieldMapping, SynchroteamCustomField, TerritoryCode } from '@/types'
import type { AccountExtraction, ContractTypeCount, ExtractionResult, LocationDae } from '@/lib/geodae/types'

/** Compte Synchroteam à interroger ; `client` vaut null si le compte n'est pas configuré. */
export interface AccountInput {
  account: TerritoryCode
  client: SynchroteamClient | null
}

/** Champs internes sans lesquels l'extraction n'a pas de sens. */
const REQUIRED_INTERNAL_FIELDS = ['serial_number', 'geo_dae_id', 'contract_type'] as const

// ─── Helpers (mêmes sémantiques que lib/sync-synchroteam.ts) ────────────────

function g(obj: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  if (obj == null) return null
  for (const k of keys) {
    const v = obj[k]
    if (v != null && v !== '') return v
  }
  return null
}

function str(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

const LOCATION_SET = new Set(LOCATION_TYPES.map((t) => t.trim()))

/** Vrai si la valeur correspond exactement (après trim) à un type « location » du dashboard. */
export function isLocationContract(type: string | null): boolean {
  if (!type) return false
  return LOCATION_SET.has(type.trim())
}

// ─── Mapping des champs personnalisés ────────────────────────────────────────

/**
 * Résout le mapping id → champ interne pour un compte donné.
 * Priorité au mapping configuré en base (table custom_field_mapping, modifiable
 * dans /admin/field-mapping) ; les champs inconnus de la base sont devinés à
 * partir de leur libellé, comme le fait la discovery de la synchronisation.
 */
export async function resolveMappings(
  client: SynchroteamClient,
  dbMappings: CustomFieldMapping[]
): Promise<{ mappings: CustomFieldMapping[]; source: string }> {
  const byId = new Map(dbMappings.map((m) => [m.synchroteam_field_id, m]))

  let fields: SynchroteamCustomField[]
  try {
    fields = await client.fetchCustomFields()
  } catch {
    return { mappings: dbMappings, source: 'base seule (discovery Synchroteam indisponible)' }
  }

  const merged: CustomFieldMapping[] = []
  let guessed = 0
  for (const f of fields) {
    const known = byId.get(f.id)
    if (known) {
      merged.push(known)
      continue
    }
    const guess = guessInternalField(f.label, f.type)
    if (!guess) continue
    merged.push({
      id: `heuristique-${f.id}`,
      synchroteam_field_id: f.id,
      synchroteam_label: f.label,
      internal_field: guess.internal,
      field_type: guess.type,
      updated_at: '',
    })
    guessed++
  }

  const source =
    guessed === 0 ? 'base' : merged.length === guessed ? 'heuristique sur les libellés' : 'base + heuristique'
  return { mappings: merged, source }
}

// ─── Contrats Synchroteam ────────────────────────────────────────────────────

/**
 * Type de contrat par identifiant d'équipement, d'après /contract/list.
 * Quand plusieurs contrats visent le même équipement, le plus récent (date de
 * début) l'emporte. Reproduit la priorité de la synchronisation, où le contrat
 * écrase le champ personnalisé « Type de contrat ».
 */
function buildContractTypeByEquipment(contracts: Record<string, unknown>[]): Map<string, string> {
  const best = new Map<string, { type: string; start: string }>()
  for (const c of contracts) {
    const equipment = c.equipment as Record<string, unknown> | null
    const equipId = str(equipment?.id)
    const type = str(g(c, 'type', 'contractType', 'typeName'))
    if (!equipId || !type) continue
    const start = str(g(c, 'startDate', 'beginDate', 'dateStart', 'start')) ?? ''
    const prev = best.get(equipId)
    if (!prev || start >= prev.start) best.set(equipId, { type, start })
  }
  return new Map(Array.from(best, ([id, v]) => [id, v.type]))
}

// ─── Extraction ──────────────────────────────────────────────────────────────

function emptyAccount(account: TerritoryCode): AccountExtraction {
  return {
    account,
    configured: true,
    active_total: 0,
    location_total: 0,
    with_geo_dae_id: 0,
    without_geo_dae_id: 0,
    without_serial: 0,
    contract_types_seen: [],
    mapping_source: '',
    missing_fields: [],
    error: null,
    duration_ms: 0,
  }
}

/** Extraction pour un seul compte Synchroteam. */
export async function extractLocationDaeForAccount(
  account: TerritoryCode,
  client: SynchroteamClient,
  dbMappings: CustomFieldMapping[]
): Promise<{ summary: AccountExtraction; rows: LocationDae[] }> {
  const started = Date.now()
  const summary = emptyAccount(account)
  const rows: LocationDae[] = []

  try {
    const { mappings, source } = await resolveMappings(client, dbMappings)
    summary.mapping_source = source
    const resolved = new Set(mappings.map((m) => m.internal_field))
    summary.missing_fields = REQUIRED_INTERNAL_FIELDS.filter((f) => !resolved.has(f))

    // Sans filtre, /equipment/list ne renvoie que les équipements actifs
    // (comportement vérifié par la synchronisation existante).
    const equipments = await client.fetchAllPages<Record<string, unknown>>('/Api/v3/equipment/list')

    let contractTypeByEquipment = new Map<string, string>()
    try {
      contractTypeByEquipment = buildContractTypeByEquipment(await client.fetchContracts())
    } catch (err) {
      // Non bloquant : on retombe sur le champ personnalisé « Type de contrat »
      summary.error = `contrats indisponibles, type de contrat lu depuis le champ personnalisé (${String(err)})`
    }

    const typeCounts = new Map<string, number>()

    for (const eq of equipments) {
      if (eq.active === false) continue
      summary.active_total++

      const cf = extractCustomFields(eq, mappings)
      const synchroteamId = str(eq.id)
      if (!synchroteamId) continue

      const contractType = contractTypeByEquipment.get(synchroteamId) ?? str(cf.contract_type) ?? '(aucun)'
      typeCounts.set(contractType, (typeCounts.get(contractType) ?? 0) + 1)

      if (!isLocationContract(contractType)) continue

      const customer = eq.customer as Record<string, unknown> | null
      const site = eq.site as Record<string, unknown> | null
      const row: LocationDae = {
        account,
        synchroteam_id: synchroteamId,
        name: str(eq.name),
        customer_name: str(customer?.name),
        site_name: str(site?.name),
        serial_number: str(cf.serial_number),
        geo_dae_id: str(cf.geo_dae_id),
        contract_type: contractType,
      }
      rows.push(row)

      summary.location_total++
      if (row.geo_dae_id) summary.with_geo_dae_id++
      else summary.without_geo_dae_id++
      if (!row.serial_number) summary.without_serial++
    }

    summary.contract_types_seen = Array.from(typeCounts, ([type, count]): ContractTypeCount => ({
      type,
      count,
      is_location: isLocationContract(type),
    })).sort((a, b) => b.count - a.count)
  } catch (err) {
    summary.error = String(err)
  }

  summary.duration_ms = Date.now() - started
  return { summary, rows }
}

/**
 * Extraction sur tous les comptes fournis, en séquence pour respecter les
 * limites de débit Synchroteam. Les comptes non configurés sont signalés,
 * pas traités.
 */
export async function extractLocationDae(
  inputs: AccountInput[],
  dbMappings: CustomFieldMapping[],
  warning: string | null = null
): Promise<ExtractionResult> {
  const accounts: AccountExtraction[] = []
  const rows: LocationDae[] = []

  for (const { account, client } of inputs) {
    if (!client) {
      accounts.push({ ...emptyAccount(account), configured: false })
      continue
    }
    const res = await extractLocationDaeForAccount(account, client, dbMappings)
    accounts.push(res.summary)
    rows.push(...res.rows)
  }

  rows.sort((a, b) =>
    a.account.localeCompare(b.account) || (a.serial_number ?? '').localeCompare(b.serial_number ?? '')
  )

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

  // Aucun compte configuré : un total à zéro serait trompeur, on l'explique.
  const configured = inputs.filter((i) => i.client !== null).length
  const finalWarning =
    configured === 0
      ? [
          'Aucun compte Synchroteam configuré : renseignez SYNCHROTEAM_DOMAIN et SYNCHROTEAM_API_KEY (et les variantes _MYT / _GLP), puis redémarrez le serveur.',
          warning,
        ].filter(Boolean).join(' · ')
      : warning

  return { extracted_at: new Date().toISOString(), accounts, totals, rows, warning: finalWarning }
}
