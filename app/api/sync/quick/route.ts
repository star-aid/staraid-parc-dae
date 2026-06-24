import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createSynchroteamClient } from '@/lib/synchroteam'
import { buildAccounts } from '@/lib/sync-territory-route'
import { runGlobalFinalize } from '@/lib/sync-synchroteam'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Sync rapide — interventions incrémentales + recalcul statuts uniquement.
 * Typiquement < 10s. Utilisée par le bouton "Synchroniser maintenant".
 * Ne synce pas les clients / sites / équipements / contrats (full sync = script local ou cron quotidien).
 */
export async function GET() {
  const supabase = createServiceClient()

  const { data: logEntry } = await supabase
    .from('sync_logs')
    .insert({ source: 'synchroteam_quick', status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single()
  const logId: string | null = logEntry?.id ?? null

  const territories = (['REU', 'GLP', 'MYT'] as const)
  const errors: string[] = []
  let totalInterventions = 0

  // Construire les ID maps nécessaires aux interventions (une seule fois)
  const { data: daeRows } = await supabase.from('defibrillators').select('id, synchroteam_id')
  const { data: siteRows } = await supabase.from('sites').select('id, synchroteam_id')
  const { data: clientRows } = await supabase.from('clients').select('id, synchroteam_id')

  const daeMap    = new Map((daeRows ?? []).map((r: { id: string; synchroteam_id: string }) => [r.synchroteam_id, r.id]))
  const siteMap   = new Map((siteRows ?? []).map((r: { id: string; synchroteam_id: string }) => [r.synchroteam_id, r.id]))
  const clientMap = new Map((clientRows ?? []).map((r: { id: string; synchroteam_id: string }) => [r.synchroteam_id, r.id]))

  // Sync incrémentale des interventions pour chaque territoire
  await Promise.allSettled(
    territories.map(async (code) => {
      const acc = buildAccounts(code)
      if (!acc) return

      const logSource = `synchroteam_${code.toLowerCase()}`

      // Dernière sync réussie pour ce territoire
      const { data: lastRow } = await supabase
        .from('sync_logs')
        .select('finished_at')
        .eq('source', logSource)
        .eq('status', 'success')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let sinceDate: Date | undefined
      if (lastRow?.finished_at) {
        sinceDate = new Date(lastRow.finished_at)
        sinceDate.setMinutes(sinceDate.getMinutes() - 30)
      }

      const since = sinceDate ?? (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d })()
      const dateFrom = since.toISOString().split('T')[0]

      const apiClient = createSynchroteamClient(acc.domain, acc.key)

      try {
        const jobs = await apiClient.fetchJobs({ dateFrom })

        type JobRow = {
          synchroteam_id: string
          defibrillator_id: string | null
          site_id: string | null
          client_id: string | null
          type: string
          status: string
          scheduled_date: string | null
          completed_date: string | null
          technician_name: string | null
          technician_synchroteam_id: string | null
          duration_minutes: number | null
          report: string | null
          custom_fields: null
        }

        const rows: JobRow[] = jobs
          .map((j) => {
            const equipment   = j.equipment   as Record<string, unknown> | null
            const site        = j.site        as Record<string, unknown> | null
            const customer    = j.customer    as Record<string, unknown> | null
            const technician  = (j.technician ?? j.user) as Record<string, unknown> | null
            const typeObj     = j.type as Record<string, unknown> | null

            const p = acc.idPrefix
            const equipSyncId    = equipment?.id ? `${p}${String(equipment.id)}` : null
            const siteSyncId     = site?.id ? `${p}${String(site.id)}` : null
            const customerSyncId = customer?.id ? `${p}${String(customer.id)}` : null

            const g = (o: Record<string, unknown> | null | undefined, ...keys: string[]) => {
              if (!o) return null
              for (const k of keys) { const v = o[k]; if (v != null && v !== '') return v }
              return null
            }
            const str = (v: unknown) => { if (v == null) return null; const s = String(v).trim(); return s || null }
            const pts = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d.toISOString() }

            const mapType = (raw: unknown) => {
              const s = str(raw)?.toLowerCase() ?? ''
              if (s.includes('maintenance') || s.includes('préventif')) return 'maintenance'
              if (s.includes('dépannage') || s.includes('depannage') || s.includes('repair')) return 'depannage'
              if (s.includes('installation')) return 'installation'
              return 'autre'
            }
            const mapStatus = (raw: unknown) => {
              const s = str(raw)?.toLowerCase() ?? ''
              if (['validated','done','completed','terminé','termine','closed'].some(v => s.includes(v))) return 'termine'
              if (['inprogress','encours','started'].some(v => s.includes(v))) return 'en_cours'
              if (['cancelled','canceled','annulé'].some(v => s.includes(v))) return 'annule'
              return 'planifie'
            }

            const techName = str(g(technician, 'name', 'lastName', 'last_name')) ?? ''

            return {
              synchroteam_id: `${p}${String(j.id)}`,
              defibrillator_id: equipSyncId ? (daeMap.get(equipSyncId) ?? null) : null,
              site_id: siteSyncId ? (siteMap.get(siteSyncId) ?? null) : null,
              client_id: customerSyncId ? (clientMap.get(customerSyncId) ?? null) : null,
              type: mapType(typeObj?.name ?? g(j, 'typeName')),
              status: mapStatus(g(j, 'status', 'jobStatus')),
              scheduled_date: pts(g(j, 'scheduledStart', 'scheduledDate', 'dateStart', 'date')),
              completed_date: pts(g(j, 'actualEnd', 'actualStart', 'completedDate', 'dateEnd')),
              technician_name: techName || null,
              technician_synchroteam_id: technician?.id ? `${p}${String(technician.id)}` : null,
              duration_minutes: (() => { const v = g(j, 'duration', 'durationMinutes'); return v != null ? parseInt(String(v), 10) || null : null })(),
              report: str(g(j, 'report', 'description', 'note')) ?? null,
              custom_fields: null,
            }
          })
          .filter((r) => r.synchroteam_id && r.synchroteam_id !== `${acc.idPrefix}undefined`)

        // Upsert par batch de 50
        for (let i = 0; i < rows.length; i += 50) {
          const { error } = await supabase
            .from('interventions')
            .upsert(rows.slice(i, i + 50), { onConflict: 'synchroteam_id' })
          if (error) errors.push(`[${code}] interventions: ${error.message}`)
          else totalInterventions += Math.min(50, rows.length - i)
        }
      } catch (err) {
        errors.push(`[${code}] fetchJobs: ${String(err)}`)
      }
    })
  )

  // Recalcul statuts pour tous les territoires
  const { statuses_updated, geocoded } = await runGlobalFinalize(supabase, errors)

  const finalStatus = errors.length > 0
    ? (totalInterventions > 0 ? 'partial' : 'error')
    : 'success'

  if (logId) {
    await supabase.from('sync_logs').update({
      status: finalStatus,
      records_synced: totalInterventions + statuses_updated,
      error_message: errors.length > 0 ? errors.slice(0, 5).join('\n') : null,
      finished_at: new Date().toISOString(),
    }).eq('id', logId)
  }

  return NextResponse.json({ status: finalStatus, interventions: totalInterventions, statuses_updated, geocoded, errors })
}
