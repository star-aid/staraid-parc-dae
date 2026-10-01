// Point 3 du cahier des charges : réconciliation Synchroteam ↔ Géo'DAE sur le
// numéro de série, et alimentation du rapport d'anomalies.
//
// Côté Synchroteam : la copie Supabase (tous les DAE, actifs ou non, pour savoir
// si un DAE Géo'DAE existe « ailleurs » dans Synchroteam).
// Côté Géo'DAE : les fiches visibles par le compte API exploitants (STAR GROUP),
// restreintes au SIREN configuré, avec leur champ num_serie ; quand il est vide, le
// numéro est lu dans le nom déclaré (convention STAR « <site> - <n° série> »).
// L'open data data.gouv.fr n'est plus interrogé depuis le 01/10/2026.
// Rien n'est écrit ni dans Synchroteam ni dans Géo'DAE.
//
// Trois anomalies, celles du cahier des charges :
//   divergence_id             même n° de série, identifiants différents (ou identifiant
//                             Synchroteam inconnu de Géo'DAE alors que la série y est)
//   absent_geodae             DAE actif en location introuvable dans Géo'DAE
//   non_reference_synchroteam DAE Géo'DAE du SIREN absent des DAE actifs en location
// Les anomalies qui ne réapparaissent pas sont clôturées automatiquement.
// Fichier serveur uniquement.

import { createServiceClient } from '@/lib/supabase'
import { isLocationContract } from '@/lib/geodae/extract-synchroteam'
import { splitSynchroteamId } from '@/lib/geodae/extract-supabase'
import { GEODAE_NOT_CONFIGURED, isGeodaeApiConfigured, listGeodaeInventory } from '@/lib/geodae/client'
import { loadPersistedLookups, lookupKey } from '@/lib/geodae/lookups'
import type { AnomalyType, GeodaeInventoryItem } from '@/lib/geodae/types'
import type { TerritoryCode } from '@/types'

export interface ReconcileResult {
  /** DAE Synchroteam actifs en location examinés */
  synchroteam_total: number
  synchroteam_without_serial: number
  /** DAE Géo'DAE du compte exploitant (SIREN configuré) */
  geodae_total: number
  /** … dont numéro de série identifiable (champ num_serie ou nom) */
  geodae_with_serial: number
  /** DAE appariés (identifiant ou numéro de série) */
  matched: number
  divergence: number
  absent: number
  non_reference: number
  /** Anomalies ouvertes clôturées car disparues */
  resolved: number
  run_id: string | null
  persisted: boolean
  reason?: string
  sources: { geodae_api: string }
  duration_ms: number
  dry_run: boolean
  /** En simulation seulement : les anomalies qui auraient été enregistrées */
  preview?: Array<Pick<AnomalyInsert, 'type' | 'account' | 'synchroteam_id' | 'serial_number' | 'synchroteam_geo_dae_id' | 'geodae_gid' | 'details'>>
}

interface SyncRow {
  id: string
  account: TerritoryCode
  synchroteam_id: string
  serial: string | null
  gid: string | null
  active: boolean
  contract_type: string | null
  location: boolean
  /** Nom du site Synchroteam, pour suggérer une correspondance quand le nom Géo'DAE n'a pas de numéro */
  site: string | null
}

interface AnomalyInsert {
  run_id: string | null
  type: AnomalyType
  account: TerritoryCode | null
  synchroteam_id: string | null
  defibrillator_id: string | null
  serial_number: string | null
  synchroteam_geo_dae_id: string | null
  geodae_gid: string | null
  details: Record<string, unknown>
  last_seen_at: string
  resolved_at: null
  resolution: null
}

const RECONCILED_TYPES: AnomalyType[] = ['divergence_id', 'absent_geodae', 'non_reference_synchroteam']
const PAGE = 1000
/** En deçà, un fragment du nom ne peut pas valoir numéro de série */
const MIN_SERIAL_LENGTH = 5

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function upper(v: string | null): string | null {
  return v ? v.toUpperCase() : null
}

/** Même formule que la colonne générée anomaly_key de la table */
function anomalyKey(a: { type: string; account: string | null; synchroteam_id: string | null; geodae_gid: string | null }): string {
  return `${a.type}:${a.account ?? ''}:${a.synchroteam_id ?? a.geodae_gid ?? ''}`
}

/** Tous les DAE de la copie Supabase, actifs ou non, tous contrats confondus. */
async function loadSynchroteamRows(): Promise<SyncRow[]> {
  const supabase = createServiceClient()
  const out: SyncRow[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('defibrillators')
      .select('id, synchroteam_id, serial_number, geo_dae_id, contract_type, active, sites(name)')
      .order('synchroteam_id')
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw new Error(`lecture de la copie Supabase (defibrillators) : ${error.message}`)
    const batch = (data ?? []) as unknown as Array<{ id: string; synchroteam_id: string; serial_number: string | null; geo_dae_id: string | null; contract_type: string | null; active: boolean; sites: { name: string | null } | null }>
    for (const r of batch) {
      const { account, rawId } = splitSynchroteamId(r.synchroteam_id)
      const contractType = str(r.contract_type)
      out.push({
        id: r.id,
        account,
        synchroteam_id: rawId,
        serial: str(r.serial_number),
        gid: str(r.geo_dae_id),
        active: r.active !== false,
        contract_type: contractType,
        location: isLocationContract(contractType),
        site: str(r.sites?.name ?? null),
      })
    }
    if (batch.length < PAGE) break
  }
  return out
}

/**
 * Numéro de série d'un DAE Géo'DAE : le champ num_serie de la fiche s'il est renseigné,
 * sinon le plus long numéro de série Synchroteam contenu dans le nom déclaré
 * (convention STAR « <site> - <n° série> »).
 */
function identifySerial(item: GeodaeInventoryItem, knownSerials: string[]): string | null {
  if (item.num_serie) return item.num_serie.toUpperCase()
  const nom = (item.nom ?? '').toUpperCase()
  if (!nom) return null
  // Le numéro doit être un mot entier du nom (pas un fragment d'un autre numéro)
  let best: string | null = null
  for (const s of knownSerials) {
    if (tokenIndex(nom, s) >= 0 && (!best || s.length > best.length)) best = s
  }
  if (best) return best
  // Repli : même numéro à une confusion de saisie près (l, I et 1 ; O et 0). On renvoie
  // le numéro tel qu'il est écrit dans le nom Géo'DAE, pour que l'écart reste visible.
  const loose = looseSerial(nom)
  for (const s of knownSerials) {
    const idx = tokenIndex(loose, looseSerial(s))
    if (idx >= 0 && (!best || s.length > best.length)) best = nom.substring(idx, idx + s.length)
  }
  return best
}

/**
 * Vrai si la valeur ressemble à un numéro de série : au moins un chiffre, uniquement des
 * lettres, chiffres, tirets et points. Écarte les champs Synchroteam remplis avec un nom
 * de site ou un commentaire, qui feraient rapprocher n'importe quoi.
 */
function looksLikeSerial(s: string): boolean {
  return s.length >= MIN_SERIAL_LENGTH && /\d/.test(s) && /^[A-Z0-9.-]+$/i.test(s)
}

/** Position de `needle` dans `haystack` comme mot entier (bordé par autre chose qu'une lettre ou un chiffre), sinon -1 */
function tokenIndex(haystack: string, needle: string): number {
  let from = 0
  for (;;) {
    const idx = haystack.indexOf(needle, from)
    if (idx < 0) return -1
    const before = idx === 0 ? '' : haystack[idx - 1]
    const after = haystack[idx + needle.length] ?? ''
    if (!/[A-Z0-9]/i.test(before) && !/[A-Z0-9]/i.test(after)) return idx
    from = idx + 1
  }
}

/** Forme « lâche » d'un numéro de série : confusions de saisie l/I/1 et O/0 neutralisées */
function looseSerial(s: string): string {
  return s.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0')
}

/** Clé de comparaison d'un nom de site : sans accents, majuscules, ponctuation réduite à des espaces */
function nameKey(s: string | null): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

export async function reconcileGeodae(opts: { triggeredBy: string; dryRun?: boolean }): Promise<ReconcileResult> {
  const started = Date.now()
  const siren = process.env.GEODAE_SIREN?.trim() || null
  if (!isGeodaeApiConfigured()) throw new Error(`${GEODAE_NOT_CONFIGURED} : impossible de charger l'inventaire Géo'DAE`)
  const sources = { geodae_api: 'ok' }

  const [rows, inventory, persisted] = await Promise.all([
    loadSynchroteamRows(),
    listGeodaeInventory(siren), // sans inventaire, pas de rapprochement : l'erreur remonte
    loadPersistedLookups(),
  ])

  // ── Index Synchroteam ────────────────────────────────────────────────────
  const located = rows.filter((r) => r.active && r.location)
  const rowsBySerial = new Map<string, SyncRow[]>()
  for (const r of rows) {
    const s = upper(r.serial)
    if (s) rowsBySerial.set(s, [...(rowsBySerial.get(s) ?? []), r])
  }
  // Seules les valeurs qui ressemblent à un numéro de série servent à lire les noms Géo'DAE
  const knownSerials = Array.from(rowsBySerial.keys()).filter(looksLikeSerial)
  // DAE en location partageant le même identifiant Géo'DAE (identifiant copié d'une fiche à l'autre)
  const rowsByGid = new Map<string, SyncRow[]>()
  for (const r of located) if (r.gid) rowsByGid.set(r.gid, [...(rowsByGid.get(r.gid) ?? []), r])
  // Tous les DAE (actifs ou non, tout contrat) par identifiant Géo'DAE et par nom de site :
  // pour situer une fiche Géo'DAE dont le nom ne contient pas de numéro de série.
  const allRowsByGid = new Map<string, SyncRow[]>()
  const rowsBySite = new Map<string, SyncRow[]>()
  for (const r of rows) {
    if (r.gid) allRowsByGid.set(r.gid, [...(allRowsByGid.get(r.gid) ?? []), r])
    const k = nameKey(r.site)
    if (k.length >= 4) rowsBySite.set(k, [...(rowsBySite.get(k) ?? []), r])
  }
  const siteKeys = Array.from(rowsBySite.keys())
  /** DAE Synchroteam dont le nom de site est égal au nom Géo'DAE, ou contenu dedans (ou l'inverse) */
  function findBySiteName(nom: string | null): SyncRow[] {
    const k = nameKey(nom)
    if (k.length < 4) return []
    const exact = rowsBySite.get(k)
    if (exact) return exact
    const near = siteKeys.filter((sk) => sk.length >= 6 && (k.includes(sk) || sk.includes(k)))
    return near.length === 1 ? (rowsBySite.get(near[0]) ?? []) : []
  }

  // ── Index Géo'DAE : par identifiant et par numéro de série ────────────────
  const byGid = new Map<string, GeodaeInventoryItem>()
  for (const it of inventory) byGid.set(it.gid, it)
  const serialOf = new Map<string, string | null>()
  const bySerial = new Map<string, GeodaeInventoryItem[]>()
  for (const it of Array.from(byGid.values())) {
    const s = identifySerial(it, knownSerials)
    serialOf.set(it.gid, s)
    if (s) bySerial.set(s, [...(bySerial.get(s) ?? []), it])
  }

  // ── Synchroteam → Géo'DAE ─────────────────────────────────────────────────
  const now = new Date().toISOString()
  const produced: AnomalyInsert[] = []
  const matchedGids = new Set<string>()
  let matched = 0
  let withoutSerial = 0

  const base = (r: SyncRow) => ({
    run_id: null,
    account: r.account,
    synchroteam_id: r.synchroteam_id,
    defibrillator_id: r.id,
    serial_number: r.serial,
    synchroteam_geo_dae_id: r.gid,
    last_seen_at: now,
    resolved_at: null as null,
    resolution: null as null,
  })
  const brief = (it: GeodaeInventoryItem) => ({ gid: it.gid, nom: it.nom, num_serie: it.num_serie, etat_fonct: it.etat_fonct, source: it.source })

  for (const r of located) {
    const serialU = upper(r.serial)
    const sameSerial = serialU ? (bySerial.get(serialU) ?? []) : []
    if (!serialU) withoutSerial++

    if (r.gid) {
      const item = byGid.get(r.gid)
      if (item) {
        matchedGids.add(r.gid)
        matched++
        const itemSerial = serialOf.get(r.gid) ?? null
        if (serialU && itemSerial && itemSerial !== serialU) {
          // Un autre DAE Synchroteam porte le même identifiant ET le numéro déclaré : c'est lui le bon,
          // celui-ci a hérité de l'identifiant par copier-coller et doit avoir le sien.
          const twin = (rowsByGid.get(r.gid) ?? []).find((o) => o !== r && upper(o.serial) === itemSerial)
          // Le numéro déclaré est-il aussi celui d'un autre DAE en location, et réciproquement ? (échange)
          const swapped = !twin && sameSerial.length > 0 && (rowsBySerial.get(itemSerial) ?? []).some((o) => o !== r && o.active && o.location)
          const reason = twin
            ? `identifiant déjà porté dans Synchroteam par le DAE ${twin.serial}, dont le numéro de série correspond à la déclaration Géo'DAE : ce DAE-ci doit recevoir son propre identifiant`
            : looseSerial(itemSerial) === looseSerial(serialU)
              ? "même numéro de série à un caractère ambigu près (l, I et 1 ; O et 0) : corriger la saisie d'un des deux côtés"
              : swapped
                ? `numéros de série croisés entre deux DAE : Géo'DAE déclare ${itemSerial} sous cet identifiant, et ce DAE-ci est déclaré sous ${sameSerial[0].gid}`
                : "le DAE Géo'DAE portant cet identifiant a un autre numéro de série (appareil remplacé ou déclaration à corriger)"
          produced.push({ ...base(r), type: 'divergence_id', geodae_gid: r.gid, details: {
            reason, geodae_serial: itemSerial, geodae: brief(item), same_serial: sameSerial.map(brief),
          } })
        } else if (serialU && !itemSerial && sameSerial.some((x) => x.gid !== r.gid)) {
          produced.push({ ...base(r), type: 'divergence_id', geodae_gid: sameSerial[0].gid, details: {
            reason: "le numéro de série est déclaré sous un autre identifiant Géo'DAE",
            geodae: brief(item), same_serial: sameSerial.map(brief),
          } })
        }
      } else if (sameSerial.length > 0) {
        for (const x of sameSerial) matchedGids.add(x.gid)
        matched++
        produced.push({ ...base(r), type: 'divergence_id', geodae_gid: sameSerial[0].gid, details: {
          reason: "identifiant Synchroteam inconnu de Géo'DAE ; le numéro de série y est déclaré sous un autre identifiant",
          same_serial: sameSerial.map(brief),
        } })
      } else {
        produced.push({ ...base(r), type: 'absent_geodae', geodae_gid: null, details: {
          reason: serialU ? "identifiant Synchroteam inconnu de Géo'DAE et numéro de série introuvable" : "identifiant Synchroteam inconnu de Géo'DAE (pas de numéro de série pour vérifier)",
          sources,
        } })
      }
      continue
    }

    // Sans identifiant dans Synchroteam
    if (sameSerial.length > 0) {
      for (const x of sameSerial) matchedGids.add(x.gid)
      matched++
      continue // trouvé par numéro de série : à reporter depuis la page, pas une anomalie
    }
    const lookup = persisted.byKey.get(lookupKey(r.account, r.synchroteam_id))
    if (lookup?.status === 'trouve' && lookup.geodae_gid) {
      matchedGids.add(lookup.geodae_gid)
      matched++
      continue
    }
    if (serialU) {
      produced.push({ ...base(r), type: 'absent_geodae', geodae_gid: null, details: {
        reason: 'numéro de série introuvable dans Géo\'DAE (défaut de déclaration probable)',
        sources,
        last_lookup: lookup ? { status: lookup.status, checked_at: lookup.checked_at } : null,
      } })
    }
  }

  // ── Géo'DAE → Synchroteam : DAE du compte non référencés ─────────────────
  let geodaeWithSerial = 0
  for (const it of Array.from(byGid.values())) {
    const serial = serialOf.get(it.gid) ?? null
    if (serial) geodaeWithSerial++
    if (matchedGids.has(it.gid)) continue
    if (/supprim/i.test(it.etat_fonct ?? '') || /supprim/i.test(it.etat ?? '')) continue

    // Rattachement par numéro de série, sinon par l'identifiant Géo'DAE renseigné dans Synchroteam
    const bySerialRows = serial ? (rowsBySerial.get(serial) ?? []) : []
    const elsewhere = bySerialRows.length > 0 ? bySerialRows : (allRowsByGid.get(it.gid) ?? [])
    const via = bySerialRows.length > 0 ? '' : ' (identifiant Géo\'DAE renseigné sur la fiche Synchroteam)'
    let hint: string | null = null
    const presence =
      elsewhere.length === 0
        ? (serial
            ? 'absent de Synchroteam'
            : "numéro de série non identifiable dans le nom déclaré : rapprochement impossible, à vérifier à la main (ou compléter le nom de la déclaration Géo'DAE avec le numéro de série)")
        : elsewhere.some((r) => r.active)
          ? `présent dans Synchroteam sous un autre contrat (${Array.from(new Set(elsewhere.filter((r) => r.active).map((r) => r.contract_type ?? 'aucun'))).join(', ')})${via}`
          : `présent dans Synchroteam mais inactif${via}`
    if (elsewhere.length === 0 && !serial) {
      const near = findBySiteName(it.nom)
      if (near.length > 0) {
        const n = near[0]
        hint = `Piste : site Synchroteam « ${n.site} », DAE ${n.serial ?? 'sans n° de série'}, ${n.contract_type ?? 'sans contrat'}, ${n.active ? 'actif' : 'inactif'}${near.length > 1 ? ` (+${near.length - 1} autre${near.length > 2 ? 's' : ''})` : ''}`
      }
    }
    produced.push({
      run_id: null,
      type: 'non_reference_synchroteam',
      account: elsewhere[0]?.account ?? null,
      synchroteam_id: null,
      defibrillator_id: elsewhere[0]?.id ?? null,
      serial_number: serial,
      synchroteam_geo_dae_id: null,
      geodae_gid: it.gid,
      details: {
        presence,
        ...(hint ? { hint } : {}),
        geodae: { ...brief(it), com_nom: it.com_nom, dermnt: it.dermnt, maj_don: it.maj_don },
        synchroteam: elsewhere.map((r) => ({ account: r.account, synchroteam_id: r.synchroteam_id, active: r.active, contract_type: r.contract_type, geo_dae_id: r.gid })),
      },
      last_seen_at: now,
      resolved_at: null,
      resolution: null,
    })
  }

  const counts = {
    divergence: produced.filter((a) => a.type === 'divergence_id').length,
    absent: produced.filter((a) => a.type === 'absent_geodae').length,
    non_reference: produced.filter((a) => a.type === 'non_reference_synchroteam').length,
  }

  const result: ReconcileResult = {
    synchroteam_total: located.length,
    synchroteam_without_serial: withoutSerial,
    geodae_total: byGid.size,
    geodae_with_serial: geodaeWithSerial,
    matched,
    ...counts,
    resolved: 0,
    run_id: null,
    persisted: false,
    sources,
    duration_ms: 0,
    dry_run: opts.dryRun === true,
  }
  if (opts.dryRun) {
    return {
      ...result,
      duration_ms: Date.now() - started,
      preview: produced.map(({ type, account, synchroteam_id, serial_number, synchroteam_geo_dae_id, geodae_gid, details }) =>
        ({ type, account, synchroteam_id, serial_number, synchroteam_geo_dae_id, geodae_gid, details })),
    }
  }

  // ── Persistance : exécution, anomalies, clôtures ─────────────────────────
  const supabase = createServiceClient()
  const { data: run, error: runErr } = await supabase
    .from('geodae_reconciliation_runs')
    .insert({
      triggered_by: opts.triggeredBy,
      scope: `Rapprochement complet · ${located.length} DAE Synchroteam en location · ${byGid.size} DAE Géo'DAE ${siren ? `sous le SIREN ${siren}` : 'du compte exploitant'}`,
      examined: located.length,
      found: matched,
      ambiguous: 0,
      not_found: counts.absent,
      errors: 0,
      sources: { ...sources, ...counts, kind: 'reconcile' },
      started_at: new Date(started).toISOString(),
      finished_at: now,
    })
    .select('id')
    .single()
  if (runErr) {
    return { ...result, reason: `journal (exécution) : ${runErr.message}`, duration_ms: Date.now() - started }
  }
  const runId = (run as { id: string }).id
  for (const a of produced) a.run_id = runId

  for (let i = 0; i < produced.length; i += 200) {
    const { error } = await supabase.from('geodae_anomalies').upsert(produced.slice(i, i + 200), { onConflict: 'anomaly_key' })
    if (error) throw new Error(`journal (anomalies) : ${error.message}`)
  }

  // Clôture des anomalies de ces trois types qui ne sont plus constatées
  const producedKeys = new Set(produced.map(anomalyKey))
  const { data: open, error: openErr } = await supabase
    .from('geodae_anomalies')
    .select('id, type, account, synchroteam_id, geodae_gid')
    .is('resolved_at', null)
    .in('type', RECONCILED_TYPES)
  if (openErr) throw new Error(`journal (lecture) : ${openErr.message}`)
  const gone = ((open ?? []) as Array<{ id: string; type: string; account: string | null; synchroteam_id: string | null; geodae_gid: string | null }>)
    .filter((a) => !producedKeys.has(anomalyKey(a)))
    .map((a) => a.id)
  let resolved = 0
  for (let i = 0; i < gone.length; i += 200) {
    const { error } = await supabase
      .from('geodae_anomalies')
      .update({ resolved_at: now, resolution: `disparue au rapprochement du ${now.slice(0, 10)}` })
      .in('id', gone.slice(i, i + 200))
    if (error) throw new Error(`journal (clôture) : ${error.message}`)
    resolved += Math.min(200, gone.length - i)
  }

  return { ...result, resolved, run_id: runId, persisted: true, duration_ms: Date.now() - started }
}
