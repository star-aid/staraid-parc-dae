import type { DAEStatus, BatteryStatus } from '@/types'

// ─── Règles métier d'expiration par marque (tableau STAR aid juin 2026) ──────

type BrandKey =
  | 'SAVERONE'
  | 'STRYKER'        // HeartSine / Samaritan / LifePak
  | 'MINDRAY'
  | 'ZOLL'
  | 'CARDIAC_SCIENCE' // PowerHeart — électrodes pédiatriques intégrées
  | 'COLSON'          // CU Medical / iPAD
  | 'PHILIPS_FR3'     // Philips HeartStart FR3 → batterie 3 ans
  | 'PHILIPS_FR2'     // Philips HeartStart FR2 → batterie 4 ans
  | 'PHILIPS'         // Philips / Laerdal sans modèle FR3/FR2 détecté → 4 ans par défaut
  | 'OTHER'

// Durée de vie batterie (années) par marque — source : tableau officiel STAR aid
const BATTERY_YEARS: Record<BrandKey, number> = {
  SAVERONE:        4,
  STRYKER:         4,
  MINDRAY:         5,
  ZOLL:            5,
  CARDIAC_SCIENCE: 4,
  COLSON:          4,
  PHILIPS_FR3:     3,
  PHILIPS_FR2:     4,
  PHILIPS:         4,
  OTHER:           5,
}

/**
 * Extrait la clé de marque depuis la valeur brute "MARQUE - Modèle" (custom field 12583).
 * La détection s'effectue en uppercase sur la partie marque (avant " - ") ; pour
 * Philips FR3/FR2, le modèle entier est inspecté car c'est lui qui distingue les deux.
 */
export function extractBrand(brandModel: string | null): BrandKey {
  if (!brandModel) return 'OTHER'
  const full = brandModel.toUpperCase()
  const brandPart = brandModel.includes(' - ')
    ? brandModel.split(' - ')[0].toUpperCase().trim()
    : full.trim()

  if (brandPart.includes('SAVERONE') || brandPart.includes('SAVER ONE')) return 'SAVERONE'
  if (
    brandPart.includes('STRYKER') ||
    brandPart.includes('HEARTSINE') ||
    brandPart.includes('SAMARITAN') ||
    brandPart.includes('LIFEPAK')
  ) return 'STRYKER'
  if (brandPart.includes('MINDRAY')) return 'MINDRAY'
  if (brandPart.includes('ZOLL')) return 'ZOLL'
  if (
    full.includes('CARDIAC SCIENCE') ||
    brandPart.includes('POWERHEART')
  ) return 'CARDIAC_SCIENCE'
  if (
    brandPart.includes('COLSON') ||
    full.includes('CU MEDICAL') ||
    brandPart.includes('IPAD')
  ) return 'COLSON'
  if (
    brandPart.includes('PHILIPS') ||  // inclut PHILLIPS (double L)
    brandPart.includes('LAERDAL') ||
    brandPart.includes('HEARTSTART')
  ) {
    if (full.includes('FR3') || full.includes('FR 3')) return 'PHILIPS_FR3'
    if (full.includes('FR2') || full.includes('FR 2')) return 'PHILIPS_FR2'
    return 'PHILIPS'
  }
  return 'OTHER'
}

// Ajoute des années (supporte les fractions : 1.5 = +1 an +6 mois)
function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr)
  const wholeYears = Math.floor(years)
  const months = Math.round((years - wholeYears) * 12)
  d.setFullYear(d.getFullYear() + wholeYears)
  if (months) d.setMonth(d.getMonth() + months)
  return d.toISOString().split('T')[0]
}

/**
 * Calcule les dates d'expiration réelles selon la marque (tableau STAR aid juin 2026).
 *
 * Règle générale :
 *   - battery_expiry    = battery_install_date + durée_marque (cf. BATTERY_YEARS)
 *   - electrodes_adult  = DLU brut (champ 12587, date limite d'utilisation)
 *   - electrodes_pediatric = DLU brut (champ 12588)
 *
 * Exceptions :
 *   - CARDIAC_SCIENCE : pas d'électrodes pédiatriques dédiées (mode intégré) → null
 *   - ZOLL + DLU pédiatrique absent : fallback Pedi-Padz II → install + 18 mois
 */
export function computeExpiryDates(params: {
  brand: string | null               // valeur brute du champ "Marque/modèle" (12583)
  battery_install_date: string | null
  raw_electrodes_adult: string | null    // DLU brut champ 12587
  raw_electrodes_pediatric: string | null // DLU brut champ 12588
}): {
  battery_expiry: string | null
  electrodes_adult_expiry: string | null
  electrodes_pediatric_expiry: string | null
} {
  const brandKey = extractBrand(params.brand)

  const battery_expiry = params.battery_install_date
    ? addYears(params.battery_install_date, BATTERY_YEARS[brandKey])
    : null

  // Électrodes adultes : toujours DLU brut, toutes marques
  const electrodes_adult_expiry = params.raw_electrodes_adult ?? null

  // Électrodes pédiatriques
  let electrodes_pediatric_expiry: string | null
  if (brandKey === 'CARDIAC_SCIENCE') {
    // Électrodes intégrées — pas de consommable pédiatrique séparé
    electrodes_pediatric_expiry = null
  } else if (!params.raw_electrodes_pediatric) {
    // DLU pédiatrique non renseignée : on utilise la même date que les électrodes adultes
    electrodes_pediatric_expiry = params.raw_electrodes_adult ?? null
  } else {
    electrodes_pediatric_expiry = params.raw_electrodes_pediatric ?? null
  }

  return { battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry }
}

// Retourne la date d'expiration la plus proche entre électrodes adultes et pédiatriques
function earliestElectrodes(
  adult: string | null,
  pediatric: string | null
): Date | null {
  const a = adult ? new Date(adult) : null
  const p = pediatric ? new Date(pediatric) : null
  if (a && p) return a < p ? a : p
  return a ?? p
}

export function computeDAEStatus(dae: {
  next_maintenance_date: string | null
  battery_expiry: string | null
  electrodes_adult_expiry: string | null
  electrodes_pediatric_expiry: string | null
}): { status: DAEStatus; reason: string } {
  const today = new Date()
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

  const nextMaint = dae.next_maintenance_date ? new Date(dae.next_maintenance_date) : null
  const battExp   = dae.battery_expiry ? new Date(dae.battery_expiry) : null
  const elecExp   = earliestElectrodes(dae.electrodes_adult_expiry, dae.electrodes_pediatric_expiry)

  if (!nextMaint && !battExp && !elecExp) {
    return { status: 'inconnu', reason: 'Données insuffisantes' }
  }

  if (nextMaint && nextMaint < today) {
    return { status: 'critique', reason: 'Maintenance échue' }
  }
  if (battExp && battExp < today) {
    return { status: 'critique', reason: 'Batterie expirée' }
  }
  if (elecExp && elecExp < today) {
    return { status: 'critique', reason: 'Électrodes expirées' }
  }

  if (nextMaint && nextMaint <= in30Days) {
    return { status: 'vigilance', reason: 'Maintenance dans moins de 30 jours' }
  }
  if (battExp && battExp <= in30Days) {
    return { status: 'vigilance', reason: 'Batterie expire dans moins de 30 jours' }
  }
  if (elecExp && elecExp <= in30Days) {
    return { status: 'vigilance', reason: 'Électrodes expirent dans moins de 30 jours' }
  }

  return { status: 'conforme', reason: 'Tout à jour' }
}

export function computeConsumableStatus(expiryDate: string | null): BatteryStatus {
  if (!expiryDate) return 'inconnu'
  const today = new Date()
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
  const expiry = new Date(expiryDate)

  if (expiry < today) return 'expire'
  if (expiry <= in30Days) return 'a_remplacer'
  return 'ok'
}

// zone_geographique (custom field Synchroteam) est prioritaire sur l'adresse
// Valeurs connues : NORD, SUD, EST, OUEST → REU ; MAYOTTE → MYT ; GUADELOUPE → GLP
export function detectTerritory(address: string, zoneGeographique?: string | null): 'REU' | 'MYT' | 'GLP' {
  if (zoneGeographique) {
    const zone = zoneGeographique.toLowerCase()
    if (zone.includes('mayotte')) return 'MYT'
    if (zone.includes('guadeloupe')) return 'GLP'
    if (['nord', 'sud', 'est', 'ouest', 'centre'].some((z) => zone.includes(z))) return 'REU'
  }
  const lower = address.toLowerCase()
  if (lower.includes('réunion') || lower.includes('reunion') || lower.includes('974')) return 'REU'
  if (lower.includes('mayotte') || lower.includes('976')) return 'MYT'
  if (lower.includes('guadeloupe') || lower.includes('971')) return 'GLP'
  return 'REU'
}
