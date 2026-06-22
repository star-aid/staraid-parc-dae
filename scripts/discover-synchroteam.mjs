/**
 * Script de discovery Synchroteam
 *
 * Usage :
 *   node scripts/discover-synchroteam.mjs
 *
 * Prérequis : .env.local rempli avec SYNCHROTEAM_DOMAIN et SYNCHROTEAM_API_KEY
 *
 * Ce script :
 *  1. Appelle GET /Api/v3/customfield/list?type=equipment
 *  2. Affiche la structure réelle des champs DAE
 *  3. Propose un mapping automatique vers les champs internes connus
 *  4. Génère un SQL INSERT prêt à coller dans Supabase
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '../.env.local')

// Charger .env.local — strip commentaires inline (ex: KEY=val  # commentaire)
try {
  const env = readFileSync(envPath, 'utf8')
  for (const line of env.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const raw = trimmed.slice(eqIndex + 1)
    // Strip commentaires inline : tout ce qui suit un espace + '#'
    const val = raw.replace(/\s+#.*$/, '').trim()
    if (val) process.env[key] = val
  }
} catch {
  console.error('❌  .env.local introuvable. Copier .env.local.example → .env.local et remplir les valeurs.')
  process.exit(1)
}

const { SYNCHROTEAM_DOMAIN, SYNCHROTEAM_API_KEY, SYNCHROTEAM_BASE_URL } = process.env

if (!SYNCHROTEAM_DOMAIN || !SYNCHROTEAM_API_KEY) {
  console.error('❌  SYNCHROTEAM_DOMAIN ou SYNCHROTEAM_API_KEY manquant dans .env.local')
  process.exit(1)
}

const BASE_URL = (SYNCHROTEAM_BASE_URL || 'https://ws.synchroteam.com').replace(/\/$/, '')
const credentials = Buffer.from(`${SYNCHROTEAM_DOMAIN}:${SYNCHROTEAM_API_KEY}`).toString('base64')

const headers = {
  Authorization: `Basic ${credentials}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

// Heuristiques — labels réels confirmés par discovery du 2026-06-22
const HEURISTICS = [
  // Consommables
  { keywords: ['mise en place batterie', 'mise en place batt', 'date usine de la batt',
               'batterie ou pile', 'battery', 'pile'],
    internal: 'battery_expiry',    type: 'date' },
  { keywords: ['dlu électrodes adultes', 'péremption des électrodes adultes', 'électrodes adulte'],
    internal: 'electrodes_expiry', type: 'date' },
  { keywords: ['dlu électrodes pédiatriques', 'péremption des électrodes pédiat', 'électrodes pédiat'],
    internal: 'electrodes_expiry', type: 'date' },
  // Identification appareil
  { keywords: ["n° de série du défibrillateur", 'numéro de série du défibrillateur'],
    internal: 'serial_number',     type: 'text' },
  { keywords: ['marque/modèle', 'marque', 'modèle'],
    internal: 'model',             type: 'text' },
  { keywords: ['date usine du défibrillateur', 'date usine'],
    internal: 'manufacture_date',  type: 'date' },
  // Localisation
  { keywords: ['emplacement'],
    internal: 'location_detail',   type: 'text' },
  { keywords: ['code armoire'],
    internal: 'cabinet_code',      type: 'text' },
  { keywords: ['zone géographique', 'zone geographique'],
    internal: 'zone_geographique', type: 'text' },
  { keywords: ['identifiant geo dae', 'geo dae', 'identifiant dae'],
    internal: 'geo_dae_id',        type: 'number' },
  // Contrat
  { keywords: ['type de contrat'],
    internal: 'contract_type',     type: 'text' },
  { keywords: ['date de fin de contrat', 'fin de contrat'],
    internal: 'contract_end',      type: 'date' },
  { keywords: ['date de livraison', 'livraison'],
    internal: 'contract_start',    type: 'date' },
  // Équipement annexe
  { keywords: ['kit rcp', 'kit complet', 'kit paire', 'kit rasoir', 'kit protection', 'kit gant'],
    internal: 'kit_rcp',           type: 'text' },
  { keywords: ["n° de série de l'appareil de prêt", 'appareil de prêt', 'prêt'],
    internal: 'loan_serial_number', type: 'text' },
  { keywords: ['registre défibrillateur', 'registre star'],
    internal: 'registre_star_aid', type: 'text' },
  // Notes
  { keywords: ['commentaires', 'commentaire', 'notes', 'remarque'],
    internal: 'notes',             type: 'text' },
]

function guessInternalField(label, fieldType) {
  const lower = label.toLowerCase()
  for (const h of HEURISTICS) {
    if (h.keywords.some((k) => lower.includes(k))) {
      return { internal: h.internal, type: fieldType === 'date' ? 'date' : h.type }
    }
  }
  return null
}

async function apiGet(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  const res = await fetch(url.toString(), { method: 'GET', headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 300)}`)
  }
  return res.json()
}

async function probeAuth() {
  const url = `${BASE_URL}/Api/v3/customer/list?pageSize=1`
  console.log(`\n🔬  Probe auth — GET ${url}`)
  const res = await fetch(url, { method: 'GET', headers })
  const text = await res.text()
  console.log(`    Status  : ${res.status} ${res.statusText}`)
  console.log(`    Preview : ${text.slice(0, 120)}`)
  if (!res.ok) {
    console.error('\n❌  Auth échouée. Vérifier SYNCHROTEAM_DOMAIN et SYNCHROTEAM_API_KEY.')
    console.error(`    Domain lu : "${SYNCHROTEAM_DOMAIN}"`)
    process.exit(1)
  }
  console.log('✅  Auth OK\n')
}

async function fetchCustomFields() {
  console.log(`📡  GET /Api/v3/customfield/list?type=equipment`)
  const data = await apiGet('/Api/v3/customfield/list', { type: 'equipment', pageSize: 100 })
  return data.data ?? []
}

async function fetchEquipmentSample() {
  const data = await apiGet('/Api/v3/equipment/list', { pageSize: 1, page: 1 })
  return data.data?.[0] ?? null
}

async function main() {
  console.log('='.repeat(60))
  console.log('  STAR aid — Discovery Synchroteam Custom Fields')
  console.log('='.repeat(60))
  console.log(`  Domain  : ${SYNCHROTEAM_DOMAIN}`)
  console.log(`  Base URL: ${BASE_URL}`)
  console.log('='.repeat(60))

  await probeAuth()

  const [fields, sampleEquipment] = await Promise.all([
    fetchCustomFields(),
    fetchEquipmentSample(),
  ])

  console.log(`✅  ${fields.length} champ(s) custom trouvé(s) pour type=equipment\n`)

  if (fields.length === 0) {
    console.log('⚠️  Aucun custom field configuré dans Synchroteam.')
    process.exit(0)
  }

  // Tableau récapitulatif
  console.log('┌────────┬──────────────────────────────────────────┬──────────┬─────────────────────────┐')
  console.log('│ ID     │ Label Synchroteam                        │ Type     │ Champ interne suggéré   │')
  console.log('├────────┼──────────────────────────────────────────┼──────────┼─────────────────────────┤')

  const mappings = []
  for (const field of fields) {
    const guess = guessInternalField(field.label, field.type)
    const internalLabel = guess ? guess.internal : '⚠️  Manuel'
    const id      = String(field.id).padEnd(6)
    const label   = field.label.slice(0, 40).padEnd(40)
    const type    = (field.type ?? 'text').padEnd(8)
    const internal = internalLabel.slice(0, 23).padEnd(23)
    console.log(`│ ${id} │ ${label} │ ${type} │ ${internal} │`)
    mappings.push({ id: field.id, label: field.label, type: field.type ?? 'text', guess })
  }
  console.log('└────────┴──────────────────────────────────────────┴──────────┴─────────────────────────┘')

  // Échantillon équipement (structure raw)
  if (sampleEquipment) {
    console.log('\n📋  Échantillon équipement (structure raw) :')
    console.log(JSON.stringify(sampleEquipment, null, 2).slice(0, 2000))
    if (JSON.stringify(sampleEquipment).length > 2000) console.log('  ... (tronqué)')
  }

  // SQL INSERT
  const mapped   = mappings.filter((m) => m.guess)
  const unmapped = mappings.filter((m) => !m.guess)

  if (mapped.length > 0) {
    console.log('\n\n📄  SQL à coller dans Supabase SQL Editor :')
    console.log('─'.repeat(60))
    console.log('INSERT INTO custom_field_mapping')
    console.log('  (synchroteam_field_id, synchroteam_label, internal_field, field_type)')
    console.log('VALUES')
    const rows = mapped.map(
      (m) => `  (${m.id}, '${m.label.replace(/'/g, "''")}', '${m.guess.internal}', '${m.guess.type}')`
    )
    console.log(rows.join(',\n'))
    console.log('ON CONFLICT (synchroteam_field_id) DO UPDATE SET')
    console.log('  synchroteam_label = EXCLUDED.synchroteam_label,')
    console.log('  internal_field    = EXCLUDED.internal_field,')
    console.log('  field_type        = EXCLUDED.field_type,')
    console.log('  updated_at        = NOW();')
    console.log('─'.repeat(60))
  }

  if (unmapped.length > 0) {
    console.log('\n⚠️  Champs non mappés automatiquement :')
    for (const m of unmapped) {
      console.log(`   ID ${m.id} — "${m.label}" (type: ${m.type})`)
    }
    console.log('   → /admin/field-mapping dans le dashboard pour les mapper.')
  }

  console.log('\n✅  Discovery terminée.\n')
}

main().catch((err) => {
  console.error('❌  Erreur inattendue :', err)
  process.exit(1)
})
