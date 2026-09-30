// Écriture dans Géo'DAE : date de dernière maintenance.
//
// Première écriture de l'application vers Géo'DAE (décision du 29/09/2026,
// onglet Maintenance) : quand Synchroteam est plus récent, la date de dernière
// intervention est écrite dans le champ `dermnt` de la fiche, par l'opération
// PATCH documentée de l'API PRODIGE du catalogue Atlasanté (« modification en
// se basant sur la clé gid », corps GeoJSON). Validée par un utilisateur, fiche
// par fiche ; premier essai fait par l'équipe STAR aid depuis l'interface.
//
// Garde-fous : fiche relue avant l'écriture, SIREN vérifié, jamais de recul de
// date, relecture après l'écriture, comparaison champ par champ pour signaler
// tout autre changement que la date. Aucune restauration automatique : le
// résultat est remonté à l'utilisateur, la fiche reste consultable sur le portail.
// Fichier serveur uniquement.

import { CATALOGUE_URL, TIMEOUT_MS, fetchJson, geodaeToken, isGeodaeApiConfigured } from '@/lib/geodae/client'
import { GEODAE_DATASET_UUID } from '@/lib/geodae/types'

/** Champs que Géo'DAE modifie lui-même lors d'une mise à jour : ignorés dans la comparaison */
const GEODAE_SYSTEM_FIELDS = new Set(['dermnt', 'maj_don', '_edit_datemaj', '_userid_modification', 'dirty'])

type GeodaeFullFeature = { type?: string; geometry?: unknown; properties: Record<string, unknown> }

function str(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

/** Fiche complète telle que l'API la renvoie, avec le système de coordonnées de la collection */
async function geodaeFullFeature(gid: string): Promise<{ feature: GeodaeFullFeature | null; crs: unknown }> {
  async function query(token: string) {
    const url = new URL(`${CATALOGUE_URL}/api/data/${GEODAE_DATASET_UUID}`)
    url.searchParams.set('_where', `eq(gid,${gid})`)
    url.searchParams.set('limit', '1')
    return fetchJson(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  }
  let res = await query(await geodaeToken())
  if (res.status === 401) res = await query(await geodaeToken(true))
  if (res.status !== 200) throw new Error(`API Géo'DAE HTTP ${res.status}`)
  const body = res.body as { features?: GeodaeFullFeature[]; crs?: unknown } | null
  return { feature: body?.features?.[0] ?? null, crs: body?.crs ?? null }
}

export type GeodaeDateWriteResult =
  | {
      ok: true
      date: string
      previous_value: string | null
      /** Vrai si la date a été relue à sa nouvelle valeur après l'écriture */
      verified: boolean
      already_set?: boolean
      /** Autres champs de la fiche modifiés par l'écriture (attendu : aucun) */
      collateral: string[]
      etat_valid_before: string | null
      etat_valid_after: string | null
      /** Forme du corps acceptée par le serveur : géométrie + date seule, ou fiche complète */
      variant?: 'minimal' | 'complete'
    }
  | { ok: false; error: string }

export async function writeGeodaeMaintenanceDate(gid: string, date: string): Promise<GeodaeDateWriteResult> {
  if (!/^\d+$/.test(gid)) return { ok: false, error: "identifiant Géo'DAE invalide" }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) return { ok: false, error: 'date invalide (attendu yyyy-mm-dd)' }
  if (date > new Date().toISOString().slice(0, 10)) return { ok: false, error: 'date dans le futur : écriture refusée' }
  if (!isGeodaeApiConfigured()) return { ok: false, error: 'GEODAE_USERNAME / GEODAE_PASSWORD non configurés' }

  // 1. Relecture complète de la fiche avant l'écriture
  let before: GeodaeFullFeature | null
  let crs: unknown = null
  try {
    const read = await geodaeFullFeature(gid)
    before = read.feature
    crs = read.crs
  } catch (err) {
    return { ok: false, error: `lecture de la fiche Géo'DAE impossible : ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!before) return { ok: false, error: `fiche Géo'DAE ${gid} introuvable pour ce compte` }
  const siren = process.env.GEODAE_SIREN?.trim()
  const fiche = before.properties
  if (siren && str(fiche.expt_siren) !== siren) {
    return { ok: false, error: `fiche déclarée sous le SIREN ${str(fiche.expt_siren) ?? 'inconnu'}, pas ${siren} : écriture refusée` }
  }
  const previous = str(fiche.dermnt)
  const etatBefore = str(fiche.etat_valid)
  // 2. Jamais de recul : une date déjà présente et au moins aussi récente est conservée
  if (previous && previous.slice(0, 10) >= date) {
    return { ok: true, date, previous_value: previous, verified: true, already_set: true, collateral: [], etat_valid_before: etatBefore, etat_valid_after: etatBefore }
  }

  // 3. PATCH. La documentation PRODIGE impose le modèle renvoyé par la lecture : une
  //    FeatureCollection avec le système de coordonnées de la source et, pour chaque
  //    fiche, une géométrie du même type que la couche (MultiPoint) et ses propriétés.
  //    Premier essai, minimal : géométrie relue telle quelle, clé gid et le seul champ
  //    dermnt. Si le serveur échoue (500) ou refuse (400), second essai avec la fiche
  //    complète relue, champs système exclus, dermnt remplacé. Un envoi sans géométrie
  //    a produit un HTTP 500 le 30/09/2026.
  const gidValue = typeof fiche.gid === 'number' ? Number(gid) : gid
  const collection = (properties: Record<string, unknown>) => JSON.stringify({
    type: 'FeatureCollection',
    ...(crs ? { crs } : {}),
    features: [{ type: 'Feature', geometry: before.geometry ?? null, properties }],
  })
  const minimalBody = collection({ gid: gidValue, dermnt: date })
  const completeProps: Record<string, unknown> = { ...fiche, dermnt: date }
  for (const k of Object.keys(completeProps)) if (k.startsWith('_') || k === 'dirty' || k === 'maj_don') delete completeProps[k]
  const completeBody = collection(completeProps)

  async function patch(token: string, body: string): Promise<{ status: number; text: string }> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${CATALOGUE_URL}/api/data/${GEODAE_DATASET_UUID}/gid`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
        signal: ctrl.signal,
        cache: 'no-store',
      })
      return { status: res.status, text: (await res.text()).slice(0, 300) }
    } finally {
      clearTimeout(timer)
    }
  }
  async function attempt(body: string): Promise<{ status: number; text: string }> {
    let r = await patch(await geodaeToken(), body)
    if (r.status === 401) r = await patch(await geodaeToken(true), body)
    return r
  }
  let variant: 'minimal' | 'complete' = 'minimal'
  let res: { status: number; text: string }
  try {
    res = await attempt(minimalBody)
    if (res.status === 500 || res.status === 400) {
      variant = 'complete'
      res = await attempt(completeBody)
    }
  } catch (err) {
    return { ok: false, error: `écriture Géo'DAE impossible : ${err instanceof Error ? err.message : String(err)}` }
  }
  if (res.status === 403) return { ok: false, error: "écriture refusée par Géo'DAE (HTTP 403) : le compte n'a pas le droit de modifier cette fiche" }
  if (res.status === 404) return { ok: false, error: `fiche Géo'DAE ${gid} inexistante pour l'écriture (HTTP 404)` }
  if (res.status !== 200) return { ok: false, error: `écriture refusée par Géo'DAE (HTTP ${res.status}) : ${res.text.replace(/\s+/g, ' ')}` }

  // 4. Relecture et comparaison champ par champ
  let after: GeodaeFullFeature | null = null
  try {
    after = (await geodaeFullFeature(gid)).feature
  } catch {
    after = null
  }
  const collateral: string[] = []
  let verified = false
  let etatAfter: string | null = etatBefore
  if (after) {
    verified = str(after.properties.dermnt)?.slice(0, 10) === date
    etatAfter = str(after.properties.etat_valid)
    const keys = new Set([...Object.keys(before.properties), ...Object.keys(after.properties)])
    for (const k of Array.from(keys)) {
      if (GEODAE_SYSTEM_FIELDS.has(k)) continue
      const a = JSON.stringify(before.properties[k] ?? null)
      const b = JSON.stringify(after.properties[k] ?? null)
      if (a !== b) collateral.push(`${k} : ${a} → ${b}`)
    }
    if (JSON.stringify(before.geometry ?? null) !== JSON.stringify(after.geometry ?? null)) collateral.push('géométrie modifiée')
  }
  return { ok: true, date, previous_value: previous, verified, collateral, etat_valid_before: etatBefore, etat_valid_after: etatAfter, variant }
}
