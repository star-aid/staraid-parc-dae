import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { fetchCustomFields } from '@/lib/synchroteam'
import { guessInternalField, INTERNAL_FIELDS } from '@/lib/field-mapping'

export const dynamic = 'force-dynamic'

// POST — lance la discovery : récupère les champs Synchroteam, propose le mapping,
//         et upserte automatiquement les champs identifiés avec confiance
export async function POST() {
  let syncFields: Array<{ id: number; label: string; type: string }> = []

  try {
    syncFields = await fetchCustomFields()
  } catch (err) {
    return NextResponse.json(
      { error: `Impossible de joindre l'API Synchroteam : ${String(err)}` },
      { status: 502 }
    )
  }

  const suggestions = syncFields.map((f) => ({
    synchroteam_field_id: f.id,
    synchroteam_label:    f.label,
    synchroteam_type:     f.type,
    suggestion:           guessInternalField(f.label, f.type),
  }))

  const autoMappable = suggestions
    .filter((s) => s.suggestion)
    .map((s) => ({
      synchroteam_field_id: s.synchroteam_field_id,
      synchroteam_label:    s.synchroteam_label,
      internal_field:       s.suggestion!.internal,
      field_type:           s.suggestion!.type,
    }))

  if (autoMappable.length > 0) {
    const supabase = createServiceClient()
    await supabase
      .from('custom_field_mapping')
      .upsert(autoMappable, { onConflict: 'synchroteam_field_id' })
  }

  return NextResponse.json({
    total:           syncFields.length,
    auto_mapped:     autoMappable.length,
    suggestions,
    internal_fields: INTERNAL_FIELDS,
  })
}
