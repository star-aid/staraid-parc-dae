import type { DAEStatus, BatteryStatus } from '@/types'

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
