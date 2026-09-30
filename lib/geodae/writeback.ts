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

type RawCustomField = { id: number | string; label?: string | null; value?: unknown }

/** Champs personnalisés bruts tels que renvoyés par equipment/details */
function rawCustomFields(equipment: Record<string, unknown>): RawCustomField[] {
  const raw = equipment.customFieldValues ?? equipment.customFields ?? equipment.custom_fields
  return Array.isArray(raw) ? (raw as RawCustomField[]).filter((c) => c && c.id != null) : []
}

/**
 * Charge utile de mise à jour d'un équipement. La documentation Synchroteam
 * (api.synchroteam.com, Create/Update equipment) garantit qu'un envoi partiel ne
 * touche que les champs fournis : « only the fields provided will be updated.
 * Fields not provided will not be deleted ». Tags, client, site et nom ne sont
 * donc pas envoyés ; les tags ne sont hérités qu'à la création, jamais ici, et
 * un identifiant inconnu fait échouer la requête au lieu de créer un équipement.
 * Par prudence vis-à-vis de la liste des champs personnalisés elle-même, on
 * renvoie TOUS les champs personnalisés relus, le champ visé remplacé : si
 * Synchroteam remplaçait la liste au lieu de la fusionner, rien ne serait perdu.
 */
function buildPayload(equipment: Record<string, unknown>, fallbackId: string, field: CustomFieldMapping, value: string | number) {
  const others = rawCustomFields(equipment)
    .filter((c) => String(c.id) !== String(field.synchroteam_field_id))
    .map((c) => ({ id: c.id, label: c.label ?? undefined, value: c.value ?? null }))
  return {
    id: equipment.id ?? fallbackId,
    customFieldValues: [...others, { id: field.synchroteam_field_id, label: field.synchroteam_label, value }],
  }
}

/**
 * Ce qui a changé sur l'équipement en dehors du champ visé (attendu : rien) :
 * tags, nom, état, client, site et les autres champs personnalisés. Remonté à
 * l'utilisateur et tracé dans le journal.
 */
function collateralChanges(before: Record<string, unknown>, after: Record<string, unknown>, fieldId: number): string[] {
  const out: string[] = []
  const norm = (v: unknown) => JSON.stringify(v ?? null)
  const tags = (e: Record<string, unknown>) => (Array.isArray(e.tags) ? (e.tags as unknown[]).map(String).sort() : [])
  if (norm(tags(before)) !== norm(tags(after))) out.push(`tags : ${tags(before).join(', ') || '(aucun)'} → ${tags(after).join(', ') || '(aucun)'}`)
  for (const k of ['name', 'active', 'myId'] as const) {
    if (norm(before[k]) !== norm(after[k])) out.push(`${k} : ${norm(before[k])} → ${norm(after[k])}`)
  }
  for (const k of ['customer', 'site'] as const) {
    const id = (e: Record<string, unknown>) => norm((e[k] as { id?: unknown } | null | undefined)?.id ?? null)
    if (id(before) !== id(after)) out.push(`${k} : ${id(before)} → ${id(after)}`)
  }
  const index = (e: Record<string, unknown>) => new Map(rawCustomFields(e).map((c) => [String(c.id), c]))
  const b = index(before)
  const a = index(after)
  for (const [id, c] of Array.from(b.entries())) {
    if (id === String(fieldId)) continue
    const o = a.get(id)
    if (!o) out.push(`champ « ${c.label ?? id} » disparu`)
    else if (norm(c.value ?? null) !== norm(o.value ?? null)) out.push(`champ « ${c.label ?? id} » : ${norm(c.value)} → ${norm(o.value)}`)
  }
  for (const [id, c] of Array.from(a.entries())) {
    if (id !== String(fieldId) && !b.has(id)) out.push(`champ « ${c.label ?? id} » apparu`)
  }
  return out
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
  const payload = buildPayload(equipment, req.synchroteam_id, field, value)
  if (opts.dryRun) return { ok: true, gid, previous_value: currentGid, verified: false, dry_run: true, payload }

  try {
    await client.sendEquipment(payload)
  } catch (err) {
    return fail(`écriture Synchroteam refusée : ${errMsg(err)}`)
  }

  // 4. Relecture de contrôle (non bloquante : l'écriture a été acceptée) et
  //    comparaison de tout le reste de l'équipement, tags compris
  let verified = false
  let collateral: string[] = []
  try {
    const afterRaw = await client.fetchEquipmentDetails(req.synchroteam_id)
    verified = str(extractCustomFields(afterRaw, mappings).geo_dae_id) === gid
    collateral = collateralChanges(equipment, afterRaw, field.synchroteam_field_id)
  } catch {
    verified = false
  }
  return { ok: true, gid, previous_value: currentGid, verified, collateral }
}

// ─── Date de dernière maintenance ────────────────────────────────────────────
// Deuxième écriture vers Synchroteam (décision du 29/09/2026, comparaison des
// dates Synchroteam ↔ Géo'DAE) : le champ personnalisé « Date dernière
// maintenance » reçoit la date déclarée dans Géo'DAE quand elle est plus récente
// ou que Synchroteam n'en a pas. Mêmes garde-fous que l'identifiant ; en plus,
// une date déjà présente et au moins aussi récente n'est jamais reculée.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Format envoyé pour un champ personnalisé de type date : yyyy-mm-dd, le format
 * dans lequel equipment/details renvoie lui-même ces champs (vérifié le
 * 29/09/2026 : « Date mise en place batterie » = "2023-01-02"). La relecture
 * accepte les deux formats (isoFromField) au cas où Synchroteam normaliserait.
 */
function toSynchroteamDate(iso: string): string {
  return iso
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

  const payload = buildPayload(equipment, req.synchroteam_id, field, toSynchroteamDate(date))
  if (opts.dryRun) return { ok: true, date, previous_value: previous, verified: false, dry_run: true, payload }

  try {
    await client.sendEquipment(payload)
  } catch (err) {
    return { ok: false, error: `écriture Synchroteam refusée : ${errMsg(err)}` }
  }

  // 4. Relecture de contrôle (non bloquante) et comparaison du reste de l'équipement
  let verified = false
  let collateral: string[] = []
  try {
    const afterRaw = await client.fetchEquipmentDetails(req.synchroteam_id)
    verified = isoFromField(extractCustomFields(afterRaw, mappings).last_maintenance_field) === date
    collateral = collateralChanges(equipment, afterRaw, field.synchroteam_field_id)
  } catch {
    verified = false
  }
  return { ok: true, date, previous_value: previous, verified, collateral }
}
