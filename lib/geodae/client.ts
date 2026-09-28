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

import { GEODAE_DATASET_UUID, type GidCandidate, type LookupResult } from '@/lib/geodae/types'

const OPEN_DATA_RESOURCE = 'edb6a9e1-2f16-4bbf-99e7-c3eb6b90794c'
const OPEN_DATA_URL = `https://tabular-api.data.gouv.fr/api/resources/${OPEN_DATA_RESOURCE}/data/`
const CATALOGUE_URL = 'https://catalogue.atlasante.fr'
const TIMEOUT_MS = 20_000

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
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

async function geodaeToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token
  const creds = geodaeCredentials()
  if (!creds) throw new Error('GEODAE_USERNAME / GEODAE_PASSWORD non configurés')

  const { status, body } = await fetchJson(`${CATALOGUE_URL}/api/jwt_login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  })
  const token = (body as { token?: string } | null)?.token
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

export async function searchGeodaeApiBySerial(serial: string): Promise<GidCandidate[]> {
  // Le filtre _where n'échappe pas les séparateurs : on refuse les valeurs ambiguës
  if (/[,()]/.test(serial)) throw new Error('numéro de série incompatible avec le filtre _where')

  async function query(token: string) {
    const url = new URL(`${CATALOGUE_URL}/api/data/${GEODAE_DATASET_UUID}`)
    url.searchParams.set('_where', `eq(num_serie,${serial})`)
    url.searchParams.set('limit', '10')
    return fetchJson(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  }

  let res = await query(await geodaeToken())
  if (res.status === 401) res = await query(await geodaeToken(true)) // jeton expiré : on se reconnecte une fois
  if (res.status !== 200) throw new Error(`API Géo'DAE HTTP ${res.status}`)

  const features = ((res.body as { features?: GeodaeFeature[] })?.features ?? [])
  return features.map((f): GidCandidate => ({
    gid: String(f.properties.gid),
    nom: str(f.properties.nom),
    num_serie: str(f.properties.num_serie),
    etat: str(f.properties.etat),
    etat_fonct: str(f.properties.etat_fonct),
    expt_siren: str(f.properties.expt_siren),
    expt_rais: str(f.properties.expt_rais),
    dermnt: str(f.properties.dermnt),
    source: 'geodae_api',
    matched_on: 'num_serie',
  }))
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
