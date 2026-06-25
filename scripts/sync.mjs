/**
 * Sync manuelle locale — contourne Vercel et ses timeouts.
 * Usage : node scripts/sync.mjs [reu|glp|myt|all]
 *
 * Prérequis : .env.local renseigné (SUPABASE_SERVICE_ROLE_KEY, SYNCHROTEAM_*, etc.)
 */

import { createClient } from '@supabase/supabase-js'
// Les variables d'env sont chargées via --env-file=.env.local (voir commande ci-dessous)

// ── Vérification des variables ──────────────────────────────────────────────

const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
for (const v of required) {
  if (!process.env[v]) {
    console.error(`❌ Variable manquante : ${v}`)
    process.exit(1)
  }
}

// ── Client Supabase ──────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

// ── Client Synchroteam ───────────────────────────────────────────────────────

function createClient_ST(domain, apiKey) {
  const credentials = Buffer.from(`${domain}:${apiKey}`).toString('base64')
  const headers = {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const BASE_URL = process.env.SYNCHROTEAM_BASE_URL ?? 'https://ws.synchroteam.com'

  async function apiFetch(endpoint, params = {}) {
    const url = new URL(`${BASE_URL}${endpoint}`)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
    const res = await fetch(url.toString(), { headers })
    if (res.status === 429) {
      const waitMs = Math.max((Number(res.headers.get('X-RateLimit-Reset') ?? 0) * 1000 - Date.now()), 5000)
      console.log(`  ⏳ Rate limit — attente ${Math.round(waitMs/1000)}s…`)
      await new Promise(r => setTimeout(r, waitMs))
      return apiFetch(endpoint, params)
    }
    if (!res.ok) throw new Error(`Synchroteam ${res.status} GET ${endpoint}`)
    return res.json()
  }

  async function fetchAllPages(endpoint, params = {}) {
    const results = []
    let page = 1
    while (true) {
      const data = await apiFetch(endpoint, { ...params, page, pageSize: 100 })
      results.push(...data.data)
      if (results.length >= data.recordsTotal) break
      page++
      process.stdout.write(`\r  📄 ${endpoint} — page ${page} (${results.length}/${data.recordsTotal})    `)
    }
    if (results.length > 0) process.stdout.write('\n')
    return results
  }

  return {
    fetchCustomers: () => fetchAllPages('/Api/v3/customer/list'),
    fetchSites: () => fetchAllPages('/Api/v3/site/list'),
    fetchEquipments: async () => {
      const [active, inactive] = await Promise.all([
        fetchAllPages('/Api/v3/equipment/list'),
        fetchAllPages('/Api/v3/equipment/list', { active: 'false' }),
      ])
      const seen = new Set()
      return [...active, ...inactive].filter(eq => {
        if (seen.has(eq.id)) return false
        seen.add(eq.id)
        return true
      })
    },
    fetchContracts: () => fetchAllPages('/Api/v3/contract/list'),
    fetchJobs: (params) => fetchAllPages('/Api/v3/job/list', params),
    fetchUsers: () => fetchAllPages('/Api/v3/user/list'),
    fetchCustomFields: async () => {
      const d = await apiFetch('/Api/v3/customfield/list', { type: 'equipment' })
      return d.data
    },
  }
}

// ── Compte à synchroniser ────────────────────────────────────────────────────

const ACCOUNTS = {
  reu: {
    label: 'La Réunion',
    domain: process.env.SYNCHROTEAM_DOMAIN,
    key: process.env.SYNCHROTEAM_API_KEY,
    idPrefix: '',
    forcedTerritory: null,
  },
  glp: {
    label: 'Guadeloupe',
    domain: process.env.SYNCHROTEAM_DOMAIN_GLP,
    key: process.env.SYNCHROTEAM_API_KEY_GLP,
    idPrefix: 'GLP_',
    forcedTerritory: 'GLP',
  },
  myt: {
    label: 'Mayotte',
    domain: process.env.SYNCHROTEAM_DOMAIN_MYT,
    key: process.env.SYNCHROTEAM_API_KEY_MYT,
    idPrefix: 'MYT_',
    forcedTerritory: 'MYT',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function g(obj, ...keys) {
  for (const k of keys) { const v = obj?.[k]; if (v != null && v !== '') return v }
  return null
}
function str(val) { const s = String(val ?? '').trim(); return s || null }
function parseDate(val) {
  if (!val) return null
  let s = String(val).trim()
  // Convertir dd/mm/yyyy → yyyy-mm-dd (format Synchroteam pour les dates saisies manuellement)
  const ddmmyyyy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (ddmmyyyy) s = `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}
function parseTimestamp(val) {
  if (!val) return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
function detectTerritory(text) {
  const l = text.toLowerCase()
  if (l.includes('réunion') || l.includes('reunion') || l.includes('974')) return 'REU'
  if (l.includes('mayotte') || l.includes('976')) return 'MYT'
  if (l.includes('guadeloupe') || l.includes('971')) return 'GLP'
  return 'REU'
}

// ── Heuristiques de mapping (miroir de lib/field-mapping.ts) ─────────────────

const HEURISTICS = [
  { keywords: ['mise en place batterie', 'mise en place batt', 'date usine de la batt', 'batterie ou pile', 'battery', 'pile'], internal: 'battery_install_date', type: 'date' },
  { keywords: ['dlu électrodes adultes', 'péremption des électrodes adultes', 'électrodes adulte'], internal: 'electrodes_adult_expiry', type: 'date' },
  { keywords: ['dlu électrodes pédiatriques', 'péremption des électrodes pédiat', 'électrodes pédiat'], internal: 'electrodes_pediatric_expiry', type: 'date' },
  { keywords: ["n° de série du défibrillateur", 'numéro de série du défibrillateur'], internal: 'serial_number', type: 'text' },
  { keywords: ['marque/modèle', 'marque', 'modèle'], internal: 'model', type: 'text' },
  { keywords: ['date usine du défibrillateur', 'date usine'], internal: 'manufacture_date', type: 'date' },
  { keywords: ['emplacement'], internal: 'location_detail', type: 'text' },
  { keywords: ['code armoire'], internal: 'cabinet_code', type: 'text' },
  { keywords: ['zone géographique', 'zone geographique'], internal: 'zone_geographique', type: 'text' },
  { keywords: ['identifiant geo dae', 'geo dae', 'identifiant dae'], internal: 'geo_dae_id', type: 'text' },
  { keywords: ['type de contrat'], internal: 'contract_type', type: 'text' },
  { keywords: ['date de fin de contrat', 'fin de contrat'], internal: 'contract_end', type: 'date' },
  { keywords: ['date de livraison', 'livraison'], internal: 'contract_start', type: 'date' },
  { keywords: ['kit rcp', 'kit complet', 'kit paire', 'kit rasoir', 'kit protection', 'kit gant'], internal: 'kit_rcp', type: 'text' },
  { keywords: ["n° de série de l'appareil de prêt", 'appareil de prêt', 'prêt'], internal: 'loan_serial_number', type: 'text' },
  { keywords: ['registre défibrillateur', 'registre star'], internal: 'registre_star_aid', type: 'text' },
  { keywords: ['commentaires', 'commentaire', 'notes', 'remarque'], internal: 'notes', type: 'text' },
]

function guessInternalField(label, syncType) {
  const lower = label.toLowerCase()
  for (const h of HEURISTICS) {
    if (h.keywords.some(k => lower.includes(k))) {
      return { internal: h.internal, type: syncType === 'date' ? 'date' : h.type }
    }
  }
  return null
}

// ── Discovery des custom fields d'un compte ───────────────────────────────────

async function discoverCustomFields(api, label) {
  console.log(`\n🔍 Discovery custom fields — ${label}…`)
  try {
    const fields = await api.fetchCustomFields()
    const mappable = fields
      .map(f => {
        const guess = guessInternalField(f.label, f.type)
        return guess ? {
          synchroteam_field_id: f.id,
          synchroteam_label: f.label,
          internal_field: guess.internal,
          field_type: guess.type,
        } : null
      })
      .filter(Boolean)

    if (mappable.length > 0) {
      const { error } = await supabase
        .from('custom_field_mapping')
        .upsert(mappable, { onConflict: 'synchroteam_field_id' })
      if (error) console.error(`  ❌ Upsert mapping: ${error.message}`)
      else console.log(`  ✅ ${mappable.length}/${fields.length} champs mappés automatiquement`)
    } else {
      console.log(`  ⚠️  Aucun champ reconnu parmi ${fields.length} — vérifier les labels Synchroteam`)
    }

    // Afficher les champs non mappés pour diagnostic
    const unmapped = fields.filter(f => !guessInternalField(f.label, f.type))
    if (unmapped.length) {
      console.log(`  ℹ️  Champs non reconnus (${unmapped.length}) :`)
      unmapped.forEach(f => console.log(`     [${f.id}] "${f.label}" (${f.type})`))
    }
  } catch (e) {
    console.error(`  ❌ Discovery échouée : ${e}`)
  }
}

// ── Pipeline de sync pour un compte ──────────────────────────────────────────

async function syncAccount(acc) {
  const { label, domain, key, idPrefix, forcedTerritory } = acc
  if (!domain || !key) { console.log(`  ⚠️  ${label} : credentials manquants — ignoré`); return }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`🌍 ${label} (prefix="${idPrefix || 'aucun'}")`)
  console.log('─'.repeat(60))

  const api = createClient_ST(domain, key)

  // Discovery des custom fields de CE compte (IDs spécifiques à chaque domaine Synchroteam)
  await discoverCustomFields(api, label)

  // Référentiels
  const [{ data: territories }, { data: cfMappings }] = await Promise.all([
    supabase.from('territories').select('id, code'),
    supabase.from('custom_field_mapping').select('*'),
  ])
  const territoryMap = new Map((territories ?? []).map(t => [t.code, t.id]))
  const mappings = cfMappings ?? []

  if (!mappings.length) console.warn('  ⚠️  Aucun custom field mapping — certains champs DAE seront vides')

  const now = new Date().toISOString()
  const errors = []
  let totalClients = 0, totalSites = 0, totalEquip = 0, totalInterv = 0

  // 1. Clients
  console.log('\n1️⃣  Clients…')
  try {
    const customers = await api.fetchCustomers()
    const rows = customers.map(c => {
      const address = str(g(c, 'address', 'addressStreet'))
      const city = str(g(c, 'addressCity'))
      const country = str(g(c, 'addressCountry')) ?? ''
      const territory_code = forcedTerritory ?? detectTerritory([address ?? '', city ?? '', country].join(' '))
      return {
        synchroteam_id: `${idPrefix}${c.id}`,
        name: str(g(c, 'name')) ?? 'Sans nom',
        address, city,
        territory_id: territoryMap.get(territory_code) ?? null,
        contact_email: str(g(c, 'contactEmail')),
        contact_phone: str(g(c, 'contactPhone', 'contactMobile')),
        tags: Array.isArray(c.tags) ? c.tags : [],
        active: Boolean(c.active),
        synced_at: now,
      }
    })
    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('clients').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`clients: ${error.message}`)
      else totalClients += batch.length
    }
    console.log(`  ✅ ${totalClients} clients`)
  } catch (e) { errors.push(`clients fetch: ${e}`); console.error(`  ❌ ${e}`) }

  const clientMap = new Map((((await supabase.from('clients').select('id, synchroteam_id')).data) ?? []).map(r => [r.synchroteam_id, r.id]))

  // 2. Sites
  console.log('\n2️⃣  Sites…')
  try {
    const sites = await api.fetchSites()
    const rows = sites.map(s => {
      const customer = s.customer
      const client_id = customer?.id ? (clientMap.get(`${idPrefix}${customer.id}`) ?? null) : null
      const address = str(g(s, 'address', 'addressStreet'))
      const city = str(g(s, 'city', 'addressCity'))
      const country = str(g(s, 'addressCountry')) ?? ''
      const territory_code = forcedTerritory ?? detectTerritory([address ?? '', city ?? '', country].join(' '))
      const pos = s.position ?? s.Position
      const lat = pos?.latitude ? parseFloat(pos.latitude) : null
      const lng = pos?.longitude ? parseFloat(pos.longitude) : null
      return {
        synchroteam_id: `${idPrefix}${s.id}`,
        client_id,
        name: str(g(s, 'name')) ?? 'Site sans nom',
        address, city,
        territory_id: territoryMap.get(territory_code) ?? null,
        latitude: lat && !isNaN(lat) ? lat : null,
        longitude: lng && !isNaN(lng) ? lng : null,
        active: Boolean(s.active),
        synced_at: now,
      }
    })
    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('sites').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`sites: ${error.message}`)
      else totalSites += batch.length
    }
    console.log(`  ✅ ${totalSites} sites`)
  } catch (e) { errors.push(`sites fetch: ${e}`); console.error(`  ❌ ${e}`) }

  const siteMap = new Map((((await supabase.from('sites').select('id, synchroteam_id')).data) ?? []).map(r => [r.synchroteam_id, r.id]))

  // 3. Équipements
  console.log('\n3️⃣  Équipements…')
  try {
    const equipments = await api.fetchEquipments()
    const mappingById = new Map(mappings.map(m => [m.synchroteam_field_id, m]))

    function extractCF(eq) {
      const raw = eq.customFieldValues ?? eq.customFields ?? eq.custom_fields ?? eq.customfields
      if (!raw) return {}
      const result = {}
      if (Array.isArray(raw)) {
        for (const e of raw) {
          const id = e.id ?? e.fieldId
          const m = mappingById.get(Number(id))
          if (m) result[m.internal_field] = e.value != null ? String(e.value) : null
        }
      } else if (typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          const m = mappingById.get(Number(k))
          if (m) result[m.internal_field] = v != null ? String(v) : null
        }
      }
      return result
    }

    const rows = equipments.map(eq => {
      const customer = eq.customer
      const site = eq.site
      const site_id = site?.id ? (siteMap.get(`${idPrefix}${site.id}`) ?? null) : null
      const client_id = customer?.id
        ? (clientMap.get(`${idPrefix}${customer.id}`) ?? null)
        : (site?.id ? (clientMap.get(`${idPrefix}${site.id}`) ?? null) : null)
      const cf = extractCF(eq)
      const modelRaw = cf.model ?? null
      const sep = modelRaw?.indexOf(' - ') ?? -1
      const brand = sep > 0 ? modelRaw.slice(0, sep).trim() : null
      const model = sep > 0 ? modelRaw.slice(sep + 3).trim() : modelRaw

      const zone = cf.zone_geographique ?? null
      const territory_code = forcedTerritory ?? detectTerritory(zone ?? '')
      return {
        synchroteam_id: `${idPrefix}${eq.id}`,
        client_id, site_id,
        territory_id: territoryMap.get(territory_code) ?? null,
        serial_number: str(cf.serial_number),
        model, brand,
        battery_install_date: parseDate(cf.battery_install_date ?? cf.battery_expiry),
        electrodes_adult_expiry: parseDate(cf.electrodes_adult_expiry),
        electrodes_pediatric_expiry: parseDate(cf.electrodes_pediatric_expiry),
        contract_type: str(cf.contract_type),
        notes: str(cf.notes),
        custom_fields: cf,
        active: eq.active !== false,
        synced_at: now,
      }
    })
    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('defibrillators').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`defibrillators: ${error.message}`)
      else totalEquip += batch.length
    }
    console.log(`  ✅ ${totalEquip} équipements`)
  } catch (e) { errors.push(`equipments fetch: ${e}`); console.error(`  ❌ ${e}`) }

  // 4. Interventions (12 derniers mois)
  console.log('\n4️⃣  Interventions…')
  try {
    const daeMap = new Map((((await supabase.from('defibrillators').select('id, synchroteam_id')).data) ?? []).map(r => [r.synchroteam_id, r.id]))
    const since = new Date(); since.setFullYear(since.getFullYear() - 1)
    const jobs = await api.fetchJobs({ dateFrom: since.toISOString().split('T')[0] })
    const rows = jobs.map(j => {
      const eq = j.equipment; const site = j.site; const customer = j.customer
      const tech = j.technician ?? j.user
      const typeObj = j.type
      return {
        synchroteam_id: `${idPrefix}${j.id}`,
        defibrillator_id: eq?.id ? (daeMap.get(`${idPrefix}${eq.id}`) ?? null) : null,
        site_id: site?.id ? (siteMap.get(`${idPrefix}${site.id}`) ?? null) : null,
        client_id: customer?.id ? (clientMap.get(`${idPrefix}${customer.id}`) ?? null) : null,
        type: 'autre',
        status: 'planifie',
        scheduled_date: parseTimestamp(g(j, 'scheduledStart', 'scheduledDate', 'dateStart', 'date')),
        completed_date: parseTimestamp(g(j, 'actualEnd', 'completedDate', 'dateEnd')),
        technician_name: str(g(tech, 'name', 'lastName')) ?? null,
        technician_synchroteam_id: tech?.id ? `${idPrefix}${tech.id}` : null,
        report: str(g(j, 'report', 'description', 'note')),
        custom_fields: null,
      }
    }).filter(r => r.synchroteam_id && !r.synchroteam_id.endsWith('undefined'))

    for (const batch of chunk(rows, 50)) {
      const { error } = await supabase.from('interventions').upsert(batch, { onConflict: 'synchroteam_id' })
      if (error) errors.push(`interventions: ${error.message}`)
      else totalInterv += batch.length
    }
    console.log(`  ✅ ${totalInterv} interventions`)
  } catch (e) { errors.push(`interventions fetch: ${e}`); console.error(`  ❌ ${e}`) }

  if (errors.length) {
    console.log('\n⚠️  Erreurs :')
    errors.forEach(e => console.log(`  • ${e}`))
  }

  return { clients: totalClients, sites: totalSites, equipments: totalEquip, interventions: totalInterv, errors }
}

// ── Calcul des statuts (global) ───────────────────────────────────────────────

async function calculateStatuses() {
  console.log('\n🔄 Calcul des statuts DAE…')
  const today = new Date()
  const in30 = new Date(today.getTime() + 30 * 86400000)

  const PAGE = 1000; let page = 0; let total = 0
  while (true) {
    const { data, error } = await supabase
      .from('defibrillators')
      .select('id, next_maintenance_date, battery_expiry, electrodes_adult_expiry, electrodes_pediatric_expiry')
      .eq('active', true)
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error || !data?.length) break

    const updates = data.map(d => {
      const dates = [
        d.next_maintenance_date && new Date(d.next_maintenance_date),
        d.battery_expiry && new Date(d.battery_expiry),
        d.electrodes_adult_expiry && new Date(d.electrodes_adult_expiry),
        d.electrodes_pediatric_expiry && new Date(d.electrodes_pediatric_expiry),
      ].filter(Boolean)

      if (!dates.length) return { id: d.id, status: 'inconnu', status_reason: 'Données insuffisantes' }
      if (dates.some(dt => dt < today)) return { id: d.id, status: 'critique', status_reason: 'Échéance dépassée' }
      if (dates.some(dt => dt <= in30)) return { id: d.id, status: 'vigilance', status_reason: 'Échéance < 30 jours' }
      return { id: d.id, status: 'conforme', status_reason: 'Tout à jour' }
    })

    for (const batch of chunk(updates, 20)) {
      await Promise.all(batch.map(u =>
        supabase.from('defibrillators').update({ status: u.status, status_reason: u.status_reason }).eq('id', u.id)
      ))
      total += batch.length
    }

    if (data.length < PAGE) break
    page++
  }
  console.log(`  ✅ ${total} statuts mis à jour`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

const arg = process.argv[2] ?? 'all'
const toSync = arg === 'all'
  ? Object.values(ACCOUNTS)
  : [ACCOUNTS[arg]].filter(Boolean)

if (!toSync.length) {
  console.error(`Usage : node scripts/sync.mjs [reu|glp|myt|all]`)
  process.exit(1)
}

console.log(`\n🚀 Sync manuelle STAR aid — ${new Date().toLocaleString('fr-FR')}`)
console.log(`   Territoires : ${toSync.map(a => a.label).join(', ')}`)

const started = Date.now()

for (const acc of toSync) {
  await syncAccount(acc)
}

await calculateStatuses()

const duration = Math.round((Date.now() - started) / 1000)
console.log(`\n✅ Sync terminée en ${duration}s\n`)
