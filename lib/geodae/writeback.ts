// Report de l'identifiant Géo'DAE dans Synchroteam (étape 2 du cahier des
// charges : « faire un appel d'update vers Synchroteam pour renseigner le
// champ correspondant »).
//
// C'est la seule écriture de l'application vers Synchroteam. Décision du
// 28/09/2026 : chaque report est validé par un utilisateur depuis la page
// Contrôle Géo'DAE (ligne par ligne, ou en lot pour les correspondances
// uniques). Garde-fous appliqués avant toute écriture :
//   1. le champ « Identifiant Géo'DAE » doit être résolu par le mapping du compte ;
//   2. l'équipement est relu dans Synchroteam juste avant l'écriture et son
//      n° de série doit être celui affiché à l'utilisateur ;
//   3. un champ déjà renseigné avec une autre valeur n'est jamais écrasé ;
//   4. la valeur est relue après l'écriture pour confirmation.
// L'envoi est partiel : POST /equipment/send ne modifie que les champs fournis.

import { createSynchroteamClient, extractCustomFields, type SynchroteamClient } from '@/lib/synchroteam'
import { buildAccounts } from '@/lib/sync-territory-route'
import { resolveMappings } from '@/lib/geodae/extract-synchroteam'
import type { CustomFieldMapping, TerritoryCode } from '@/types'
import type { MaintenanceWriteRequest, MaintenanceWriteResult, WritebackRequest, WritebackResult } from '@/lib/geodae/types'

/** Forme attendue d'un identifiant Géo'DAE (gid) : entier, éventuellement préfixé */
const GID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// Cache court du mapping par compte : un lot de reports enchaîne des dizaines
// d'écritures et la liste des champs personnalisés ne change pas entre deux.
const MAPPING_TTL_MS = 5 * 60_000
const mappingCache = new Map<TerritoryCode, { mappings: CustomFieldMapping[]; at: number }>()

async function mappingsFor(account: TerritoryCode, client: SynchroteamClient, dbMappings: CustomFieldMapping[]): Promise<CustomFieldMapping[]> {
  const cached = mappingCache.get(account)
  if (cached && Date.now() - cached.at < MAPPING_TTL_MS) return cached.mappings
  const { mappings } = await resolveMappings(client, dbMappings)
  mappingCache.set(account, { mappings, at: Date.now() })
  return mappings
}

function str(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

function fail(error: string): WritebackResult {
  return { ok: false, error }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Écrit l'identifiant Géo'DAE dans le champ personnalisé de l'équipement.
 * Avec `dryRun`, tout est vérifié et la charge utile est renvoyée, sans écriture.
 */
export async function writeGeoDaeId(
  req: WritebackRequest,
  dbMappings: CustomFieldMapping[],
  opts: { dryRun?: boolean } = {}
): Promise<WritebackResult> {
  const gid = req.gid.trim()
  if (!GID_PATTERN.test(gid)) return fail("identifiant Géo'DAE invalide")

  const acc = buildAccounts(req.account)
  if (!acc) return fail(`compte Synchroteam ${req.account} non configuré`)
  const client = createSynchroteamClient(acc.domain, acc.key)

  // 1. Champ cible
  let mappings: CustomFieldMapping[]
  try {
    mappings = await mappingsFor(req.account, client, dbMappings)
  } catch (err) {
    return fail(`mapping des champs personnalisés indisponible : ${errMsg(err)}`)
  }
  const field = mappings.find((m) => m.internal_field === 'geo_dae_id')
  if (!field) return fail(`champ « Identifiant Géo'DAE » non résolu sur le compte ${req.account} (voir /admin/field-mapping)`)

  // 2. Relecture de l'équipement juste avant l'écriture
  let equipment: Record<string, unknown>
  try {
    equipment = await client.fetchEquipmentDetails(req.synchroteam_id)
  } catch (err) {
    return fail(`lecture de l'équipement impossible : ${errMsg(err)}`)
  }
  const before = extractCustomFields(equipment, mappings)
  const currentSerial = str(before.serial_number)
  const currentGid = str(before.geo_dae_id)

  if (req.serial_number && currentSerial !== req.serial_number) {
    return fail(`n° de série différent dans Synchroteam (${currentSerial ?? 'absent'} au lieu de ${req.serial_number}) : report refusé`)
  }
  // 3. Jamais d'écrasement
  if (currentGid && currentGid !== gid) {
    return fail(`champ déjà renseigné dans Synchroteam avec ${currentGid} : report refusé`)
  }
  if (currentGid === gid) {
    return { ok: true, gid, previous_value: currentGid, verified: true, already_set: true }
  }

  // Un champ de type « nombre » reçoit un nombre, sinon la chaîne telle quelle
  const value: string | number = field.field_type === 'number' && /^\d+$/.test(gid) ? Number(gid) : gid
  const payload = {
    id: equipment.id ?? req.synchroteam_id,
    customFieldValues: [{ id: field.synchroteam_field_id, label: field.synchroteam_label, value }],
  }
  if (opts.dryRun) return { ok: true, gid, previous_value: currentGid, verified: false, dry_run: true, payload }

  try {
    await client.sendEquipment(payload)
  } catch (err) {
    return fail(`écriture Synchroteam refusée : ${errMsg(err)}`)
  }

  // 4. Relecture de contrôle (non bloquante : l'écriture a été acceptée)
  let verified = false
  try {
    const after = extractCustomFields(await client.fetchEquipmentDetails(req.synchroteam_id), mappings)
    verified = str(after.geo_dae_id) === gid
  } catch {
    verified = false
  }
  return { ok: true, gid, previous_value: currentGid, verified }
}

// ─── Date de dernière maintenance ────────────────────────────────────────────
// Deuxième écriture vers Synchroteam (décision du 29/09/2026, comparaison des
// dates Synchroteam ↔ Géo'DAE) : le champ personnalisé « Date dernière
// maintenance » reçoit la date déclarée dans Géo'DAE quand elle est plus récente
// ou que Synchroteam n'en a pas. Mêmes garde-fous que l'identifiant ; en plus,
// une date déjà présente et au moins aussi récente n'est jamais reculée.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Format des dates saisies dans les champs personnalisés Synchroteam (dd/mm/yyyy) */
function toSynchroteamDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function isoFromField(val: unknown): string | null {
  const raw = str(val)
  if (!raw) return null
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw)
  const d = new Date(fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export async function writeMaintenanceDate(
  req: MaintenanceWriteRequest,
  dbMappings: CustomFieldMapping[],
  opts: { dryRun?: boolean } = {}
): Promise<MaintenanceWriteResult> {
  const date = req.date.trim()
  if (!ISO_DATE.test(date) || Number.isNaN(new Date(date).getTime())) return { ok: false, error: 'date invalide (attendu yyyy-mm-dd)' }
  if (date > new Date().toISOString().slice(0, 10)) return { ok: false, error: 'date dans le futur : report refusé' }

  const acc = buildAccounts(req.account)
  if (!acc) return { ok: false, error: `compte Synchroteam ${req.account} non configuré` }
  const client = createSynchroteamClient(acc.domain, acc.key)

  // 1. Champ cible : « Date dernière maintenance », résolu par le mapping du compte
  let mappings: CustomFieldMapping[]
  try {
    mappings = await mappingsFor(req.account, client, dbMappings)
  } catch (err) {
    return { ok: false, error: `mapping des champs personnalisés indisponible : ${errMsg(err)}` }
  }
  const field = mappings.find((m) => m.internal_field === 'last_maintenance_field')
  if (!field) return { ok: false, error: `champ « Date dernière maintenance » non résolu sur le compte ${req.account} (voir /admin/field-mapping)` }

  // 2. Relecture de l'équipement juste avant l'écriture
  let equipment: Record<string, unknown>
  try {
    equipment = await client.fetchEquipmentDetails(req.synchroteam_id)
  } catch (err) {
    return { ok: false, error: `lecture de l'équipement impossible : ${errMsg(err)}` }
  }
  const before = extractCustomFields(equipment, mappings)
  const currentSerial = str(before.serial_number)
  if (req.serial_number && currentSerial !== req.serial_number) {
    return { ok: false, error: `n° de série différent dans Synchroteam (${currentSerial ?? 'absent'} au lieu de ${req.serial_number}) : report refusé` }
  }
  // 3. Jamais de recul : une date déjà présente et au moins aussi récente est conservée
  const previous = str(before.last_maintenance_field)
  const previousIso = isoFromField(previous)
  if (previousIso && previousIso >= date) {
    return { ok: true, date, previous_value: previous, verified: true, already_set: true }
  }

  const payload = {
    id: equipment.id ?? req.synchroteam_id,
    customFieldValues: [{ id: field.synchroteam_field_id, label: field.synchroteam_label, value: toSynchroteamDate(date) }],
  }
  if (opts.dryRun) return { ok: true, date, previous_value: previous, verified: false, dry_run: true, payload }

  try {
    await client.sendEquipment(payload)
  } catch (err) {
    return { ok: false, error: `écriture Synchroteam refusée : ${errMsg(err)}` }
  }

  // 4. Relecture de contrôle (non bloquante)
  let verified = false
  try {
    const after = extractCustomFields(await client.fetchEquipmentDetails(req.synchroteam_id), mappings)
    verified = isoFromField(after.last_maintenance_field) === date
  } catch {
    verified = false
  }
  return { ok: true, date, previous_value: previous, verified }
}
