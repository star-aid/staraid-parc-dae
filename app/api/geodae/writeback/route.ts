import { NextRequest, NextResponse } from 'next/server'
import { authorizeGeodae } from '@/lib/geodae/route-auth'
import { loadDbMappings } from '@/lib/geodae/mappings'
import { writeGeoDaeId } from '@/lib/geodae/writeback'
import { recordWriteback } from '@/lib/geodae/journal'
import { invalidateExtractCache } from '@/lib/geodae/extract-supabase'
import type { WritebackRequest } from '@/lib/geodae/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ACCOUNTS = ['REU', 'MYT', 'GLP']

/**
 * POST /api/geodae/writeback
 * Corps : { account, synchroteam_id, serial_number, gid, dryRun? }
 * Reporte l'identifiant Géo'DAE validé par l'utilisateur dans le champ
 * personnalisé de l'équipement Synchroteam, puis trace le report (migration 11)
 * et clôt les anomalies ouvertes du DAE. Seule écriture vers Synchroteam.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res

  let body: Partial<WritebackRequest> & { dryRun?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const valid =
    typeof body.account === 'string' && ACCOUNTS.includes(body.account) &&
    typeof body.synchroteam_id === 'string' && body.synchroteam_id.length > 0 && body.synchroteam_id.length <= 64 &&
    typeof body.gid === 'string' && body.gid.trim().length > 0 && body.gid.length <= 64 &&
    (body.serial_number == null || (typeof body.serial_number === 'string' && body.serial_number.length <= 128))
  if (!valid) return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })

  const request: WritebackRequest = {
    account: body.account as WritebackRequest['account'],
    synchroteam_id: body.synchroteam_id as string,
    serial_number: (body.serial_number as string | null | undefined) ?? null,
    gid: (body.gid as string).trim(),
  }
  const dryRun = body.dryRun === true

  try {
    const { mappings } = await loadDbMappings()
    const result = await writeGeoDaeId(request, mappings, { dryRun })
    if (dryRun) return NextResponse.json(result)

    // Trace + clôture des anomalies, même en cas d'échec (on garde l'erreur)
    const journal = await recordWriteback({ request, result, writtenBy: auth.who })
    // La copie locale vient de changer : la prochaine lecture repart de la base
    if (result.ok) invalidateExtractCache()
    return NextResponse.json({ ...result, journal }, { status: result.ok ? 200 : 409 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
