export const INTERNAL_FIELDS = [
  { value: 'battery_expiry',        label: 'Date expiration/installation batterie', type: 'date' as const },
  { value: 'electrodes_expiry',     label: 'Date expiration électrodes adultes',    type: 'date' as const },
  { value: 'serial_number',         label: 'Numéro de série',                       type: 'text' as const },
  { value: 'model',                 label: 'Marque / modèle',                       type: 'text' as const },
  { value: 'brand',                 label: 'Marque',                                type: 'text' as const },
  { value: 'next_maintenance_date', label: 'Prochaine maintenance',                 type: 'date' as const },
  { value: 'last_maintenance_date', label: 'Dernière maintenance',                  type: 'date' as const },
  { value: 'contract_type',         label: 'Type contrat',                          type: 'text' as const },
  { value: 'contract_start',        label: 'Début contrat / Date livraison',        type: 'date' as const },
  { value: 'contract_end',          label: 'Fin contrat',                           type: 'date' as const },
  { value: 'notes',                 label: 'Notes / Commentaires',                  type: 'text' as const },
] as const

// Heuristiques alignées sur les labels réels STAR aid Synchroteam
// (confirmés par discovery du 2026-06-22)
export const HEURISTICS: Array<{
  keywords: string[]
  internal: string
  type: 'date' | 'text' | 'number'
}> = [
  // Batterie — "mise en place" = date installation (proxy pour expiry)
  { keywords: ['batterie', 'battery', 'pile', 'mise en place batt', 'date usine de la batt'],
    internal: 'battery_expiry', type: 'date' },
  // Électrodes adultes — DLU = Date Limite d'Utilisation = expiry
  { keywords: ['dlu électrodes adultes', 'péremption des électrodes adultes', 'électrodes adulte'],
    internal: 'electrodes_expiry', type: 'date' },
  // Électrodes pédiatriques — mappé sur même champ (le plus récent gagne à l'upsert)
  { keywords: ['dlu électrodes pédiatriques', 'péremption des électrodes pédiat', 'électrodes pédiat'],
    internal: 'electrodes_expiry', type: 'date' },
  // Numéro de série du DAE (pas celui de l'appareil de prêt)
  { keywords: ["n° de série du défibrillateur", 'serial', 'numéro de série'],
    internal: 'serial_number', type: 'text' },
  // Modèle / Marque
  { keywords: ['marque/modèle', 'marque', 'modèle', 'brand', 'model'],
    internal: 'model', type: 'text' },
  // Contrat
  { keywords: ['type de contrat', 'contract'],
    internal: 'contract_type', type: 'text' },
  { keywords: ['date de fin de contrat', 'fin contrat'],
    internal: 'contract_end', type: 'date' },
  { keywords: ['date de livraison', 'livraison'],
    internal: 'contract_start', type: 'date' },
  // Commentaires
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
