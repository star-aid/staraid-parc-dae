/**
 * Diagnostic : pourquoi ECOLE SAINT CHARLES n'apparaît pas dans l'app.
 * Usage : node --env-file=.env.local scripts/diag-ecole-saint-charles.mjs
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

async function allPages(endpoint, params = {}) {
  const out = []
  let page = 1
  while (true) {
    const d = await api(endpoint, { ...params, page, pageSize: 100 })
    out.push(...d.data)
    if (out.length >= d.recordsTotal) break
    page++
  }
  return out
}

console.log('\n=== DIAGNOSTIC ECOLE SAINT CHARLES ===\n')

// 1. Chercher le client dans Synchroteam
console.log('1. Recherche dans Synchroteam (customers)…')
const customers = await allPages('/Api/v3/customer/list')
const matching = customers.filter(c =>
  String(c.name ?? '').toLowerCase().includes('saint charles') ||
  String(c.name ?? '').toLowerCase().includes('ecole')
)
console.log(`   Total customers : ${customers.length}`)
console.log(`   Correspondances "saint charles" / "ecole" : ${matching.length}`)
matching.forEach(c => console.log(`   → [${c.id}] "${c.name}" active=${c.active}`))

// 2. Chercher dans les équipements Synchroteam
console.log('\n2. Recherche dans Synchroteam (equipment)…')
const equipments = await allPages('/Api/v3/equipment/list')
const matchEq = equipments.filter(eq => {
  const cname = String(eq.customer?.name ?? '').toLowerCase()
  const sname = String(eq.site?.name ?? '').toLowerCase()
  return cname.includes('saint charles') || cname.includes('ecole') ||
         sname.includes('saint charles') || sname.includes('ecole')
})
console.log(`   Total equipments : ${equipments.length}`)
console.log(`   Équipements liés au client : ${matchEq.length}`)
matchEq.forEach(eq => {
  console.log(`   → [${eq.id}] client="${eq.customer?.name}" site="${eq.site?.name}" active=${eq.active}`)
  const cf = eq.customFieldValues ?? eq.customFields ?? eq.custom_fields ?? eq.customfields
  if (cf) console.log(`     custom_fields présents : ${JSON.stringify(cf).slice(0, 200)}`)
  else console.log(`     ⚠️  Pas de custom_fields dans la réponse list`)
})

// 3. Si équipement trouvé, vérifier le détail
if (matchEq.length > 0) {
  const eq = matchEq[0]
  console.log(`\n3. Détail équipement [${eq.id}] via /equipment/details…`)
  try {
    const detail = await api('/Api/v3/equipment/details', { id: eq.id })
    const cf = detail.customFieldValues ?? detail.customFields ?? detail.custom_fields
    console.log(`   Champs custom : ${JSON.stringify(cf, null, 2)}`)
  } catch (e) {
    console.log(`   ❌ ${e.message}`)
  }
}

// 4. Vérifier en base Supabase
console.log('\n4. Vérification en base Supabase…')

const { data: dbClients } = await supabase.from('clients').select('id, name, synchroteam_id')
  .or('name.ilike.%saint charles%,name.ilike.%ecole%')
console.log(`   Clients en base : ${dbClients?.length ?? 0}`)
dbClients?.forEach(c => console.log(`   → [${c.synchroteam_id}] "${c.name}" uuid=${c.id}`))

if (dbClients?.length > 0) {
  const clientId = dbClients[0].id
  const { data: dbDae } = await supabase.from('defibrillators').select('*').eq('client_id', clientId)
  console.log(`   DAE associés en base : ${dbDae?.length ?? 0}`)
  dbDae?.forEach(d => console.log(`   → synchroteam_id=${d.synchroteam_id} serial=${d.serial_number} active=${d.active} status=${d.status}`))
} else {
  console.log('   ⚠️  Client introuvable en base → le client n\'a pas été syncé')
}

// 5. Vérifier les custom field mappings
console.log('\n5. Custom field mappings en base…')
const { data: cfm } = await supabase.from('custom_field_mapping').select('*')
console.log(`   Mappings : ${cfm?.length ?? 0}`)
cfm?.forEach(m => console.log(`   [${m.synchroteam_field_id}] "${m.synchroteam_label}" → ${m.internal_field}`))

console.log('\n=== FIN DIAGNOSTIC ===\n')
