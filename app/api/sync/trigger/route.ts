import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createSynchroteamClient } from '@/lib/synchroteam'
import { runSynchroteamSync } from '@/lib/sync-synchroteam'

export const dynamic = 'force-dynamic'
// Timeout max pour les routes Next.js (s'applique aussi aux dev servers)
export const maxDuration = 300

export async function GET() {
  const supabase = createServiceClient()

  // Créer l'entrée de log avec statut 'running' avant de démarrer
  const { data: logEntry } = await supabase
    .from('sync_logs')
    .insert({ source: 'synchroteam', status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single()

  const logId: string | null = logEntry?.id ?? null

  // Lancer la sync en arrière-plan sans bloquer la réponse HTTP.
  // En développement Node.js, le process reste actif le temps que la promesse se règle.
  // Sur Vercel Pro, utiliser waitUntil() de @vercel/functions pour garantir la complétion.
  ;(async () => {
    try {
      const accounts = []
      if (process.env.SYNCHROTEAM_DOMAIN && process.env.SYNCHROTEAM_API_KEY) {
        accounts.push({ client: createSynchroteamClient(process.env.SYNCHROTEAM_DOMAIN, process.env.SYNCHROTEAM_API_KEY), idPrefix: '', forcedTerritoryCode: null })
      }
      if (process.env.SYNCHROTEAM_DOMAIN_GLP && process.env.SYNCHROTEAM_API_KEY_GLP) {
        accounts.push({ client: createSynchroteamClient(process.env.SYNCHROTEAM_DOMAIN_GLP, process.env.SYNCHROTEAM_API_KEY_GLP), idPrefix: 'GLP_', forcedTerritoryCode: 'GLP' })
      }
      if (process.env.SYNCHROTEAM_DOMAIN_MYT && process.env.SYNCHROTEAM_API_KEY_MYT) {
        accounts.push({ client: createSynchroteamClient(process.env.SYNCHROTEAM_DOMAIN_MYT, process.env.SYNCHROTEAM_API_KEY_MYT), idPrefix: 'MYT_', forcedTerritoryCode: 'MYT' })
      }
      const result = await runSynchroteamSync(supabase, accounts)

      const totalSynced =
        result.clients + result.sites + result.technicians +
        result.equipments + result.interventions

      const finalStatus = result.errors.length > 0 ? 'partial' : 'success'

      if (logId) {
        await supabase
          .from('sync_logs')
          .update({
            status: finalStatus,
            records_synced: totalSynced,
            error_message: result.errors.length > 0
              ? result.errors.slice(0, 10).join('\n')
              : null,
            finished_at: new Date().toISOString(),
          })
          .eq('id', logId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (logId) {
        await supabase
          .from('sync_logs')
          .update({
            status: 'error',
            error_message: message,
            finished_at: new Date().toISOString(),
          })
          .eq('id', logId)
      }
    }
  })()

  // Répondre immédiatement — le client poll /api/sync/status?id=logId
  return NextResponse.json({ status: 'started', logId })
}
