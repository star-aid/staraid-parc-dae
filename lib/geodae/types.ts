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
}

export interface ExtractionTotals {
  active_total: number
  location_total: number
  with_geo_dae_id: number
  without_geo_dae_id: number
  without_serial: number
}

export interface ExtractionResult {
  extracted_at: string
  accounts: AccountExtraction[]
  totals: ExtractionTotals
  rows: LocationDae[]
  /** Avertissement global (ex. mapping Supabase indisponible) */
  warning: string | null
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
  const cols = ['Compte', 'ID Synchroteam', 'N° série', "Identifiant Géo'DAE", 'Client', 'Site', 'Nom équipement', 'Type de contrat']
  const lines = [cols.join(';')]
  for (const r of rows) {
    lines.push([
      r.account,
      r.synchroteam_id,
      r.serial_number,
      r.geo_dae_id,
      r.customer_name,
      r.site_name,
      r.name,
      r.contract_type,
    ].map(csvEscape).join(';'))
  }
  return '﻿' + lines.join('\n')
}
