// Contrôle automatique Géo'DAE (étape 2 du cahier des charges, brique 3).
//
// À chaque exécution : les DAE actifs en location sans identifiant Géo'DAE sont
// lus dans la copie Supabase, triés par priorité (jamais contrôlés d'abord, puis
// contrôles les plus anciens), et un lot est recherché dans Géo'DAE par n° de
// série. Les résultats vont dans le journal (exécution + anomalies) et dans les
// résultats conservés (geodae_lookups). Le report dans Synchroteam reste une
// action humaine depuis la page.
//
// Dimensionné pour le plan Vercel gratuit : 60 s par appel, d'où un lot borné et
// un budget de temps ; la route s'enchaîne à elle-même tant qu'il reste des DAE.
// Fichier serveur uniquement.

import { createServiceClient } from '@/lib/supabase'
import { LOCATION_TYPES } from '@/lib/contract-groups'
import { lookupGidBySerial } from '@/lib/geodae/client'
import { recordLookupRun } from '@/lib/geodae/journal'
import { loadPersistedLookups, lookupKey } from '@/lib/geodae/lookups'
import { splitSynchroteamId } from '@/lib/geodae/extract-supabase'
import { outcomeOf, sourcesFailureMessage, type JournalItem } from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

export interface CronOptions {
  /** DAE examinés au maximum par exécution */
  batchSize?: number
  /** Temps alloué aux recherches, en ms (marge gardée pour les lectures et écritures) */
  budgetMs?: number
  /** Un DAE déjà contrôlé n'est repris qu'au-delà de ce délai */
  recheckAfterDays?: number
  /** 'cron' ou identifiant de l'utilisateur qui lance un lot à la main */
  triggeredBy?: string
  /** Recherches effectuées mais rien d'enregistré */
  dryRun?: boolean
}

export interface CronResult {
  /** DAE actifs en location sans identifiant et avec n° de série */
  candidates_total: number
  /** … dont à contrôler (jamais contrôlés ou contrôle trop ancien) */
  due: number
  examined: number
  found: number
  ambiguous: number
  not_found: number
  errors: number
  /** DAE à contrôler non traités par ce lot */
  remaining: number
  duration_ms: number
  run_id: string | null
  persisted: boolean
  reason?: string
  lookups_reason?: string
  dry_run: boolean
}

const DEFAULTS = { batchSize: 30, budgetMs: 40_000, recheckAfterDays: 7 }
const PAGE = 1000
const PAUSE_MS = 120

interface Target {
  account: TerritoryCode
  synchroteam_id: string
  serial_number: string
  checked_at: string | null
}

/** DAE actifs, en location, sans identifiant Géo'DAE, avec un n° de série. */
async function loadTargets(): Promise<Omit<Target, 'checked_at'>[]> {
  const supabase = createServiceClient()
  const out: Omit<Target, 'checked_at'>[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('defibrillators')
      .select('synchroteam_id, serial_number')
      .eq('active', true)
      .is('geo_dae_id', null)
      .not('serial_number', 'is', null)
      .in('contract_type', LOCATION_TYPES)
      .order('synchroteam_id')
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw new Error(`lecture des DAE sans identifiant : ${error.message}`)
    const batch = (data ?? []) as Array<{ synchroteam_id: string; serial_number: string | null }>
    for (const r of batch) {
      const serial = (r.serial_number ?? '').trim()
      if (!serial) continue
      const { account, rawId } = splitSynchroteamId(r.synchroteam_id)
      out.push({ account, synchroteam_id: rawId, serial_number: serial })
    }
    if (batch.length < PAGE) break
  }
  return out
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Un lot de contrôle automatique. */
export async function runGeodaeControl(opts: CronOptions = {}): Promise<CronResult> {
  const started = Date.now()
  const { batchSize, budgetMs, recheckAfterDays } = { ...DEFAULTS, ...opts }
  const triggeredBy = opts.triggeredBy ?? 'cron'

  const [targets, persisted] = await Promise.all([loadTargets(), loadPersistedLookups()])

  // Priorité : jamais contrôlés, puis contrôles les plus anciens ; les contrôles récents attendent
  const cutoff = Date.now() - recheckAfterDays * 86_400_000
  const due: Target[] = targets
    .map((t) => ({ ...t, checked_at: persisted.byKey.get(lookupKey(t.account, t.synchroteam_id))?.checked_at ?? null }))
    .filter((t) => !t.checked_at || new Date(t.checked_at).getTime() < cutoff)
    .sort((a, b) => (a.checked_at ?? '').localeCompare(b.checked_at ?? ''))

  const items: JournalItem[] = []
  for (const t of due.slice(0, batchSize)) {
    if (Date.now() - started > budgetMs) break
    const base = { account: t.account, synchroteam_id: t.synchroteam_id, serial_number: t.serial_number, synchroteam_geo_dae_id: null }
    try {
      const result = await lookupGidBySerial(t.serial_number)
      const outcome = outcomeOf(result)
      items.push({
        ...base,
        outcome,
        candidates: result.candidates,
        sources: result.sources,
        error: outcome === 'error' ? sourcesFailureMessage(result) : null,
      })
    } catch (err) {
      items.push({ ...base, outcome: 'error', candidates: [], error: errMsg(err) })
    }
    // Rythme mesuré pour ménager l'API Géo'DAE
    await new Promise((r) => setTimeout(r, PAUSE_MS))
  }

  const counts = {
    examined:  items.length,
    found:     items.filter((i) => i.outcome === 'found').length,
    ambiguous: items.filter((i) => i.outcome === 'ambiguous').length,
    not_found: items.filter((i) => i.outcome === 'not_found').length,
    errors:    items.filter((i) => i.outcome === 'error').length,
  }
  const remaining = due.length - items.length

  let run_id: string | null = null
  let persistedOk = false
  let reason: string | undefined
  let lookups_reason: string | undefined = persisted.reason ?? undefined

  if (!opts.dryRun && items.length > 0) {
    const scope = `Contrôle automatique · ${items.length} DAE · ${remaining} restant${remaining > 1 ? 's' : ''} · ${due.length} à contrôler sur ${targets.length} sans identifiant`
    const rec = await recordLookupRun({ items, triggeredBy, scope, createRun: true })
    run_id = rec.run_id
    persistedOk = rec.persisted
    reason = rec.reason
    lookups_reason = rec.lookups_reason ?? lookups_reason
  }

  return {
    candidates_total: targets.length,
    due: due.length,
    ...counts,
    remaining,
    duration_ms: Date.now() - started,
    run_id,
    persisted: persistedOk,
    ...(reason ? { reason } : {}),
    ...(lookups_reason ? { lookups_reason } : {}),
    dry_run: opts.dryRun === true,
  }
}
