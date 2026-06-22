import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // TODO: implémenter la sync Axonaut → enrichissement clients/contrats

  return NextResponse.json({ message: 'Sync Axonaut — à implémenter' })
}
