import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  // TODO: implémenter le streaming SSE avec Claude Sonnet
  // 1. Récupérer le message utilisateur
  // 2. Construire le contexte parc depuis Supabase (buildParkSummary)
  // 3. Streamer la réponse Claude via ReadableStream

  const { message } = await req.json() as { message: string }

  return NextResponse.json({
    reply: `Route IA active. Message reçu : "${message}" — implémentation streaming SSE à venir.`,
  })
}
