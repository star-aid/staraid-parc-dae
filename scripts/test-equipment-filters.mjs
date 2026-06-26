/**
 * Test filtres API Synchroteam — equipment/list & equipment/details
 * Usage : node --env-file=.env.local scripts/test-equipment-filters.mjs
 */

const credentials = Buffer.from(
  `${process.env.SYNCHROTEAM_DOMAIN}:${process.env.SYNCHROTEAM_API_KEY}`
).toString('base64')
const headers = { Authorization: `Basic ${credentials}`, Accept: 'application/json' }
const BASE = process.env.SYNCHROTEAM_BASE_URL ?? 'https://ws.synchroteam.com'

async function api(endpoint, params = {}) {
  const url = new URL(`${BASE}${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  console.log(`  → GET ${url.pathname}?${url.searchParams}`)
  const r = await fetch(url, { headers })
  console.log(`  ← HTTP ${r.status}`)
  if (!r.ok) { console.error(`  ❌ ${r.statusText}`); return null }
  return r.json()
}

// ── 1. equipment/details sur un ID connu ────────────────────────────────────

console.log('\n═══ 1. equipment/details (id=2076606 — ECOLE SAINT CHARLES) ════')
const detail = await api('/Api/v3/equipment/details', { id: 2076606 })
if (detail) {
  // Champs de premier niveau (hors customFieldValues)
  const topFields = Object.keys(detail).filter(k => k !== 'customFieldValues')
  console.log('\n  Champs présents au premier niveau :')
  topFields.forEach(k => console.log(`    "${k}" : ${JSON.stringify(detail[k])?.slice(0, 80)}`))

  // Chercher active / status / enabled / archived / disabled
  const candidates = ['active', 'status', 'enabled', 'archived', 'disabled', 'isActive', 'is_active']
  console.log('\n  Champs active/status/enabled/archived :')
  candidates.forEach(k => {
    if (k in detail) console.log(`    ✅ "${k}" = ${JSON.stringify(detail[k])}`)
    else console.log(`    ✗  "${k}" absent`)
  })
}

// ── 2. equipment/list sans filtre (baseline) ────────────────────────────────

console.log('\n═══ 2. equipment/list — baseline (page=1, pageSize=1) ════')
const baseline = await api('/Api/v3/equipment/list', { page: 1, pageSize: 1 })
if (baseline) {
  console.log(`  recordsTotal = ${baseline.recordsTotal}`)
  console.log(`  Champs disponibles au premier niveau de data[0] :`)
  const sample = baseline.data?.[0]
  if (sample) {
    Object.entries(sample).forEach(([k, v]) => {
      if (k !== 'customFieldValues') console.log(`    "${k}" : ${JSON.stringify(v)?.slice(0, 60)}`)
    })
  }
}

// ── 3. Filtres active=true / active=false ────────────────────────────────────

console.log('\n═══ 3. equipment/list?active=true ════')
const activeTrue = await api('/Api/v3/equipment/list', { page: 1, pageSize: 1, active: 'true' })
if (activeTrue) console.log(`  recordsTotal = ${activeTrue.recordsTotal}`)

console.log('\n═══ 4. equipment/list?active=false ════')
const activeFalse = await api('/Api/v3/equipment/list', { page: 1, pageSize: 1, active: 'false' })
if (activeFalse) console.log(`  recordsTotal = ${activeFalse.recordsTotal}`)

console.log('\n═══ 5. equipment/list?active=1 ════')
const active1 = await api('/Api/v3/equipment/list', { page: 1, pageSize: 1, active: '1' })
if (active1) console.log(`  recordsTotal = ${active1.recordsTotal}`)

console.log('\n═══ 6. equipment/list?active=0 ════')
const active0 = await api('/Api/v3/equipment/list', { page: 1, pageSize: 1, active: '0' })
if (active0) console.log(`  recordsTotal = ${active0.recordsTotal}`)

console.log('\n═══ 7. equipment/list?status=active ════')
const statusActive = await api('/Api/v3/equipment/list', { page: 1, pageSize: 1, status: 'active' })
if (statusActive) console.log(`  recordsTotal = ${statusActive.recordsTotal}`)

console.log('\n═══ 8. equipment/list?status=inactive ════')
const statusInactive = await api('/Api/v3/equipment/list', { page: 1, pageSize: 1, status: 'inactive' })
if (statusInactive) console.log(`  recordsTotal = ${statusInactive.recordsTotal}`)

// ── 9. Vérifier si le champ "active" existe sur un équipement inactif connu ──
// On prend les 10 derniers de la liste sans filtre et on cherche un active=false
console.log('\n═══ 9. Recherche d\'un équipement avec active=false dans les données ════')
const last = await api('/Api/v3/equipment/list', { page: 1, pageSize: 100 })
if (last?.data) {
  const inactive = last.data.filter((eq) => eq.active === false || eq.active === 0 || eq.active === '0')
  const activeOnes = last.data.filter((eq) => eq.active === true || eq.active === 1 || eq.active === '1')
  const activeNull = last.data.filter((eq) => eq.active == null)
  console.log(`  Sur les 100 premiers : active=true/1 → ${activeOnes.length}, active=false/0 → ${inactive.length}, active=null/absent → ${activeNull.length}`)
  if (inactive.length > 0) console.log(`  Exemple inactif : id=${inactive[0].id} name="${inactive[0].name}"`)
}

console.log('\n═══ FIN ════\n')
