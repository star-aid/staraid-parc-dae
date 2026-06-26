// Groupes métier pour le filtre "Type de contrat" global

// Valeurs explicites de chaque groupe fixe
export const LOCATION_TYPES    = ['Location', 'Contrat de location', 'Contrat de Location', 'LOCATION LECLERC']
export const MAINTENANCE_TYPES = ['Contrat de maintenance', 'Contrat Maintenance Préventive', 'Contrat de maintenance curative']

// AUTRES = tout ce qui n'est ni LOCATION ni MAINTENANCE (chargé dynamiquement depuis Supabase)

export type ContratGroup = 'location' | 'maintenance' | 'autre'
export const ALL_GROUPS: ContratGroup[] = ['location', 'maintenance', 'autre']

export type AutreType = { type: string; count: number }

// Parse ?contrat=location,maintenance
export function parseContratParam(
  param: string | string[] | undefined
): ContratGroup[] {
  const raw = Array.isArray(param) ? param[0] : (param ?? '')
  if (!raw) return []
  return raw
    .split(',')
    .filter((g): g is ContratGroup => g === 'location' || g === 'maintenance' || g === 'autre')
}

// Parse ?autreTypes=PDC - Passage Annuel|Aucun
// Retourne null si tout est sélectionné (pas de param = tous), tableau sinon
export function parseAutreTypesParam(
  param: string | undefined
): string[] | null {
  if (!param) return null
  return param.split('|').filter(Boolean)
}

// Vrai si aucun filtre actif → afficher tout
export function isAllSelected(groups: ContratGroup[], autreTypesSelected?: string[] | null): boolean {
  const groupsAll = groups.length === 0 || groups.length === ALL_GROUPS.length
  return groupsAll && !autreTypesSelected?.length
}

// Échappe une valeur pour PostgREST in.() — entoure de guillemets si elle contient des caractères spéciaux
function pgEscape(val: string): string {
  // Valeurs avec espaces, apostrophes ou tirets nécessitent des guillemets doubles
  if (/[\s',()]/.test(val)) return `"${val.replace(/"/g, '\\"')}"`
  return val
}

// Construit la chaîne PostgREST pour Supabase .or()
// autreTypesSelected : null/undefined = tous les types AUTRES, [] = aucun, [...] = sélection spécifique
export function buildContratOrFilter(
  groups: ContratGroup[],
  autreTypesSelected?: string[] | null
): string | null {
  if (isAllSelected(groups, autreTypesSelected)) return null

  const parts: string[] = []

  if (groups.includes('location')) {
    const vals = LOCATION_TYPES.map(pgEscape).join(',')
    parts.push(`contract_type.in.(${vals})`)
  }

  if (groups.includes('maintenance')) {
    const vals = MAINTENANCE_TYPES.map(pgEscape).join(',')
    parts.push(`contract_type.in.(${vals})`)
  }

  if (groups.includes('autre')) {
    if (autreTypesSelected && autreTypesSelected.length > 0) {
      // Sous-sélection spécifique
      const vals = autreTypesSelected.map(pgEscape).join(',')
      parts.push(`contract_type.in.(${vals})`)
    } else {
      // Tous les AUTRES : NOT IN (location + maintenance) OU NULL
      const excludeVals = [...LOCATION_TYPES, ...MAINTENANCE_TYPES].map(pgEscape).join(',')
      parts.push(`contract_type.not.in.(${excludeVals})`)
      parts.push('contract_type.is.null')
    }
  }

  if (parts.length === 0) return null
  return parts.join(',')
}
