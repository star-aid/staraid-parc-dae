/**
 * Réparation ciblée ECOLE SAINT CHARLES.
 * Usage : node --env-file=.env.local scripts/repair-ecole-saint-charles.mjs
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const credentials = Buffer.from(
  `${process.env.SYNCHROTEAM_DOMAIN}:${process.env.SYNCHROTEAM_API_KEY}`
).toString('base64')
const headers = { Authorization: `Basic ${credentials}`, Accept: 'application/json' }
const BASE = process.env.SYNCHROTEAM_BASE_URL ?? 'https://ws.synchroteam.com'

async function api(endpoint, params = {}) {
  const url = new URL(`${BASE}${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`${r.status} ${endpoint}`)
  return r.json()
}

function parseDate(val) {
  if (!val) return null
  let s = String(val).trim()
  const ddmmyyyy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (ddmmyyyy) s = `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

console.log('\n=== RÉPARATION ECOLE SAINT CHARLES ===\n')

// 1. Récupérer les UUIDs des clients en base
const { data: clients } = await supabase.from('clients').select('id, synchroteam_id, name')
const clientMap = new Map(clients.map(c => [c.synchroteam_id, c]))

const saintCharlesClient = clientMap.get('3820348')
const montessoriClient = clientMap.get('5641646')

console.log('Clients concernés :')
console.log(`  ECOLE SAINT CHARLES : synchroteam_id=3820348 → uuid=${saintCharlesClient?.id ?? '❌ ABSENT'}`)
console.log(`  ECOLE MONTESSORI    : synchroteam_id=5641646 → uuid=${montessoriClient?.id ?? '❌ ABSENT'}`)

// 2. État actuel en base pour les deux équipements
const { data: dae2076606 } = await supabase.from('defibrillators').select('*').eq('synchroteam_id', '2076606').maybeSingle()
const { data: dae3245990 } = await supabase.from('defibrillators').select('*').eq('synchroteam_id', '3245990').maybeSingle()

console.log('\nÉtat actuel en base :')
console.log(`  [2076606] ECOLE SAINT CHARLES : ${dae2076606 ? `uuid=${dae2076606.id} client_id=${dae2076606.client_id} serial=${dae2076606.serial_number}` : '❌ ABSENT de Supabase'}`)
console.log(`  [3245990] ECOLE MONTESSORI    : ${dae3245990 ? `uuid=${dae3245990.id} client_id=${dae3245990.client_id} serial=${dae3245990.serial_number}` : '❌ ABSENT de Supabase'}`)

// 3. Récupérer les sites et custom field mappings
const { data: sitesData } = await supabase.from('sites').select('id, synchroteam_id, name, client_id')
const siteMap = new Map(sitesData.map(s => [s.synchroteam_id, s]))

const { data: cfMappings } = await supabase.from('custom_field_mapping').select('*')
const mappingById = new Map(cfMappings.map(m => [m.synchroteam_field_id, m]))

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
  }
  return result
}

// 4. Récupérer les données fraîches depuis Synchroteam
console.log('\nRécupération depuis Synchroteam…')

const [detail2076606, detail3245990] = await Promise.all([
  api('/Api/v3/equipment/details', { id: 2076606 }),
  api('/Api/v3/equipment/details', { id: 3245990 }),
])

// 5. Vérifier les sites associés
const site2076606_syncId = detail2076606.site?.id ? String(detail2076606.site.id) : null
const site3245990_syncId = detail3245990.site?.id ? String(detail3245990.site.id) : null

console.log(`  [2076606] customer.id=${detail2076606.customer?.id} site.id=${site2076606_syncId} site.name="${detail2076606.site?.name}"`)
console.log(`  [3245990] customer.id=${detail3245990.customer?.id} site.id=${site3245990_syncId} site.name="${detail3245990.site?.name}"`)

// Récupérer les territoires
const { data: territories } = await supabase.from('territories').select('id, code')
const territoryMap = new Map(territories.map(t => [t.code, t.id]))
const reuId = territoryMap.get('REU')

// 6. Construire les lignes corrigées

function buildRow(detail, expectedClientSyncId, idPrefix = '') {
  const cf = extractCF(detail)
  const modelRaw = cf.model ?? null
  const sep = modelRaw?.indexOf(' - ') ?? -1
  const brand = sep > 0 ? modelRaw.slice(0, sep).trim() : null
  const model = sep > 0 ? modelRaw.slice(sep + 3).trim() : modelRaw

  const customer = detail.customer
  const site = detail.site
  const site_id = site?.id ? (siteMap.get(String(site.id))?.id ?? null) : null
  const client = clientMap.get(expectedClientSyncId)
  const client_id = client?.id ?? null

  return {
    synchroteam_id: `${idPrefix}${detail.id}`,
    client_id,
    site_id,
    territory_id: reuId,
    serial_number: cf.serial_number ?? null,
    model: model ?? null,
    brand: brand ?? null,
    battery_install_date: parseDate(cf.battery_install_date),
    electrodes_adult_expiry: parseDate(cf.electrodes_adult_expiry),
    electrodes_pediatric_expiry: parseDate(cf.electrodes_pediatric_expiry),
    contract_type: cf.contract_type ?? null,
    notes: cf.notes ?? null,
    custom_fields: cf,
    active: detail.active !== false,
    synced_at: new Date().toISOString(),
  }
}

// Equipment 2076606 → client ECOLE SAINT CHARLES (3820348)
const row2076606 = buildRow(detail2076606, '3820348')
// Equipment 3245990 → client ECOLE MONTESSORI (5641646)
const row3245990 = buildRow(detail3245990, '5641646')

console.log('\nCorrections à appliquer :')
console.log(`  [2076606] client_id=${row2076606.client_id} site_id=${row2076606.site_id} serial=${row2076606.serial_number}`)
console.log(`  [3245990] client_id=${row3245990.client_id} site_id=${row3245990.site_id} serial=${row3245990.serial_number}`)

// 7. Upsert des corrections
console.log('\nApplication des corrections…')

const { error: err1 } = await supabase
  .from('defibrillators')
  .upsert(row2076606, { onConflict: 'synchroteam_id' })
if (err1) console.error(`  ❌ [2076606] : ${err1.message}`)
else console.log(`  ✅ [2076606] ECOLE SAINT CHARLES — X19E162952 — upserted`)

const { error: err2 } = await supabase
  .from('defibrillators')
  .upsert(row3245990, { onConflict: 'synchroteam_id' })
if (err2) console.error(`  ❌ [3245990] : ${err2.message}`)
else console.log(`  ✅ [3245990] ECOLE MONTESSORI — X21D365604 — client_id corrigé`)

// 8. Vérification finale
const { data: final } = await supabase
  .from('defibrillators')
  .select('synchroteam_id, serial_number, client_id, site_id, status')
  .in('synchroteam_id', ['2076606', '3245990'])

console.log('\nVérification finale :')
final?.forEach(d => console.log(`  [${d.synchroteam_id}] serial=${d.serial_number} client_id=${d.client_id} status=${d.status}`))

console.log('\n=== FIN RÉPARATION ===\n')
