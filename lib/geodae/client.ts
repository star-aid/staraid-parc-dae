// Accès à Géo'DAE par l'API exploitants du catalogue Atlasanté (PRODIGE).
// Fichier serveur uniquement : il lit des variables d'environnement secrètes.
//
// Source unique depuis le 01/10/2026 (décision de Clément) : l'API exploitants, avec
// le compte Géo'DAE rattaché au SIREN du parc (STAR GROUP). Elle expose le champ
// num_serie de chaque fiche, ce que l'open data data.gouv.fr n'avait pas (la
// recherche s'y faisait dans le nom du DAE) ; l'open data n'est plus interrogé.
//
// Mesuré le 01/10/2026 : le paramètre limit n'est pas plafonné, les 1 137 fiches
// du compte arrivent en une requête (1,5 à 4 s) ; sort_by attend « champ:asc ».
//
// Lecture seule ici : l'écriture dans Géo'DAE est dans geodae-write.ts.

import { GEODAE_DATASET_UUID, type GeodaeInventoryItem, type GidCandidate, type LookupResult } from '@/lib/geodae/types'

export const CATALOGUE_URL = 'https://catalogue.atlasante.fr'
export const TIMEOUT_MS = 20_000
/** Fiches demandées par requête d'inventaire ; au-delà, pagination par offset */
const INVENTORY_PAGE = 5000

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export async function fetchJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
    let body: unknown = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Authentification ────────────────────────────────────────────────────────

// Jeton conservé en mémoire du processus ; renouvelé toutes les 30 minutes ou sur 401
let cachedToken: { token: string; expiresAt: number } | null = null

function geodaeCredentials(): { username: string; password: string } | null {
  const username = process.env.GEODAE_USERNAME
  const password = process.env.GEODAE_PASSWORD
  return username && password ? { username, password } : null
}

export function isGeodaeApiConfigured(): boolean {
  return geodaeCredentials() !== null
}

export const GEODAE_NOT_CONFIGURED = 'GEODAE_USERNAME / GEODAE_PASSWORD non configurés'

export async function geodaeToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token
  const creds = geodaeCredentials()
  if (!creds) throw new Error(GEODAE_NOT_CONFIGURED)

  const { status, body } = await fetchJson(`${CATALOGUE_URL}/api/jwt_login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  })
  // Le catalogue répond { access_token, token_type } (forme OAuth) ; l'ancienne forme { token } est tolérée
  const b = body as { access_token?: string; token?: string } | null
  const token = b?.access_token ?? b?.token
  if (status !== 200 || !token) throw new Error(`authentification Géo'DAE refusée (HTTP ${status})`)

  cachedToken = { token, expiresAt: Date.now() + 30 * 60_000 }
  return token
}

// ─── Lecture des fiches ──────────────────────────────────────────────────────

type GeodaeFeature = {
  properties: {
    gid: number | string
    nom?: string | null
    num_serie?: string | null
    etat?: string | null
    etat_fonct?: string | null
    expt_siren?: string | null
    expt_rais?: string | null
    dermnt?: string | null
    maj_don?: string | null
    com_nom?: string | null
  }
}

/** Appel authentifié à la couche DAE du catalogue ; se reconnecte une fois si le jeton a expiré. */
async function geodaeApiFeatures(params: Record<string, string>): Promise<GeodaeFeature[]> {
  async function query(token: string) {
    const url = new URL(`${CATALOGUE_URL}/api/data/${GEODAE_DATASET_UUID}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return fetchJson(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  }
  let res = await query(await geodaeToken())
  if (res.status === 401) res = await query(await geodaeToken(true))
  if (res.status !== 200) throw new Error(`API Géo'DAE HTTP ${res.status}`)
  return (res.body as { features?: GeodaeFeature[] })?.features ?? []
}

function fromFeature(f: GeodaeFeature): GeodaeInventoryItem {
  const p = f.properties
  return {
    gid: String(p.gid),
    nom: str(p.nom),
    num_serie: str(p.num_serie),
    etat: str(p.etat),
    etat_fonct: str(p.etat_fonct),
    expt_siren: str(p.expt_siren),
    expt_rais: str(p.expt_rais),
    dermnt: str(p.dermnt),
    maj_don: str(p.maj_don),
    com_nom: str(p.com_nom),
    source: 'geodae_api',
  }
}

/** Le filtre _where n'échappe pas les séparateurs : les valeurs ambiguës sont refusées */
function assertWhereSafe(value: string, what: string): void {
  if (/[,()]/.test(value)) throw new Error(`${what} incompatible avec le filtre _where`)
}

/** Fiches dont le champ num_serie est exactement la valeur donnée (périmètre du compte). */
export async function searchGeodaeApiBySerial(serial: string): Promise<GidCandidate[]> {
  assertWhereSafe(serial, 'numéro de série')
  const features = await geodaeApiFeatures({ _where: `eq(num_serie,${serial})`, limit: '10' })
  return features.map((f): GidCandidate => ({ ...fromFeature(f), matched_on: 'num_serie' }))
}

/**
 * Inventaire des DAE visibles par le compte exploitant, restreint au SIREN donné
 * (GEODAE_SIREN) quand il est fourni. Ordre stable par gid pour que la pagination,
 * si elle devait servir, ne saute ni ne répète de fiche.
 */
export async function listGeodaeInventory(siren?: string | null): Promise<GeodaeInventoryItem[]> {
  const base: Record<string, string> = { sort_by: 'gid:asc' }
  if (siren) {
    if (!/^\d{9}$/.test(siren)) throw new Error('GEODAE_SIREN invalide : 9 chiffres attendus')
    base._where = `eq(expt_siren,${siren})`
  }
  const items: GeodaeInventoryItem[] = []
  for (let offset = 0; offset < 200_000; offset += INVENTORY_PAGE) {
    const features = await geodaeApiFeatures({ ...base, limit: String(INVENTORY_PAGE), offset: String(offset) })
    items.push(...features.map(fromFeature))
    if (features.length < INVENTORY_PAGE) break
  }
  return items
}

// ─── Recherche d'identifiant ─────────────────────────────────────────────────

/**
 * Cherche le gid Géo'DAE d'un numéro de série sur le champ num_serie des fiches du
 * compte. Un second essai en majuscules rattrape une casse différente entre les deux
 * bases. Les erreurs sont rendues dans `sources`, jamais levées : aucune réponse de
 * l'API = « erreur », pas « introuvable » (voir outcomeOf dans types.ts).
 */
export async function lookupGidBySerial(serial: string): Promise<LookupResult> {
  const clean = serial.trim()
  if (!isGeodaeApiConfigured()) return { serial: clean, candidates: [], sources: { geodae_api: 'non configuré' } }
  try {
    let candidates = await searchGeodaeApiBySerial(clean)
    const upperCased = clean.toUpperCase()
    if (candidates.length === 0 && upperCased !== clean) candidates = await searchGeodaeApiBySerial(upperCased)
    return { serial: clean, candidates, sources: { geodae_api: 'ok' } }
  } catch (err) {
    return { serial: clean, candidates: [], sources: { geodae_api: `erreur : ${err instanceof Error ? err.message : String(err)}` } }
  }
}
