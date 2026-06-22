export const INTERNAL_FIELDS = [
  { value: 'battery_expiry',        label: 'Date expiration batterie',   type: 'date' as const },
  { value: 'electrodes_expiry',     label: 'Date expiration électrodes', type: 'date' as const },
  { value: 'serial_number',         label: 'Numéro de série',            type: 'text' as const },
  { value: 'model',                 label: 'Modèle',                     type: 'text' as const },
  { value: 'brand',                 label: 'Marque',                     type: 'text' as const },
  { value: 'next_maintenance_date', label: 'Prochaine maintenance',      type: 'date' as const },
  { value: 'last_maintenance_date', label: 'Dernière maintenance',       type: 'date' as const },
  { value: 'contract_type',         label: 'Type contrat',               type: 'text' as const },
  { value: 'contract_start',        label: 'Début contrat',              type: 'date' as const },
  { value: 'contract_end',          label: 'Fin contrat',                type: 'date' as const },
  { value: 'notes',                 label: 'Notes',                      type: 'text' as const },
] as const

export const HEURISTICS: Array<{
  keywords: string[]
  internal: string
  type: 'date' | 'text' | 'number'
}> = [
  { keywords: ['batterie', 'battery', 'pile'],           internal: 'battery_expiry',       type: 'date' },
  { keywords: ['électrode', 'electrode', 'pad'],         internal: 'electrodes_expiry',    type: 'date' },
  { keywords: ['série', 'serial', 'sn', 'n° série'],    internal: 'serial_number',         type: 'text' },
  { keywords: ['modèle', 'model', 'référence', 'ref'],  internal: 'model',                 type: 'text' },
  { keywords: ['marque', 'brand', 'fabricant'],          internal: 'brand',                 type: 'text' },
  { keywords: ['maintenance', 'entretien', 'prochain'],  internal: 'next_maintenance_date', type: 'date' },
  { keywords: ['dernière', 'last', 'précédent'],         internal: 'last_maintenance_date', type: 'date' },
  { keywords: ['contrat', 'contract'],                   internal: 'contract_type',         type: 'text' },
  { keywords: ['installation', 'pose', 'début'],         internal: 'contract_start',        type: 'date' },
  { keywords: ['fin contrat', 'expiration contrat'],     internal: 'contract_end',          type: 'date' },
  { keywords: ['note', 'commentaire', 'remarque'],       internal: 'notes',                 type: 'text' },
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
