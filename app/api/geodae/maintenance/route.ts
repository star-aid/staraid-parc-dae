import { NextRequest, NextResponse } from 'next/server'
import { authorizeGeodae } from '@/lib/geodae/route-auth'
import { loadDbMappings } from '@/lib/geodae/mappings'
import { compareMaintenance, invalidateMaintenanceCache } from '@/lib/geodae/maintenance'
import { writeMaintenanceDate } from '@/lib/geodae/writeback'
import { recordMaintenanceWriteback } from '@/lib/geodae/journal'
import { maintenanceToCsv, type MaintenanceWriteRequest } from '@/lib/geodae/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACCOUNTS = ['REU', 'MYT', 'GLP']

/**
 * GET /api/geodae/maintenance[?fresh=1][&format=csv&tolerance=30]
 * Comparaison des dates de dernière maintenance Synchroteam ↔ Géo'DAE pour les
 * DAE en location appariés. Lecture seule ; réservé aux rôles administrateur et
 * maintenance, comme la page.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res
  const p = req.nextUrl.searchParams
  try {
    const result = await compareMaintenance({ fresh: p.get('fresh') === '1' })
    if (p.get('format') === 'csv') {
      const tolerance = Math.max(0, parseInt(p.get('tolerance') ?? '30', 10) || 30)
      return new NextResponse(maintenanceToCsv(result.rows, tolerance), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="geodae-maintenance-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}

/**
 * POST /api/geodae/maintenance
 * Corps : { account, synchroteam_id, serial_number, date, dryRun? }
 * Écrit la date de dernière maintenance (yyyy-mm-dd) dans le champ personnalisé
 * « Date dernière maintenance » de l'équipement Synchroteam, après validation
 * par l'utilisateur, puis trace le report (migration 014).
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeGeodae()
  if (!auth.ok) return auth.res

  let body: Partial<MaintenanceWriteRequest> & { dryRun?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const valid =
    typeof body.account === 'string' && ACCOUNTS.includes(body.account) &&
    typeof body.synchroteam_id === 'string' && body.synchroteam_id.length > 0 && body.synchroteam_id.length <= 64 &&
    typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) &&
    (body.serial_number == null || (typeof body.serial_number === 'string' && body.serial_number.length <= 128))
  if (!valid) return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })

  const request: MaintenanceWriteRequest = {
    account: body.account as MaintenanceWriteRequest['account'],
    synchroteam_id: body.synchroteam_id as string,
    serial_number: (body.serial_number as string | null | undefined) ?? null,
    date: body.date as string,
  }
  const dryRun = body.dryRun === true

  try {
    const { mappings } = await loadDbMappings()
    const result = await writeMaintenanceDate(request, mappings, { dryRun })
    if (dryRun) return NextResponse.json(result)
    const journal = await recordMaintenanceWriteback({ request, result, writtenBy: auth.who })
    if (result.ok) invalidateMaintenanceCache()
    return NextResponse.json({ ...result, journal }, { status: result.ok ? 200 : 409 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
