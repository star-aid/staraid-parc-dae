import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // TODO: implémenter le pipeline de sync Synchroteam
  // Ordre : customfields → clients → sites → techniciens → équipements → contrats → interventions → statuts

  return NextResponse.json({ message: 'Sync Synchroteam — à implémenter' })
}
