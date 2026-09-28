// Chargement du mapping des champs personnalisés configuré en base
// (table custom_field_mapping, modifiable dans /admin/field-mapping).
// Fichier serveur uniquement.

import { createServiceClient } from '@/lib/supabase'
import type { CustomFieldMapping } from '@/types'

/**
 * Renvoie le mapping en base et, s'il est vide ou inaccessible, un
 * avertissement : les appelants retombent alors sur l'heuristique par libellé.
 */
export async function loadDbMappings(): Promise<{ mappings: CustomFieldMapping[]; warning: string | null }> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('custom_field_mapping').select('*')
    if (error) throw new Error(error.message)
    const mappings = (data ?? []) as CustomFieldMapping[]
    return {
      mappings,
      warning: mappings.length === 0 ? 'Table custom_field_mapping vide : mapping deviné à partir des libellés Synchroteam' : null,
    }
  } catch (err) {
    return {
      mappings: [],
      warning: `Mapping Supabase indisponible (${err instanceof Error ? err.message : String(err)}) : mapping deviné à partir des libellés Synchroteam`,
    }
  }
}
