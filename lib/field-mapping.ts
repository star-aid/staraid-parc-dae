// Champs internes reconnus — tous les 17 custom fields Synchroteam STAR aid
// (discovery confirmée le 2026-06-22)
export const INTERNAL_FIELDS = [
  // Consommables critiques (calcul statut DAE)
  { value: 'battery_expiry',        label: 'Date installation/expiration batterie', type: 'date' as const },
  { value: 'electrodes_adult_expiry',    label: 'DLU électrodes adultes',       type: 'date' as const },
  { value: 'electrodes_pediatric_expiry', label: 'DLU électrodes pédiatriques', type: 'date' as const },
  // Identification appareil
  { value: 'serial_number',         label: 'N° de série du défibrillateur',         type: 'text' as const },
  { value: 'model',                 label: 'Marque / modèle',                       type: 'text' as const },
  { value: 'manufacture_date',      label: 'Date Usine du défibrillateur',          type: 'date' as const },
  // Localisation
  { value: 'location_detail',       label: 'Emplacement',                           type: 'text' as const },
  { value: 'cabinet_code',          label: 'Code Armoire',                          type: 'text' as const },
  { value: 'zone_geographique',     label: 'Zone Géographique',                     type: 'text' as const },
  { value: 'geo_dae_id',            label: 'Identifiant GEO DAE',                   type: 'text' as const },
  // Contrat
  { value: 'contract_type',         label: 'Type de contrat',                       type: 'text' as const },
  { value: 'contract_start',        label: 'Date de livraison',                     type: 'date' as const },
  { value: 'contract_end',          label: 'Date de fin de contrat',                type: 'date' as const },
  // Équipement annexe
  { value: 'kit_rcp',               label: 'Kit RCP Complet',                       type: 'text' as const },
  { value: 'loan_serial_number',    label: 'N° de série appareil de prêt',          type: 'text' as const },
  { value: 'registre_star_aid',     label: 'Registre Défibrillateur Star-Aid',      type: 'text' as const },
  // Notes
  { value: 'notes',                 label: 'Commentaires',                          type: 'text' as const },
] as const

// Heuristiques de mapping automatique — alignées sur les labels réels STAR aid
export const HEURISTICS: Array<{
  keywords: string[]
  internal: string
  type: 'date' | 'text' | 'number'
}> = [
  // --- Consommables ---
  { keywords: ['mise en place batterie', 'mise en place batt', 'date usine de la batt',
               'batterie ou pile', 'battery', 'pile'],
    internal: 'battery_expiry', type: 'date' },
  { keywords: ['dlu électrodes adultes', 'péremption des électrodes adultes', 'électrodes adulte'],
    internal: 'electrodes_adult_expiry', type: 'date' },
  { keywords: ['dlu électrodes pédiatriques', 'péremption des électrodes pédiat', 'électrodes pédiat'],
    internal: 'electrodes_pediatric_expiry', type: 'date' },

  // --- Identification ---
  { keywords: ["n° de série du défibrillateur", 'numéro de série du défibrillateur'],
    internal: 'serial_number', type: 'text' },
  { keywords: ['marque/modèle', 'marque', 'modèle'],
    internal: 'model', type: 'text' },
  { keywords: ['date usine du défibrillateur', 'date usine'],
    internal: 'manufacture_date', type: 'date' },

  // --- Localisation ---
  { keywords: ['emplacement'],
    internal: 'location_detail', type: 'text' },
  { keywords: ['code armoire'],
    internal: 'cabinet_code', type: 'text' },
  { keywords: ['zone géographique', 'zone geographique'],
    internal: 'zone_geographique', type: 'text' },
  { keywords: ['identifiant geo dae', 'geo dae', 'identifiant dae'],
    internal: 'geo_dae_id', type: 'number' },

  // --- Contrat ---
  { keywords: ['type de contrat'],
    internal: 'contract_type', type: 'text' },
  { keywords: ['date de fin de contrat', 'fin de contrat'],
    internal: 'contract_end', type: 'date' },
  { keywords: ['date de livraison', 'livraison'],
    internal: 'contract_start', type: 'date' },

  // --- Équipement annexe ---
  { keywords: ['kit rcp', 'kit complet', 'kit paire', 'kit rasoir', 'kit protection', 'kit gant'],
    internal: 'kit_rcp', type: 'text' },
  { keywords: ["n° de série de l'appareil de prêt", 'appareil de prêt', 'prêt'],
    internal: 'loan_serial_number', type: 'text' },
  { keywords: ['registre défibrillateur', 'registre star'],
    internal: 'registre_star_aid', type: 'text' },

  // --- Notes ---
  { keywords: ['commentaires', 'commentaire', 'notes', 'remarque'],
    internal: 'notes', type: 'text' },
]

export function guessInternalField(
  label: string,
  syncType: string
): { internal: string; type: 'date' | 'text' | 'number' } | null {
  const lower = label.toLowerCase()
  for (const h of HEURISTICS) {
    if (h.keywords.some((k) => lower.includes(k))) {
      return { internal: h.internal, type: syncType === 'date' ? 'date' : h.type }
    }
  }
  return null
}
