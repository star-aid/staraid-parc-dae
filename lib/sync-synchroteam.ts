import type { SupabaseClient } from '@supabase/supabase-js'
import type { SynchroteamClient } from '@/lib/synchroteam'
import { extractCustomFields } from '@/lib/synchroteam'
import { computeDAEStatus, computeConsumableStatus, detectTerritory, computeExpiryDates } from '@/lib/status'
import { geocodeAddress } from '@/lib/geocoding'
import type { CustomFieldMapping } from '@/types'

export type SyncResult = {
  clients: number
  sites: number
  technicians: number
  equipments: number
  contracts: number
  interventions: number
  statuses_updated: number
  geocoded: number
  errors: string[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function g(obj: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  if (obj == null) return null
  for (const k of keys) {
    const v = obj[k]
    if (v != null && v !== '') return v
  }
  return null
}

function str(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

function parseDate(val: unknown): string | null {
  if (val == null) return null
  const raw = String(val).trim()
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}

function parseTimestamp(val: unknown): string | null {
  if (val == null) return null
  const raw = String(val).trim()
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

function parseBool(val: unknown): boolean | null {
  if (val == null) return null
  if (typeof val === 'boolean') return val
  const s = String(val).toLowerCase().trim()
  if (s === '1' || s === 'true' || s === 'oui') return true
  if (s === '0' || s === 'false' || s === 'non') return false
  return null
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

function parseBrandModel(val: string | null): { brand: string | null; model: string | null } {
  if (!val) return { brand: null, model: null }
  const sep = val.indexOf(' - ')
  if (sep > 0) return { brand: val.slice(0, sep).trim(), model: val.slice(sep + 3).trim() }
  return { brand: null, model: val.trim() }
}

function mapJobType(raw: unknown): 'maintenance' | 'depannage' | 'installation' | 'autre' {
  const s = str(raw)?.toLowerCase() ?? ''
  if (s.includes('maintenance') || s.includes('préventif') || s.includes('preventif')) return 'maintenance'
  if (s.includes('dépannage') || s.includes('depannage') || s.includes('repair') || s.includes('curatif')) return 'depannage'
  if (s.includes('installation') || s.includes('pose') || s.includes('install')) return 'installation'
  return 'autre'
}

function mapJobStatus(raw: unknown): 'planifie' | 'en_cours' | 'termine' | 'annule' {
  const s = str(raw)?.toLowerCase() ?? ''
  if (['validated', 'done', 'completed', 'finished', 'terminé', 'termine', 'closed'].some((v) => s.includes(v))) return 'termine'
  if (['inprogress', 'in_progress', 'encours', 'started', 'working'].some((v) => s.includes(v))) return 'en_cours'
  if (['cancelled', 'canceled', 'annulé', 'annule'].some((v) => s.includes(v))) return 'annule'
  return 'planifie'
}

async function buildIdMap(supabase: SupabaseClient, table: string): Promise<Map<string, string>> {
  const { data } = await supabase.from(table).select('id, synchroteam_id')
  return new Map((data ?? []).map((r: { id: string; synchroteam_id: string }) => [r.synchroteam_id, r.id]))
}

// ─── Étape 1 : Clients ───────────────────────────────────────────────────────

async function syncClients(
  client: SynchroteamClient,
  supabase: SupabaseClient,
  territoryMap: Map<string, string>,
  idPrefix: string,
  forcedTerritoryCode: string | null,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const customers = await client.fetchCustomers()
    const now = new Date().toISOString()

    const rows = customers.map((c) => {
      const addressParts = [str(g(c, 'addressStreet')), str(g(c, 'addressCity'))].filter(Boolean)
      const address = str(g(c, 'address')) ?? addressParts.join(', ') ?? null
      const city = str(g(c, 'addressCity')) ?? null
      const country = str(g(c, 'addressCountry')) ?? ''
      const territory_code = forcedTerritoryCode ?? detectTerritory([address ?? '', city ?? '', country].join(' '))

      return {
        synchroteam_id: `${idPrefix}${String(c.id)}`,
        name: str(g(c, 'name')) ?? 'Sans nom',
        address,
        city,
        territory_id: territoryMap.get(territory_code) ?? null,
        contact_email: str(g(c, 'contactEmail')) ?? null,
        contact_phone: str(g(c, 'contactPhone', 'contactMobile')) ?? null,
        tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
        active: Boolean(c.active),
        synced_at: now,
      }
    })

    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('clients').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`[${idPrefix||'REU'}] clients upsert: ${error.message}`)
      else total += batch.length
    }
  } catch (err) {
    errors.push(`[${idPrefix||'REU'}] clients fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 2 : Sites ─────────────────────────────────────────────────────────

async function syncSites(
  client: SynchroteamClient,
  supabase: SupabaseClient,
  clientMap: Map<string, string>,
  territoryMap: Map<string, string>,
  idPrefix: string,
  forcedTerritoryCode: string | null,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const sites = await client.fetchSites()
    const now = new Date().toISOString()

    const rows = sites.map((s) => {
      const customer = s.customer as Record<string, unknown> | null
      const client_id = customer?.id ? (clientMap.get(`${idPrefix}${String(customer.id)}`) ?? null) : null

      const address = str(g(s, 'address', 'addressStreet')) ?? null
      const city = str(g(s, 'city', 'addressCity')) ?? null
      const country = str(g(s, 'addressCountry')) ?? ''
      const territory_code = forcedTerritoryCode ?? detectTerritory([address ?? '', city ?? '', country].join(' '))

      const position = (s.position ?? s.Position) as Record<string, unknown> | null
      const latitude = position?.latitude ? parseFloat(String(position.latitude)) : null
      const longitude = position?.longitude ? parseFloat(String(position.longitude)) : null

      return {
        synchroteam_id: `${idPrefix}${String(s.id)}`,
        client_id,
        name: str(g(s, 'name')) ?? 'Site sans nom',
        address,
        city,
        territory_id: territoryMap.get(territory_code) ?? null,
        latitude: latitude && !isNaN(latitude) ? latitude : null,
        longitude: longitude && !isNaN(longitude) ? longitude : null,
        active: Boolean(s.active),
        synced_at: now,
      }
    })

    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('sites').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`[${idPrefix||'REU'}] sites upsert: ${error.message}`)
      else total += batch.length
    }
  } catch (err) {
    errors.push(`[${idPrefix||'REU'}] sites fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 3 : Techniciens ──────────────────────────────────────────────────

async function syncTechnicians(
  client: SynchroteamClient,
  supabase: SupabaseClient,
  idPrefix: string,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const users = await client.fetchUsers()
    const now = new Date().toISOString()

    const rows = users.map((u) => ({
      synchroteam_id: `${idPrefix}${String(u.id)}`,
      first_name: str(g(u, 'firstName', 'first_name')) ?? null,
      last_name: str(g(u, 'lastName', 'last_name', 'name')) ?? null,
      login: str(g(u, 'login', 'username')) ?? null,
      email: str(g(u, 'email')) ?? null,
      active: u.active !== false,
      synced_at: now,
    }))

    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('technicians').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`[${idPrefix||'REU'}] technicians upsert: ${error.message}`)
      else total += batch.length
    }
  } catch (err) {
    errors.push(`[${idPrefix||'REU'}] technicians fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 4 : Équipements (DAE) ────────────────────────────────────────────

async function syncEquipments(
  apiClient: SynchroteamClient,
  supabase: SupabaseClient,
  clientMap: Map<string, string>,
  siteMap: Map<string, string>,
  siteClientMap: Map<string, string>,
  territoryMap: Map<string, string>,
  mappings: CustomFieldMapping[],
  idPrefix: string,
  forcedTerritoryCode: string | null,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const equipments = await apiClient.fetchEquipments()
    const now = new Date().toISOString()

    const rows = equipments.map((eq) => {
      const customer = eq.customer as Record<string, unknown> | null
      const site = eq.site as Record<string, unknown> | null
      const site_id = site?.id ? (siteMap.get(`${idPrefix}${String(site.id)}`) ?? null) : null

      const client_id = customer?.id
        ? (clientMap.get(`${idPrefix}${String(customer.id)}`) ?? null)
        : (site?.id ? (siteClientMap.get(`${idPrefix}${String(site.id)}`) ?? null) : null)

      const cf = extractCustomFields(eq, mappings)
      const { brand, model } = parseBrandModel(cf.model ?? null)

      // Territoire : forcé si compte GLP/MYT, sinon détection via zone_géographique
      const zone = cf.zone_geographique ?? null
      const territory_code = forcedTerritoryCode ?? detectTerritory('', zone)
      const territory_id = territoryMap.get(territory_code) ?? null

      const kitRcp = parseBool(cf.kit_rcp)
      const registre = parseBool(cf.registre_star_aid)

      const battery_install_date = parseDate(cf.battery_install_date ?? cf.battery_expiry)

      const expiry = computeExpiryDates({
        brand: str(cf.model) ?? null,
        battery_install_date,
        raw_electrodes_adult: parseDate(cf.electrodes_adult_expiry),
        raw_electrodes_pediatric: parseDate(cf.electrodes_pediatric_expiry),
      })

      return {
        synchroteam_id: `${idPrefix}${String(eq.id)}`,
        client_id,
        site_id,
        territory_id,
        serial_number: str(cf.serial_number) ?? null,
        model,
        brand,
        manufacture_date: parseDate(cf.manufacture_date),
        battery_install_date,
        battery_expiry: expiry.battery_expiry,
        electrodes_adult_expiry: expiry.electrodes_adult_expiry,
        electrodes_pediatric_expiry: expiry.electrodes_pediatric_expiry,
        location_detail: str(cf.location_detail) ?? null,
        cabinet_code: str(cf.cabinet_code) ?? null,
        zone_geographique: zone,
        geo_dae_id: str(cf.geo_dae_id) ?? null,
        contract_type: str(cf.contract_type) ?? null,
        contract_start: parseDate(cf.contract_start),
        contract_end: parseDate(cf.contract_end),
        kit_rcp: kitRcp,
        loan_serial_number: str(cf.loan_serial_number) ?? null,
        registre_star_aid: registre,
        notes: str(cf.notes) ?? null,
        custom_fields: cf as Record<string, unknown>,
        active: eq.active !== false,
        synced_at: now,
      }
    })

    const ELECTRODE_COLS = ['electrodes_adult_expiry', 'electrodes_pediatric_expiry', 'battery_install_date']

    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('defibrillators').upsert(batch, { onConflict: 'synchroteam_id' })

      if (!error) { total += batch.length; continue }

      if (error.message.includes('Could not find')) {
        const stripped = batch.map((r) => {
          const copy = { ...r } as Record<string, unknown>
          for (const col of ELECTRODE_COLS) delete copy[col]
          return copy
        })
        const { error: e2 } = await supabase.from('defibrillators').upsert(stripped, { onConflict: 'synchroteam_id' })
        if (e2) errors.push(`[${idPrefix||'REU'}] defibrillators fallback: ${e2.message}`)
        else total += batch.length
      } else {
        errors.push(`[${idPrefix||'REU'}] defibrillators upsert: ${error.message}`)
      }
    }
  } catch (err) {
    errors.push(`[${idPrefix||'REU'}] equipments fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 5 : Contrats (enrichissement) ────────────────────────────────────

async function syncContracts(
  apiClient: SynchroteamClient,
  supabase: SupabaseClient,
  daeMap: Map<string, string>,
  idPrefix: string,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const contracts = await apiClient.fetchContracts()

    const updates: Array<{ id: string; contract_type: string | null; contract_start: string | null; contract_end: string | null }> = []

    for (const c of contracts) {
      const equipment = c.equipment as Record<string, unknown> | null
      const equipId = equipment?.id ? `${idPrefix}${String(equipment.id)}` : null
      if (!equipId) continue

      const daeId = daeMap.get(equipId)
      if (!daeId) continue

      const contractType = str(g(c, 'type', 'contractType', 'typeName')) ?? null
      const startDate = parseDate(g(c, 'startDate', 'beginDate', 'dateStart', 'start'))
      const endDate = parseDate(g(c, 'endDate', 'finishDate', 'dateEnd', 'end', 'expiryDate'))

      if (contractType || startDate || endDate) {
        updates.push({ id: daeId, contract_type: contractType, contract_start: startDate, contract_end: endDate })
      }
    }

    for (const batch of chunk(updates, 50)) {
      for (const upd of batch) {
        const { error } = await supabase
          .from('defibrillators')
          .update({ contract_type: upd.contract_type, contract_start: upd.contract_start, contract_end: upd.contract_end })
          .eq('id', upd.id)
          .is('contract_type', null)
        if (error) errors.push(`[${idPrefix||'REU'}] contracts update: ${error.message}`)
        else total++
      }
    }
  } catch (err) {
    errors.push(`[${idPrefix||'REU'}] contracts fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 6 : Interventions ─────────────────────────────────────────────────

async function syncInterventions(
  apiClient: SynchroteamClient,
  supabase: SupabaseClient,
  daeMap: Map<string, string>,
  siteMap: Map<string, string>,
  clientMap: Map<string, string>,
  idPrefix: string,
  errors: string[],
  sinceDate?: Date
): Promise<number> {
  let total = 0
  try {
    const since = sinceDate ?? (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d })()
    const dateFrom = since.toISOString().split('T')[0]

    const jobs = await apiClient.fetchJobs({ dateFrom })

    const rows = jobs
      .map((j) => {
        const equipment   = j.equipment   as Record<string, unknown> | null
        const site        = j.site        as Record<string, unknown> | null
        const customer    = j.customer    as Record<string, unknown> | null
        const technician  = (j.technician ?? j.user) as Record<string, unknown> | null
        const typeObj     = j.type as Record<string, unknown> | null

        const equipSyncId    = equipment?.id ? `${idPrefix}${String(equipment.id)}` : null
        const siteSyncId     = site?.id ? `${idPrefix}${String(site.id)}` : null
        const customerSyncId = customer?.id ? `${idPrefix}${String(customer.id)}` : null

        const scheduledRaw = g(j, 'scheduledStart', 'scheduledDate', 'dateStart', 'date')
        const completedRaw = g(j, 'actualEnd', 'actualStart', 'completedDate', 'dateEnd')
        const durationRaw  = g(j, 'duration', 'durationMinutes')
        const techName = str(g(technician, 'name', 'lastName', 'last_name')) ?? ''

        return {
          synchroteam_id: `${idPrefix}${String(j.id)}`,
          defibrillator_id: equipSyncId ? (daeMap.get(equipSyncId) ?? null) : null,
          site_id: siteSyncId ? (siteMap.get(siteSyncId) ?? null) : null,
          client_id: customerSyncId ? (clientMap.get(customerSyncId) ?? null) : null,
          type: mapJobType(typeObj?.name ?? g(j, 'typeName')),
          status: mapJobStatus(g(j, 'status', 'jobStatus')),
          scheduled_date: parseTimestamp(scheduledRaw),
          completed_date: parseTimestamp(completedRaw),
          technician_name: techName || null,
          technician_synchroteam_id: technician?.id ? `${idPrefix}${String(technician.id)}` : null,
          duration_minutes: durationRaw != null ? parseInt(String(durationRaw), 10) || null : null,
          report: str(g(j, 'report', 'description', 'note')) ?? null,
          custom_fields: null,
        }
      })
      .filter((r) => r.synchroteam_id && r.synchroteam_id !== `${idPrefix}undefined`)

    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('interventions').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`[${idPrefix||'REU'}] interventions upsert: ${error.message}`)
      else total += batch.length
    }
  } catch (err) {
    errors.push(`[${idPrefix||'REU'}] interventions fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 7 : Mise à jour last_maintenance_date ─────────────────────────────

async function updateLastMaintenanceDates(
  supabase: SupabaseClient,
  errors: string[]
): Promise<void> {
  try {
    const { data: completed, error } = await supabase
      .from('interventions')
      .select('defibrillator_id, completed_date')
      .eq('type', 'maintenance')
      .eq('status', 'termine')
      .not('defibrillator_id', 'is', null)
      .not('completed_date', 'is', null)
      .order('completed_date', { ascending: false })

    if (error || !completed?.length) return

    const lastByDae = new Map<string, string>()
    for (const row of completed as Array<{ defibrillator_id: string; completed_date: string }>) {
      if (!lastByDae.has(row.defibrillator_id)) {
        lastByDae.set(row.defibrillator_id, row.completed_date.split('T')[0])
      }
    }

    const updates = Array.from(lastByDae.entries())
    for (const batch of chunk(updates, 20)) {
      await Promise.all(
        batch.map(([id, date]) =>
          supabase.from('defibrillators').update({ last_maintenance_date: date }).eq('id', id)
        )
      )
    }
  } catch (err) {
    errors.push(`last_maintenance_date: ${String(err)}`)
  }
}

// ─── Étape 8 : Calcul des statuts ────────────────────────────────────────────

type DaeRow = {
  id: string
  next_maintenance_date: string | null
  battery_expiry: string | null
  electrodes_adult_expiry: string | null
  electrodes_pediatric_expiry: string | null
}

async function calculateStatuses(
  supabase: SupabaseClient,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const PAGE = 1000
    const allDaes: DaeRow[] = []

    for (let page = 0; ; page++) {
      let { data: batch, error } = await supabase
        .from('defibrillators')
        .select('id, next_maintenance_date, battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry')
        .eq('active', true)
        .range(page * PAGE, (page + 1) * PAGE - 1)

      if (error?.message.includes('Could not find')) {
        const fb = await supabase
          .from('defibrillators')
          .select('id, next_maintenance_date, battery_expiry')
          .eq('active', true)
          .range(page * PAGE, (page + 1) * PAGE - 1)
        batch = (fb.data ?? []).map((d) => ({ ...d, electrodes_adult_expiry: null, electrodes_pediatric_expiry: null }))
        error = fb.error
      }
      if (error) { errors.push(`calculateStatuses SELECT p${page}: ${error.message}`); break }
      if (!batch?.length) break
      allDaes.push(...(batch as DaeRow[]))
      if (batch.length < PAGE) break
    }

    if (!allDaes.length) return 0

    const ORDER = ['expire', 'a_remplacer', 'ok', 'inconnu']
    const updates = allDaes.map((dae) => {
      const { status, reason } = computeDAEStatus(dae)
      const battery_status = computeConsumableStatus(dae.battery_expiry)
      const ea = computeConsumableStatus(dae.electrodes_adult_expiry)
      const ep = computeConsumableStatus(dae.electrodes_pediatric_expiry)
      const electrodes_status = ORDER.indexOf(ea) <= ORDER.indexOf(ep) ? ea : ep
      return { id: dae.id, status, status_reason: reason, battery_status, electrodes_status, updated_at: new Date().toISOString() }
    })

    // Un seul UPSERT groupé par batch de 500 au lieu de N UPDATE individuels
    for (const batch of chunk(updates, 500)) {
      const { error } = await supabase
        .from('defibrillators')
        .upsert(batch, { onConflict: 'id' })
      if (error) errors.push(`calculateStatuses upsert: ${error.message}`)
      else total += batch.length
    }
  } catch (err) {
    errors.push(`calculateStatuses: ${String(err)}`)
  }
  return total
}

// ─── Étape 9 : Géocodage fallback ────────────────────────────────────────────

async function geocodeMissingSites(
  supabase: SupabaseClient,
  errors: string[],
  limit = 15
): Promise<number> {
  let total = 0
  try {
    const { data: sites, error } = await supabase
      .from('sites')
      .select('id, name, address, city, territories(code)')
      .is('latitude', null)
      .eq('active', true)
      .limit(limit)

    if (error || !sites?.length) return 0

    type SiteRow = { id: string; name: string; address: string | null; city: string | null; territories: { code: string }[] | null }
    for (const site of sites as unknown as SiteRow[]) {
      const tCode = Array.isArray(site.territories) ? site.territories[0]?.code : (site.territories as { code?: string } | null)?.code
      const territoryHint = tCode === 'GLP' ? 'Guadeloupe' : tCode === 'MYT' ? 'Mayotte' : 'La Réunion'
      const query = [site.address, site.city, territoryHint].filter(Boolean).join(', ')
      const coords = await geocodeAddress(query)
      if (!coords) continue

      const { error: upErr } = await supabase
        .from('sites')
        .update({ latitude: coords.lat, longitude: coords.lng })
        .eq('id', site.id)

      if (upErr) errors.push(`geocode site ${site.id}: ${upErr.message}`)
      else total++
    }
  } catch (err) {
    errors.push(`geocodeMissingSites: ${String(err)}`)
  }
  return total
}

// ─── Finalisation globale (statuts + géocodage) ──────────────────────────────

export async function runGlobalFinalize(
  supabase: SupabaseClient,
  errors: string[]
): Promise<{ statuses_updated: number; geocoded: number }> {
  await updateLastMaintenanceDates(supabase, errors)
  const statuses_updated = await calculateStatuses(supabase, errors)
  // Limité à 3 sites par sync (rate-limit Nominatim 1 req/s → 3s max)
  const geocoded = await geocodeMissingSites(supabase, errors, 3)
  return { statuses_updated, geocoded }
}

// ─── Pipeline pour un compte Synchroteam ─────────────────────────────────────

export async function runSyncForAccount(
  apiClient: SynchroteamClient,
  supabase: SupabaseClient,
  territoryMap: Map<string, string>,
  mappings: CustomFieldMapping[],
  /**
   * Préfixe ajouté à tous les synchroteam_id pour éviter les collisions inter-comptes.
   * Vide pour le compte REU (données existantes sans préfixe).
   * 'GLP_' pour Guadeloupe, 'MYT_' pour Mayotte.
   */
  idPrefix: string,
  /**
   * Code territoire forcé pour tout ce compte (null = détection automatique via adresse).
   * Passer 'GLP' ou 'MYT' pour les comptes dédiés.
   */
  forcedTerritoryCode: string | null,
  /**
   * Date depuis laquelle filtrer les interventions (sync incrémentale).
   * Si null, toutes les interventions des 12 derniers mois sont récupérées.
   */
  sinceDate?: Date
): Promise<SyncResult> {
  const result: SyncResult = {
    clients: 0, sites: 0, technicians: 0, equipments: 0,
    contracts: 0, interventions: 0, statuses_updated: 0, geocoded: 0, errors: [],
  }

  // 1. Clients
  result.clients = await syncClients(apiClient, supabase, territoryMap, idPrefix, forcedTerritoryCode, result.errors)
  const clientMap = await buildIdMap(supabase, 'clients')

  // 2. Sites
  result.sites = await syncSites(apiClient, supabase, clientMap, territoryMap, idPrefix, forcedTerritoryCode, result.errors)
  const siteMap = await buildIdMap(supabase, 'sites')

  const { data: sitesForClientMap } = await supabase.from('sites').select('synchroteam_id, client_id')
  const siteClientMap = new Map<string, string>(
    ((sitesForClientMap ?? []) as Array<{ synchroteam_id: string; client_id: string | null }>)
      .filter((s) => !!s.client_id)
      .map((s) => [s.synchroteam_id, s.client_id as string])
  )

  // 3. Techniciens
  result.technicians = await syncTechnicians(apiClient, supabase, idPrefix, result.errors)

  // 4. Équipements
  result.equipments = await syncEquipments(apiClient, supabase, clientMap, siteMap, siteClientMap, territoryMap, mappings, idPrefix, forcedTerritoryCode, result.errors)
  const daeMap = await buildIdMap(supabase, 'defibrillators')

  // 5. Contrats
  result.contracts = await syncContracts(apiClient, supabase, daeMap, idPrefix, result.errors)

  // 6. Interventions (incrémentales si sinceDate fourni)
  result.interventions = await syncInterventions(apiClient, supabase, daeMap, siteMap, clientMap, idPrefix, result.errors, sinceDate)

  return result
}

// ─── Pipeline principal (tous comptes) ───────────────────────────────────────

export async function runSynchroteamSync(
  supabase: SupabaseClient,
  clients: Array<{ client: SynchroteamClient; idPrefix: string; forcedTerritoryCode: string | null }>
): Promise<SyncResult> {
  const combined: SyncResult = {
    clients: 0, sites: 0, technicians: 0, equipments: 0,
    contracts: 0, interventions: 0, statuses_updated: 0, geocoded: 0, errors: [],
  }

  const [{ data: territories }, { data: cfMappings }] = await Promise.all([
    supabase.from('territories').select('id, code'),
    supabase.from('custom_field_mapping').select('*'),
  ])

  const territoryMap = new Map(
    (territories ?? []).map((t: { code: string; id: string }) => [t.code, t.id])
  )
  const mappings: CustomFieldMapping[] = (cfMappings ?? []) as CustomFieldMapping[]

  if (!mappings.length) {
    combined.errors.push('Aucun custom field mapping trouvé — lancer /admin/field-mapping/discover')
  }

  // Syncs séquentielles pour respecter les rate limits Synchroteam
  for (const { client, idPrefix, forcedTerritoryCode } of clients) {
    const res = await runSyncForAccount(client, supabase, territoryMap, mappings, idPrefix, forcedTerritoryCode)
    combined.clients += res.clients
    combined.sites += res.sites
    combined.technicians += res.technicians
    combined.equipments += res.equipments
    combined.contracts += res.contracts
    combined.interventions += res.interventions
    combined.errors.push(...res.errors)
  }

  // Étapes globales (après tous les comptes)
  await updateLastMaintenanceDates(supabase, combined.errors)
  combined.statuses_updated = await calculateStatuses(supabase, combined.errors)
  combined.geocoded = await geocodeMissingSites(supabase, combined.errors)

  return combined
}
