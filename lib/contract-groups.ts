// Groupes métier pour le filtre "Type de contrat" global
// Mapping basé sur les valeurs réelles de defibrillators.contract_type en Supabase

export const CONTRACT_GROUPS = {
  location: ['Location', 'Contrat de location', 'LOCATION LECLERC'],
  maintenance: [
    'Maintenance préventive',
    'Contrat de maintenance',
    'Contrat de maintenance curative',
    'Contrat de maintenance préventive',
  ],
  // autre = PDC, Audit, Aucun (explicite) + null (aucun contrat renseigné)
  autre: [
    'PDC - Passage Annuel',
    'Audit simple',
    "Contrat d'audit",
    'Aucun',
  ],
} as const

export type ContratGroup = 'location' | 'maintenance' | 'autre'
export const ALL_GROUPS: ContratGroup[] = ['location', 'maintenance', 'autre']

// Extrait les groupes actifs depuis le paramètre URL ?contrat=location,maintenance
export function parseContratParam(
  param: string | string[] | undefined
): ContratGroup[] {
  const raw = Array.isArray(param) ? param[0] : (param ?? '')
  if (!raw) return []
  return raw
    .split(',')
    .filter((g): g is ContratGroup => g === 'location' || g === 'maintenance' || g === 'autre')
}

// Vrai si aucun filtre actif (0 ou 3 groupes = tout afficher)
export function isAllSelected(groups: ContratGroup[]): boolean {
  return groups.length === 0 || groups.length === ALL_GROUPS.length
}

// Construit la chaîne PostgREST pour Supabase .or()
// Retourne null si aucun filtre à appliquer (affiche tout)
export function buildContratOrFilter(groups: ContratGroup[]): string | null {
  if (isAllSelected(groups)) return null

  const parts: string[] = []

  if (groups.includes('location')) {
    // Les valeurs avec espaces doivent être entre guillemets dans le .in.()
    parts.push('contract_type.in.(Location,"Contrat de location","LOCATION LECLERC")')
  }

  if (groups.includes('maintenance')) {
    const vals = [
      '"Maintenance préventive"',
      '"Contrat de maintenance"',
      '"Contrat de maintenance curative"',
      '"Contrat de maintenance préventive"',
    ].join(',')
    parts.push(`contract_type.in.(${vals})`)
  }

  if (groups.includes('autre')) {
    // PDC, Audit + Aucun (explicite) + null (champ non renseigné)
    const vals = [
      '"PDC - Passage Annuel"',
      '"Audit simple"',
      `"Contrat d'audit"`,
      'Aucun',
    ].join(',')
    parts.push(`contract_type.in.(${vals})`)
    parts.push('contract_type.is.null')
  }

  return parts.join(',')
}
