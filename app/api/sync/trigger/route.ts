import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Proxy côté serveur pour déclencher la sync depuis l'UI sans exposer le CRON_SECRET au client
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const res = await fetch(`${base}/api/sync/synchroteam`, {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
    // La sync prend ~3 min — Next.js route handler n'a pas de limite côté serveur en dev
    signal: AbortSignal.timeout(300_000),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
