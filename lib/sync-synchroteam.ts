import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchCustomers,
  fetchSites,
  fetchEquipments,
  fetchContracts,
  fetchJobs,
  fetchUsers,
  extractCustomFields,
} from '@/lib/synchroteam'
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

// Normalise une date "YYYY-MM-DD" ou "YYYY-MM-DD HH:MM" → "YYYY-MM-DD"
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

// Synchroteam checkbox → boolean ("1"/"0"/true/false)
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

// "PHILLIPS - HeartStart HS1" → { brand: "PHILLIPS", model: "HeartStart HS1" }
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
  // Synchroteam v3 : statut dominant = "validated" (intervention validée par le technicien)
  if (['validated', 'done', 'completed', 'finished', 'terminé', 'termine', 'closed'].some((v) => s.includes(v))) return 'termine'
  if (['inprogress', 'in_progress', 'encours', 'started', 'working'].some((v) => s.includes(v))) return 'en_cours'
  if (['cancelled', 'canceled', 'annulé', 'annule'].some((v) => s.includes(v))) return 'annule'
  return 'planifie'
}

// Construit une Map synchroteam_id → uuid depuis une table Supabase
async function buildIdMap(supabase: SupabaseClient, table: string): Promise<Map<string, string>> {
  const { data } = await supabase.from(table).select('id, synchroteam_id')
  return new Map((data ?? []).map((r: { id: string; synchroteam_id: string }) => [r.synchroteam_id, r.id]))
}

// ─── Étape 1 : Clients ───────────────────────────────────────────────────────

async function syncClients(
  supabase: SupabaseClient,
  territoryMap: Map<string, string>,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const customers = await fetchCustomers()
    const now = new Date().toISOString()

    const rows = customers.map((c) => {
      const addressParts = [str(g(c, 'addressStreet')), str(g(c, 'addressCity'))].filter(Boolean)
      const address = str(g(c, 'address')) ?? addressParts.join(', ') ?? null
      const city = str(g(c, 'addressCity')) ?? null
      const country = str(g(c, 'addressCountry')) ?? ''
      const territory_code = detectTerritory([address ?? '', city ?? '', country].join(' '))

      return {
        synchroteam_id: String(c.id),
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
      if (error) errors.push(`clients upsert: ${error.message}`)
      else total += batch.length
    }
  } catch (err) {
    errors.push(`clients fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 2 : Sites ─────────────────────────────────────────────────────────

async function syncSites(
  supabase: SupabaseClient,
  clientMap: Map<string, string>,
  territoryMap: Map<string, string>,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const sites = await fetchSites()
    const now = new Date().toISOString()

    const rows = sites.map((s) => {
      const customer = s.customer as Record<string, unknown> | null
      const client_id = customer?.id ? (clientMap.get(String(customer.id)) ?? null) : null

      const address = str(g(s, 'address', 'addressStreet')) ?? null
      const city = str(g(s, 'city', 'addressCity')) ?? null
      const country = str(g(s, 'addressCountry')) ?? ''
      const territory_code = detectTerritory([address ?? '', city ?? '', country].join(' '))

      const position = (s.position ?? s.Position) as Record<string, unknown> | null
      const latitude = position?.latitude ? parseFloat(String(position.latitude)) : null
      const longitude = position?.longitude ? parseFloat(String(position.longitude)) : null

      return {
        synchroteam_id: String(s.id),
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
      if (error) errors.push(`sites upsert: ${error.message}`)
      else total += batch.length
    }
  } catch (err) {
    errors.push(`sites fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 3 : Techniciens ──────────────────────────────────────────────────

async function syncTechnicians(
  supabase: SupabaseClient,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const users = await fetchUsers()
    const now = new Date().toISOString()

    const rows = users.map((u) => ({
      synchroteam_id: String(u.id),
      first_name: str(g(u, 'firstName', 'first_name')) ?? null,
      last_name: str(g(u, 'lastName', 'last_name', 'name')) ?? null,
      login: str(g(u, 'login', 'username')) ?? null,
      email: str(g(u, 'email')) ?? null,
      active: u.active !== false,
      synced_at: now,
    }))

    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('technicians').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`technicians upsert: ${error.message}`)
      else total += batch.length
    }
  } catch (err) {
    errors.push(`technicians fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 4 : Équipements (DAE) ────────────────────────────────────────────

async function syncEquipments(
  supabase: SupabaseClient,
  clientMap: Map<string, string>,
  siteMap: Map<string, string>,
  territoryMap: Map<string, string>,
  mappings: CustomFieldMapping[],
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const equipments = await fetchEquipments()
    const now = new Date().toISOString()

    const rows = equipments.map((eq) => {
      const customer = eq.customer as Record<string, unknown> | null
      const site = eq.site as Record<string, unknown> | null
      const client_id = customer?.id ? (clientMap.get(String(customer.id)) ?? null) : null
      const site_id = site?.id ? (siteMap.get(String(site.id)) ?? null) : null

      // Extraction des custom fields via mapping par ID
      const cf = extractCustomFields(eq, mappings)

      // Marque / modèle — custom field "Marque/modèle" → model
      const { brand, model } = parseBrandModel(cf.model ?? null)

      // Détection territoire via zone_géographique (prioritaire) ou adresse du site
      const zone = cf.zone_geographique ?? null
      const territory_code = detectTerritory('', zone)
      const territory_id = territoryMap.get(territory_code) ?? null

      // Conversion des types selon la sémantique de la colonne
      const kitRcp = parseBool(cf.kit_rcp)
      const registre = parseBool(cf.registre_star_aid)

      // Champ 12575 : date d'INSTALLATION batterie (jamais une DLU)
      // Fallback sur cf.battery_expiry si le mapping Supabase n'a pas encore été mis à jour
      const battery_install_date = parseDate(cf.battery_install_date ?? cf.battery_expiry)

      // Calcul des expirations réelles selon la marque
      const expiry = computeExpiryDates({
        brand: str(cf.model) ?? null,
        battery_install_date,
        raw_electrodes_adult: parseDate(cf.electrodes_adult_expiry),
        raw_electrodes_pediatric: parseDate(cf.electrodes_pediatric_expiry),
      })

      return {
        synchroteam_id: String(eq.id),
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
        // Stocke le brut complet pour traçabilité
        custom_fields: cf as Record<string, unknown>,
        active: eq.active !== false,
        synced_at: now,
      }
    })

    // Colonnes ajoutées progressivement — retenter sans elles si PostgREST ne les connaît pas encore
    const ELECTRODE_COLS = ['electrodes_adult_expiry', 'electrodes_pediatric_expiry', 'battery_install_date']

    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('defibrillators').upsert(batch, { onConflict: 'synchroteam_id' })

      if (!error) { total += batch.length; continue }

      // Fallback : cache PostgREST en retard → retenter sans les colonnes inconnues
      // Les valeurs sont préservées dans custom_fields JSONB
      if (error.message.includes('Could not find')) {
        const stripped = batch.map((r) => {
          const copy = { ...r } as Record<string, unknown>
          for (const col of ELECTRODE_COLS) delete copy[col]
          return copy
        })
        const { error: e2 } = await supabase.from('defibrillators').upsert(stripped, { onConflict: 'synchroteam_id' })
        if (e2) errors.push(`defibrillators fallback: ${e2.message}`)
        else total += batch.length
      } else {
        errors.push(`defibrillators upsert: ${error.message}`)
      }
    }
  } catch (err) {
    errors.push(`equipments fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 5 : Contrats (enrichissement) ────────────────────────────────────

async function syncContracts(
  supabase: SupabaseClient,
  daeMap: Map<string, string>,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    const contracts = await fetchContracts()

    const updates: Array<{ id: string; contract_type: string | null; contract_start: string | null; contract_end: string | null }> = []

    for (const c of contracts) {
      const equipment = c.equipment as Record<string, unknown> | null
      const equipId = equipment?.id ? String(equipment.id) : null
      if (!equipId) continue

      const daeId = daeMap.get(equipId)
      if (!daeId) continue

      // Ne mettre à jour le contrat que si les champs sont renseignés côté Synchroteam
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
          .is('contract_type', null) // uniquement si non déjà renseigné par custom fields
        if (error) errors.push(`contracts update: ${error.message}`)
        else total++
      }
    }
  } catch (err) {
    errors.push(`contracts fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 6 : Interventions ─────────────────────────────────────────────────

async function syncInterventions(
  supabase: SupabaseClient,
  daeMap: Map<string, string>,
  siteMap: Map<string, string>,
  clientMap: Map<string, string>,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    // Fenêtre glissante : 12 derniers mois
    const since = new Date()
    since.setFullYear(since.getFullYear() - 1)
    const dateFrom = since.toISOString().split('T')[0]

    // Paramètre de date : nom exact à valider avec la doc Synchroteam
    const jobs = await fetchJobs({ dateFrom })

    const rows = jobs
      .map((j) => {
        const equipment   = j.equipment   as Record<string, unknown> | null
        const site        = j.site        as Record<string, unknown> | null
        const customer    = j.customer    as Record<string, unknown> | null
        // Synchroteam v3 retourne `technician` (pas `user`) sur les jobs
        const technician  = (j.technician ?? j.user) as Record<string, unknown> | null
        // `type` est un objet {id, name} — on extrait le label pour le mapping
        const typeObj     = j.type as Record<string, unknown> | null

        const equipSyncId    = equipment?.id    ? String(equipment.id)    : null
        const siteSyncId     = site?.id         ? String(site.id)         : null
        const customerSyncId = customer?.id     ? String(customer.id)     : null

        // Synchroteam v3 : scheduledStart / scheduledEnd / actualStart / actualEnd
        const scheduledRaw = g(j, 'scheduledStart', 'scheduledDate', 'dateStart', 'date')
        const completedRaw = g(j, 'actualEnd', 'actualStart', 'completedDate', 'dateEnd')
        const durationRaw  = g(j, 'duration', 'durationMinutes')

        const techName = str(g(technician, 'name', 'lastName', 'last_name')) ?? ''

        return {
          synchroteam_id: String(j.id),
          defibrillator_id: equipSyncId ? (daeMap.get(equipSyncId) ?? null) : null,
          site_id: siteSyncId ? (siteMap.get(siteSyncId) ?? null) : null,
          client_id: customerSyncId ? (clientMap.get(customerSyncId) ?? null) : null,
          // Type = label de l'objet type Synchroteam
          type: mapJobType(typeObj?.name ?? g(j, 'typeName')),
          status: mapJobStatus(g(j, 'status', 'jobStatus')),
          scheduled_date: parseTimestamp(scheduledRaw),
          completed_date: parseTimestamp(completedRaw),
          technician_name: techName || null,
          technician_synchroteam_id: technician?.id ? String(technician.id) : null,
          duration_minutes: durationRaw != null ? parseInt(String(durationRaw), 10) || null : null,
          report: str(g(j, 'report', 'description', 'note')) ?? null,
          custom_fields: null,
        }
      })
      // Ignorer les jobs sans id Synchroteam valide
      .filter((r) => r.synchroteam_id && r.synchroteam_id !== 'undefined')

    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('interventions').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`interventions upsert: ${error.message}`)
      else total += batch.length
    }
  } catch (err) {
    errors.push(`interventions fetch: ${String(err)}`)
  }
  return total
}

// ─── Étape 7 : Mise à jour last_maintenance_date ─────────────────────────────

async function updateLastMaintenanceDates(
  supabase: SupabaseClient,
  errors: string[]
): Promise<void> {
  try {
    // Récupère la date de dernière maintenance terminée pour chaque DAE
    const { data: completed, error } = await supabase
      .from('interventions')
      .select('defibrillator_id, completed_date')
      .eq('type', 'maintenance')
      .eq('status', 'termine')
      .not('defibrillator_id', 'is', null)
      .not('completed_date', 'is', null)
      .order('completed_date', { ascending: false })

    if (error || !completed?.length) return

    // Grouper par DAE → date la plus récente
    const lastByDae = new Map<string, string>()
    for (const row of completed as Array<{ defibrillator_id: string; completed_date: string }>) {
      if (!lastByDae.has(row.defibrillator_id)) {
        lastByDae.set(row.defibrillator_id, row.completed_date.split('T')[0])
      }
    }

    // Mise à jour en parallèle par lot de 20
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
    // Pagination : PostgREST plafonne à 1 000 lignes par requête par défaut
    const PAGE = 1000
    const allDaes: DaeRow[] = []

    for (let page = 0; ; page++) {
      let { data: batch, error } = await supabase
        .from('defibrillators')
        .select('id, next_maintenance_date, battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry')
        .eq('active', true)
        .range(page * PAGE, (page + 1) * PAGE - 1)

      // Fallback si les colonnes électrodes ne sont pas encore dans le cache PostgREST
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

    const updates = allDaes.map((dae) => {
      const { status, reason } = computeDAEStatus(dae)
      const battery_status = computeConsumableStatus(dae.battery_expiry)
      const ea = computeConsumableStatus(dae.electrodes_adult_expiry)
      const ep = computeConsumableStatus(dae.electrodes_pediatric_expiry)
      const ORDER = ['expire', 'a_remplacer', 'ok', 'inconnu']
      const electrodes_status = ORDER.indexOf(ea) <= ORDER.indexOf(ep) ? ea : ep
      return { id: dae.id, status, status_reason: reason, battery_status, electrodes_status }
    })

    // 20 UPDATEs en parallèle par lot — ~10× plus rapide que séquentiel
    for (const batch of chunk(updates, 20)) {
      const results = await Promise.all(
        batch.map((upd) =>
          supabase
            .from('defibrillators')
            .update({ status: upd.status, status_reason: upd.status_reason, battery_status: upd.battery_status, electrodes_status: upd.electrodes_status })
            .eq('id', upd.id)
        )
      )
      for (const { error } of results) {
        if (error) errors.push(`status update: ${error.message}`)
        else total++
      }
    }
  } catch (err) {
    errors.push(`calculateStatuses: ${String(err)}`)
  }
  return total
}

// ─── Étape 9 : Géocodage fallback ────────────────────────────────────────────

async function geocodeMissingSites(
  supabase: SupabaseClient,
  errors: string[]
): Promise<number> {
  let total = 0
  try {
    // Sites sans coordonnées GPS
    const { data: sites, error } = await supabase
      .from('sites')
      .select('id, name, address, city')
      .is('latitude', null)
      .eq('active', true)
      .limit(50) // Limiter par run pour respecter les quotas Nominatim

    if (error || !sites?.length) return 0

    for (const site of sites as Array<{ id: string; name: string; address: string | null; city: string | null }>) {
      const query = [site.address, site.city, 'La Réunion'].filter(Boolean).join(', ')
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

// ─── Pipeline principal ───────────────────────────────────────────────────────

export async function runSynchroteamSync(supabase: SupabaseClient): Promise<SyncResult> {
  const result: SyncResult = {
    clients: 0, sites: 0, technicians: 0, equipments: 0,
    contracts: 0, interventions: 0, statuses_updated: 0, geocoded: 0, errors: [],
  }

  // Chargement des référentiels en parallèle
  const [{ data: territories }, { data: cfMappings }] = await Promise.all([
    supabase.from('territories').select('id, code'),
    supabase.from('custom_field_mapping').select('*'),
  ])

  const territoryMap = new Map(
    (territories ?? []).map((t: { code: string; id: string }) => [t.code, t.id])
  )
  const mappings: CustomFieldMapping[] = (cfMappings ?? []) as CustomFieldMapping[]

  if (!mappings.length) {
    result.errors.push('Aucun custom field mapping trouvé — lancer /admin/field-mapping/discover')
  }

  // 1. Clients
  result.clients = await syncClients(supabase, territoryMap, result.errors)
  const clientMap = await buildIdMap(supabase, 'clients')

  // 2. Sites (nécessite clientMap)
  result.sites = await syncSites(supabase, clientMap, territoryMap, result.errors)
  const siteMap = await buildIdMap(supabase, 'sites')

  // 3. Techniciens (indépendant)
  result.technicians = await syncTechnicians(supabase, result.errors)

  // 4. Équipements (nécessite clientMap + siteMap + mappings)
  result.equipments = await syncEquipments(supabase, clientMap, siteMap, territoryMap, mappings, result.errors)
  const daeMap = await buildIdMap(supabase, 'defibrillators')

  // 5. Contrats (enrichissement, best-effort)
  result.contracts = await syncContracts(supabase, daeMap, result.errors)

  // 6. Interventions (nécessite daeMap + siteMap + clientMap)
  result.interventions = await syncInterventions(supabase, daeMap, siteMap, clientMap, result.errors)

  // 7. Date dernière maintenance (depuis les interventions)
  await updateLastMaintenanceDates(supabase, result.errors)

  // 8. Calcul des statuts DAE
  result.statuses_updated = await calculateStatuses(supabase, result.errors)

  // 9. Géocodage fallback (sites sans GPS)
  result.geocoded = await geocodeMissingSites(supabase, result.errors)

  return result
}
