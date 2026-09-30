// Recherche d'un identifiant Géo'DAE (gid) à partir d'un numéro de série.
// Fichier serveur uniquement : il lit des variables d'environnement secrètes.
//
// Deux sources, interrogées en parallèle :
//   1. L'open data Géo'DAE sur data.gouv.fr (API tabulaire, sans compte). La base
//      publique n'a pas de colonne numéro de série, mais STAR aid l'encode dans le
//      nom du DAE (« <site> - <n° série> ») : on cherche le numéro dans le nom.
//   2. L'API exploitants Géo'DAE (catalogue.atlasante.fr), si GEODAE_USERNAME et
//      GEODAE_PASSWORD sont définis : recherche exacte sur le champ num_serie,
//      limitée aux DAE du SIREN du compte.
//
// Lecture seule : rien n'est écrit ni dans Géo'DAE, ni dans Synchroteam.

import { GEODAE_DATASET_UUID, type GeodaeInventoryItem, type GidCandidate, type LookupResult } from '@/lib/geodae/types'

const OPEN_DATA_RESOURCE = 'edb6a9e1-2f16-4bbf-99e7-c3eb6b90794c'
const OPEN_DATA_URL = `https://tabular-api.data.gouv.fr/api/resources/${OPEN_DATA_RESOURCE}/data/`
export const CATALOGUE_URL = 'https://catalogue.atlasante.fr'
export const TIMEOUT_MS = 20_000

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

// ─── Source 1 : open data data.gouv.fr ───────────────────────────────────────

type OpenDataRow = {
  c_gid: number | string
  c_nom: string | null
  c_etat: string | null
  c_etat_fonct: string | null
  c_expt_siren: string | null
  c_expt_rais: string | null
  c_dermnt: string | null
  c_maj_don?: string | null
  c_com_nom?: string | null
}

/**
 * Inventaire complet des DAE déclarés sous un SIREN exploitant dans l'open data
 * (point 3 du cahier des charges). Suit les liens de pagination ; 200 lignes par page.
 */
export async function listOpenDataBySiren(siren: string): Promise<GeodaeInventoryItem[]> {
  const items: GeodaeInventoryItem[] = []
  const first = new URL(OPEN_DATA_URL)
  first.searchParams.set('c_expt_siren__exact', siren)
  first.searchParams.set('page_size', '200')
  let url: string | null = first.toString()
  for (let guard = 0; url && guard < 200; guard++) {
    const { status, body } = await fetchJson(url)
    if (status !== 200) throw new Error(`data.gouv HTTP ${status}`)
    const b = body as { data?: OpenDataRow[]; links?: { next?: string | null } } | null
    for (const r of b?.data ?? []) {
      items.push({
        gid: String(r.c_gid),
        nom: str(r.c_nom),
        num_serie: null,
        etat: str(r.c_etat),
        etat_fonct: str(r.c_etat_fonct),
        expt_siren: str(r.c_expt_siren),
        expt_rais: str(r.c_expt_rais),
        dermnt: str(r.c_dermnt),
        maj_don: str(r.c_maj_don),
        com_nom: str(r.c_com_nom),
        source: 'open_data',
      })
    }
    url = b?.links?.next ?? null
  }
  return items
}

export async function searchOpenDataBySerial(serial: string, siren: string | null): Promise<GidCandidate[]> {
  const url = new URL(OPEN_DATA_URL)
  url.searchParams.set('c_nom__contains', serial)
  if (siren) url.searchParams.set('c_expt_siren__exact', siren)
  url.searchParams.set('page_size', '20')

  const { status, body } = await fetchJson(url.toString())
  if (status !== 200) throw new Error(`data.gouv HTTP ${status}`)

  const rows = ((body as { data?: OpenDataRow[] })?.data ?? [])
  const needle = serial.toUpperCase()
  return rows
    // Le filtre « contient » de l'API est déjà appliqué ; on revérifie côté serveur
    .filter((r) => (r.c_nom ?? '').toUpperCase().includes(needle))
    .map((r): GidCandidate => ({
      gid: String(r.c_gid),
      nom: str(r.c_nom),
      num_serie: null,
      etat: str(r.c_etat),
      etat_fonct: str(r.c_etat_fonct),
      expt_siren: str(r.c_expt_siren),
      expt_rais: str(r.c_expt_rais),
      dermnt: str(r.c_dermnt),
      source: 'open_data',
      matched_on: 'nom',
    }))
}

// ─── Source 2 : API exploitants Géo'DAE ──────────────────────────────────────

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

export async function geodaeToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token
  const creds = geodaeCredentials()
  if (!creds) throw new Error('GEODAE_USERNAME / GEODAE_PASSWORD non configurés')

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
  const p = f.properties as GeodaeFeature['properties'] & { maj_don?: string | null; com_nom?: string | null }
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

export async function searchGeodaeApiBySerial(serial: string): Promise<GidCandidate[]> {
  // Le filtre _where n'échappe pas les séparateurs : on refuse les valeurs ambiguës
  if (/[,()]/.test(serial)) throw new Error('numéro de série incompatible avec le filtre _where')
  const features = await geodaeApiFeatures({ _where: `eq(num_serie,${serial})`, limit: '10' })
  return features.map((f): GidCandidate => ({ ...fromFeature(f), matched_on: 'num_serie' }))
}

/**
 * Tous les DAE visibles par le compte exploitant (30 par appel au plus, pagination
 * par offset). Constaté le 28/09/2026 : le compte ne voit que les DAE qu'il a
 * lui-même déclarés, pas ceux du SIREN principal, d'où le rôle de complément
 * (numéro de série explicite) et non de source principale.
 */
export async function listGeodaeApiAll(): Promise<GeodaeInventoryItem[]> {
  const PAGE = 30
  const items: GeodaeInventoryItem[] = []
  for (let offset = 0; offset < 20_000; offset += PAGE) {
    const features = await geodaeApiFeatures({ limit: String(PAGE), offset: String(offset) })
    items.push(...features.map(fromFeature))
    if (features.length < PAGE) break
  }
  return items
}

// ─── Recherche combinée ──────────────────────────────────────────────────────

/**
 * Cherche le gid Géo'DAE d'un numéro de série sur les deux sources disponibles.
 * Les doublons (même gid trouvé deux fois) sont fusionnés, la version API
 * exploitants étant conservée car plus riche (num_serie explicite).
 */
export async function lookupGidBySerial(serial: string): Promise<LookupResult> {
  const clean = serial.trim()
  const siren = process.env.GEODAE_SIREN?.trim() || null
  const sources: LookupResult['sources'] = { open_data: 'ok', geodae_api: isGeodaeApiConfigured() ? 'ok' : 'non configuré' }

  const [openData, api] = await Promise.all([
    searchOpenDataBySerial(clean, siren).catch((err: unknown) => {
      sources.open_data = `erreur : ${err instanceof Error ? err.message : String(err)}`
      return [] as GidCandidate[]
    }),
    isGeodaeApiConfigured()
      ? searchGeodaeApiBySerial(clean).catch((err: unknown) => {
          sources.geodae_api = `erreur : ${err instanceof Error ? err.message : String(err)}`
          return [] as GidCandidate[]
        })
      : Promise.resolve([] as GidCandidate[]),
  ])

  const byGid = new Map<string, GidCandidate>()
  for (const c of openData) byGid.set(c.gid, c)
  for (const c of api) byGid.set(c.gid, c) // l'API exploitants l'emporte

  return { serial: clean, candidates: Array.from(byGid.values()), sources }
}
