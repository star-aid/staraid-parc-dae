// Types et utilitaires partagés du contrôle de cohérence Synchroteam ↔ Géo'DAE.
// Ce fichier est importé côté client : il ne doit dépendre d'aucun module serveur.

import type { TerritoryCode } from '@/types'

/** Un DAE actif sous contrat de location, tel qu'extrait de Synchroteam (étape 1). */
export interface LocationDae {
  /** Compte Synchroteam d'origine (un compte par territoire) */
  account: TerritoryCode
  /** Identifiant interne Synchroteam, brut (sans préfixe territoire) */
  synchroteam_id: string
  name: string | null
  customer_name: string | null
  site_name: string | null
  /** Numéro de série (num_serie) — clé pivot de la réconciliation */
  serial_number: string | null
  /** Identifiant Géo'DAE (gid) stocké dans le champ personnalisé Synchroteam */
  geo_dae_id: string | null
  /** Type de contrat retenu : contrat Synchroteam si présent, sinon champ personnalisé */
  contract_type: string
  /** Identifiant retrouvé par la recherche Géo'DAE (étape 2), non encore reporté dans Synchroteam */
  found_geo_dae_id?: string | null
  /** Dernier résultat de recherche conservé en base (migration 012), s'il existe */
  lookup?: PersistedLookup | null
}

/** Un DAE Géo'DAE candidat pour un numéro de série recherché. */
export interface GidCandidate {
  gid: string
  nom: string | null
  /** Renseigné seulement via l'API exploitants */
  num_serie: string | null
  etat: string | null
  etat_fonct: string | null
  expt_siren: string | null
  expt_rais: string | null
  dermnt: string | null
  source: 'geodae_api' | 'open_data'
  /** Champ sur lequel la correspondance a été faite */
  matched_on: 'num_serie' | 'nom'
}

export interface LookupResult {
  serial: string
  candidates: GidCandidate[]
  /** État de chaque source : 'ok', 'non configuré' ou 'erreur : …' */
  sources: { open_data: string; geodae_api: string }
}

/**
 * Issue d'une recherche : une correspondance = trouvé, plusieurs = ambigu, aucune =
 * introuvable si au moins une source a répondu, erreur sinon.
 */
export function outcomeOf(result: LookupResult): 'found' | 'ambiguous' | 'not_found' | 'error' {
  const n = result.candidates.length
  if (n === 1) return 'found'
  if (n > 1) return 'ambiguous'
  const anySourceOk = result.sources.open_data === 'ok' || result.sources.geodae_api === 'ok'
  return anySourceOk ? 'not_found' : 'error'
}

/** Message d'erreur quand aucune source n'a répondu */
export function sourcesFailureMessage(result: LookupResult): string {
  return `aucune source n'a répondu (open data : ${result.sources.open_data} ; API exploitants : ${result.sources.geodae_api})`
}

/** Un DAE de l'inventaire Géo'DAE (open data par SIREN, ou API exploitants) */
export interface GeodaeInventoryItem {
  gid: string
  nom: string | null
  /** Renseigné par l'API exploitants ; sinon déduit du nom (STAR l'y encode) */
  num_serie: string | null
  etat: string | null
  etat_fonct: string | null
  expt_siren: string | null
  expt_rais: string | null
  dermnt: string | null
  maj_don: string | null
  com_nom: string | null
  source: 'open_data' | 'geodae_api'
}

/** Dernier résultat de recherche conservé pour un DAE (table geodae_lookups) */
export interface PersistedLookup {
  status: 'trouve' | 'ambigu' | 'introuvable' | 'erreur'
  /** Identifiant retenu quand la correspondance est unique */
  geodae_gid: string | null
  candidates: GidCandidate[]
  sources: LookupResult['sources'] | null
  error: string | null
  checked_at: string
  /** Utilisateur ayant lancé le contrôle, ou 'cron' */
  checked_by: string | null
  /** Date du report dans Synchroteam, si fait depuis ce contrôle */
  reported_at: string | null
}

export const LOOKUP_STATUS_LABELS: Record<PersistedLookup['status'], string> = {
  trouve:      'Trouvé',
  ambigu:      'Plusieurs correspondances',
  introuvable: "Introuvable dans Géo'DAE",
  erreur:      'Erreur de recherche',
}

// ─── Report dans Synchroteam (étape 2, migration 20260928000011) ─────────────

/** Demande de report d'un identifiant Géo'DAE validé par l'utilisateur */
export interface WritebackRequest {
  account: TerritoryCode
  synchroteam_id: string
  /** N° de série affiché : l'équipement est relu et doit toujours le porter */
  serial_number: string | null
  gid: string
}

export type WritebackResult =
  | {
      ok: true
      gid: string
      /** Contenu du champ Synchroteam avant l'écriture */
      previous_value: string | null
      /** Vrai si la valeur a été relue dans Synchroteam après l'écriture */
      verified: boolean
      /** Le champ contenait déjà cet identifiant : rien n'a été écrit */
      already_set?: boolean
      /** Mode simulation : charge utile qui aurait été envoyée */
      dry_run?: boolean
      payload?: unknown
      /** Autres éléments de l'équipement modifiés par l'écriture, tags compris (attendu : aucun) */
      collateral?: string[]
    }
  | { ok: false; error: string }

/** Ligne de la table geodae_writebacks */
export interface WritebackRow {
  id: string
  account: TerritoryCode | null
  synchroteam_id: string
  defibrillator_id: string | null
  serial_number: string | null
  geodae_gid: string | null
  /** Champ écrit (migration 014) : 'geo_dae_id' ou 'last_maintenance_field' ; absent avant la migration */
  field?: string | null
  /** Valeur écrite (migration 014) ; l'identifiant reste aussi dans geodae_gid */
  value?: string | null
  previous_value: string | null
  status: 'ok' | 'erreur'
  verified: boolean
  error: string | null
  written_by: string | null
  written_at: string
}

// ─── Journal des contrôles (migration 20260922000009) ────────────────────────

export type AnomalyType =
  | 'absent_geodae'             // DAE Synchroteam introuvable dans Géo'DAE
  | 'ambigu'                    // plusieurs DAE Géo'DAE pour un n° de série
  | 'erreur_recherche'          // source injoignable lors du contrôle
  | 'divergence_id'             // identifiant Synchroteam ≠ gid Géo'DAE (étape 3)
  | 'non_reference_synchroteam' // DAE Géo'DAE absent de Synchroteam (étape 3)

export const ANOMALY_LABELS: Record<AnomalyType, string> = {
  absent_geodae:             "Absent de Géo'DAE",
  ambigu:                    'Plusieurs correspondances',
  erreur_recherche:          'Erreur de recherche',
  divergence_id:             'Identifiant divergent',
  non_reference_synchroteam: 'Non référencé dans Synchroteam',
}

/** Résultat d'une recherche pour une ligne, tel qu'envoyé au journal */
export interface JournalItem {
  account: TerritoryCode
  synchroteam_id: string
  serial_number: string | null
  synchroteam_geo_dae_id: string | null
  outcome: 'found' | 'ambiguous' | 'not_found' | 'error'
  candidates: GidCandidate[]
  error?: string | null
  sources?: LookupResult['sources'] | null
}

export interface JournalRun {
  id: string
  started_at: string
  finished_at: string | null
  triggered_by: string | null
  scope: string | null
  examined: number
  found: number
  ambiguous: number
  not_found: number
  errors: number
  /** État des sources ; pour un rapprochement (point 3) : kind = 'reconcile' + compteurs par type */
  sources?: Record<string, unknown> | null
}

export interface AnomalyRow {
  id: string
  type: AnomalyType
  account: TerritoryCode | null
  synchroteam_id: string | null
  defibrillator_id: string | null
  serial_number: string | null
  synchroteam_geo_dae_id: string | null
  geodae_gid: string | null
  details: Record<string, unknown> | null
  first_seen_at: string
  last_seen_at: string
  resolved_at: string | null
  resolution: string | null
}

export interface JournalSummary {
  /** Faux tant que la migration 009 n'est pas appliquée */
  available: boolean
  reason?: string
  runs: JournalRun[]
  open_by_type: Record<string, number>
  open_total: number
  open_anomalies: AnomalyRow[]
  /** Derniers reports dans Synchroteam (migration 011) ; vide avec `writebacks_reason` si la table manque */
  writebacks: WritebackRow[]
  writebacks_total: number
  writebacks_reason?: string
}

export interface ContractTypeCount {
  type: string
  count: number
  /** Vrai si la valeur est reconnue comme « location » (cf. LOCATION_TYPES) */
  is_location: boolean
}

/** Bilan de l'extraction pour un compte Synchroteam. */
export interface AccountExtraction {
  account: TerritoryCode
  /** Faux si les variables d'environnement du compte sont absentes */
  configured: boolean
  active_total: number
  location_total: number
  with_geo_dae_id: number
  without_geo_dae_id: number
  without_serial: number
  /** Valeurs distinctes de type de contrat vues sur les DAE actifs (repère les variantes non reconnues) */
  contract_types_seen: ContractTypeCount[]
  /** Origine du mapping des champs personnalisés utilisé pour ce compte */
  mapping_source: string
  /** Champs internes indispensables non résolus sur ce compte (ex. geo_dae_id) */
  missing_fields: string[]
  error: string | null
  duration_ms: number
  /** Date de la dernière synchronisation des DAE du compte (source Supabase uniquement) */
  synced_at?: string | null
}

export interface ExtractionTotals {
  active_total: number
  location_total: number
  with_geo_dae_id: number
  without_geo_dae_id: number
  without_serial: number
}

export interface ExtractionResult {
  /** Date de la lecture directe, ou de la dernière synchronisation pour la copie Supabase */
  extracted_at: string
  /** 'supabase' : copie synchronisée chaque matin (défaut) ; 'synchroteam' : lecture directe */
  source?: 'supabase' | 'synchroteam'
  accounts: AccountExtraction[]
  totals: ExtractionTotals
  rows: LocationDae[]
  /** Avertissement global (ex. mapping Supabase indisponible) */
  warning: string | null
  /** Renseigné si les résultats de recherche conservés n'ont pas pu être lus (migration 012) */
  lookups_reason?: string
}

/**
 * Identifiant de la base des DAE dans le catalogue Atlasanté (cf. documentation
 * de l'API exploitants). C'est le paramètre `uuid` de la route
 * `information-sheet/:uuid/:gid` du portail Géo'DAE.
 */
export const GEODAE_DATASET_UUID = '8777a504-6c3e-4abe-8100-60bb58767faa'

/** Fiche d'un DAE sur le portail Géo'DAE (nécessite d'être connecté au portail). */
export function geodaeSheetUrl(gid: string): string {
  return `https://geodae.atlasante.fr/information-sheet/${GEODAE_DATASET_UUID}/${encodeURIComponent(gid.trim())}`
}

/** Formulaire de modification d'un DAE sur le portail (compte exploitant). */
export function geodaeEditUrl(gid: string): string {
  return `https://geodae.atlasante.fr/form/${GEODAE_DATASET_UUID}/${encodeURIComponent(gid.trim())}`
}

export const TERRITORY_LABELS: Record<TerritoryCode, string> = {
  REU: 'La Réunion',
  MYT: 'Mayotte',
  GLP: 'Guadeloupe',
}

function csvEscape(v: string | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(';') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** CSV (séparateur « ; », compatible Excel FR) des DAE extraits. */
export function toCsv(rows: LocationDae[]): string {
  const cols = [
    'Compte', 'ID Synchroteam', 'N° série', "Identifiant Géo'DAE", "Identifiant Géo'DAE trouvé",
    'Client', 'Site', 'Nom équipement', 'Type de contrat', "Recherche Géo'DAE", 'Contrôlé le', 'Contrôlé par',
  ]
  const lines = [cols.join(';')]
  for (const r of rows) {
    lines.push([
      r.account,
      r.synchroteam_id,
      r.serial_number,
      r.geo_dae_id,
      r.found_geo_dae_id ?? null,
      r.customer_name,
      r.site_name,
      r.name,
      r.contract_type,
      r.lookup ? LOOKUP_STATUS_LABELS[r.lookup.status] : null,
      r.lookup?.checked_at ?? null,
      r.lookup?.checked_by ?? null,
    ].map(csvEscape).join(';'))
  }
  return '﻿' + lines.join('\n')
}

// ─── Comparaison des dates de maintenance Synchroteam ↔ Géo'DAE ──────────────

export type MaintenanceSituation =
  | 'identique'           // même date
  | 'proche'              // écart inférieur ou égal à la tolérance
  | 'synchroteam_recent'  // Synchroteam plus récent : Géo'DAE à mettre à jour
  | 'geodae_recent'       // Géo'DAE plus récent : Synchroteam à mettre à jour
  | 'synchroteam_vide'    // aucune intervention dans Synchroteam : à compléter
  | 'geodae_vide'         // pas de date déclarée dans Géo'DAE
  | 'aucune_date'

export const MAINTENANCE_LABELS: Record<MaintenanceSituation, string> = {
  identique:          'Identique',
  proche:             'Écart toléré',
  synchroteam_recent: 'Synchroteam plus récent',
  geodae_recent:      "Géo'DAE plus récent",
  synchroteam_vide:   'Synchroteam sans date',
  geodae_vide:        "Géo'DAE sans date",
  aucune_date:        'Aucune date',
}

export interface MaintenanceRow {
  account: TerritoryCode
  synchroteam_id: string
  defibrillator_id: string
  serial_number: string | null
  geo_dae_id: string
  customer_name: string | null
  site_name: string | null
  /** Champ « Date dernière Maintenance » de la fiche équipement Synchroteam (copie Supabase), yyyy-mm-dd : la référence */
  synchroteam_date: string | null
  /** Dernière intervention terminée, toute nature (dépannage compris) : information, pas la référence */
  last_intervention_date: string | null
  /** Date de dernière maintenance déclarée dans Géo'DAE (open data), yyyy-mm-dd */
  geodae_date: string | null
  geodae_name: string | null
  /** Synchroteam moins Géo'DAE, en jours (positif = Synchroteam plus récent) */
  gap_days: number | null
}

export interface MaintenanceResult {
  extracted_at: string
  /** Date de mise à jour la plus récente vue dans l'open data (fraîcheur de la source Géo'DAE) */
  geodae_updated_at: string | null
  field_mapped: boolean
  totals: { location_with_gid: number; paired: number; unpaired: number }
  rows: MaintenanceRow[]
  warning: string | null
}

/** Situation d'un DAE pour une tolérance donnée (jours) : pure, utilisable côté client */
export function maintenanceSituation(row: Pick<MaintenanceRow, 'synchroteam_date' | 'geodae_date' | 'gap_days'>, toleranceDays: number): MaintenanceSituation {
  if (!row.synchroteam_date && !row.geodae_date) return 'aucune_date'
  if (!row.synchroteam_date) return 'synchroteam_vide'
  if (!row.geodae_date) return 'geodae_vide'
  const gap = row.gap_days ?? 0
  if (gap === 0) return 'identique'
  if (Math.abs(gap) <= toleranceDays) return 'proche'
  return gap > 0 ? 'synchroteam_recent' : 'geodae_recent'
}

export interface MaintenanceWriteRequest {
  account: TerritoryCode
  synchroteam_id: string
  serial_number: string | null
  /** Date à écrire dans le champ « Date dernière maintenance », yyyy-mm-dd */
  date: string
}

export type MaintenanceWriteResult =
  | { ok: true; date: string; previous_value: string | null; verified: boolean; already_set?: boolean; dry_run?: boolean; payload?: unknown; collateral?: string[] }
  | { ok: false; error: string }

export function maintenanceToCsv(rows: MaintenanceRow[], toleranceDays: number): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Compte', 'N° série', 'Identifiant Géo\'DAE', 'Client', 'Site', 'Date dernière maintenance Synchroteam', 'Dernière intervention (toute nature)', 'Date Géo\'DAE', 'Écart (jours)', 'Situation']
  const lines = rows.map((r) => [
    r.account, r.serial_number, r.geo_dae_id, r.customer_name, r.site_name, r.synchroteam_date, r.last_intervention_date, r.geodae_date, r.gap_days,
    MAINTENANCE_LABELS[maintenanceSituation(r, toleranceDays)],
  ].map(esc).join(';'))
  return '﻿' + [head.map(esc).join(';'), ...lines].join('\n')
}
