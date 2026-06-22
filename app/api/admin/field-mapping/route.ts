import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { fetchCustomFields } from '@/lib/synchroteam'
import type { CustomFieldMapping } from '@/types'

// GET — liste tous les mappings + les champs Synchroteam non encore mappés
export async function GET() {
  const supabase = createServiceClient()

  const { data: mappings, error } = await supabase
    .from('custom_field_mapping')
    .select('*')
    .order('synchroteam_field_id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Récupère aussi la liste live depuis Synchroteam pour détecter les nouveaux champs
  let synchroteamFields: Array<{ id: number; label: string; type: string }> = []
  try {
    synchroteamFields = await fetchCustomFields()
  } catch {
    // Non bloquant : si l'API est indisponible, on retourne juste les mappings en base
  }

  const mappedIds = new Set((mappings as CustomFieldMapping[]).map((m) => m.synchroteam_field_id))
  const unmapped = synchroteamFields.filter((f) => !mappedIds.has(f.id))

  return NextResponse.json({ mappings, unmapped, synchroteamFields })
}

// POST — upsert un ou plusieurs mappings
export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  const body = await req.json() as {
    rows: Array<{
      synchroteam_field_id: number
      synchroteam_label: string
      internal_field: string
      field_type: 'date' | 'text' | 'number'
    }>
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: 'rows requis' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('custom_field_mapping')
    .upsert(body.rows, { onConflict: 'synchroteam_field_id' })
    .select()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ saved: data })
}

// DELETE — supprime un mapping par synchroteam_field_id
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const fieldId = searchParams.get('field_id')

  if (!fieldId) {
    return NextResponse.json({ error: 'field_id requis' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('custom_field_mapping')
    .delete()
    .eq('synchroteam_field_id', Number(fieldId))

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}
