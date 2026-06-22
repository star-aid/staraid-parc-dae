/**
 * Script de discovery Synchroteam
 *
 * Usage :
 *   node scripts/discover-synchroteam.mjs
 *
 * Prérequis : .env.local rempli avec SYNCHROTEAM_DOMAIN et SYNCHROTEAM_API_KEY
 *
 * Ce script :
 *  1. Appelle POST /api/v3/customfield/list (body: { type: "equipment" })
 *  2. Affiche la structure réelle des champs DAE
 *  3. Propose un mapping automatique vers les champs internes connus
 *  4. Génère un SQL INSERT prêt à coller dans Supabase
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '../.env.local')

// Charger .env.local manuellement (sans dotenv)
try {
  const env = readFileSync(envPath, 'utf8')
  for (const line of env.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const val = trimmed.slice(eqIndex + 1).trim()
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

const BASE_URL = SYNCHROTEAM_BASE_URL || 'https://ws.synchroteam.com'
const credentials = Buffer.from(`${SYNCHROTEAM_DOMAIN}:${SYNCHROTEAM_API_KEY}`).toString('base64')

const headers = {
  Authorization: `Basic ${credentials}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

// Mapping heuristique : mots-clés dans le label → champ interne
const HEURISTICS = [
  { keywords: ['batterie', 'battery', 'pile'],         internal: 'battery_expiry',      type: 'date' },
  { keywords: ['électrode', 'electrode', 'pad'],       internal: 'electrodes_expiry',   type: 'date' },
  { keywords: ['série', 'serial', 'sn', 'n° série'],  internal: 'serial_number',        type: 'text' },
  { keywords: ['modèle', 'model', 'référence', 'ref'], internal: 'model',               type: 'text' },
  { keywords: ['marque', 'brand', 'fabricant'],        internal: 'brand',               type: 'text' },
  { keywords: ['maintenance', 'entretien', 'visite'],  internal: 'next_maintenance_date', type: 'date' },
  { keywords: ['contrat', 'contract'],                 internal: 'contract_type',        type: 'text' },
  { keywords: ['installation', 'pose', 'mise en service'], internal: 'contract_start',  type: 'date' },
  { keywords: ['note', 'commentaire', 'remarque'],     internal: 'notes',               type: 'text' },
]

function guessInternalField(label, fieldType) {
  const lower = label.toLowerCase()
  for (const h of HEURISTICS) {
    if (h.keywords.some((k) => lower.includes(k))) {
      // Affiner le type si le champ est détecté comme date dans Synchroteam
      const resolvedType = fieldType === 'date' ? 'date' : h.type
      return { internal: h.internal, type: resolvedType }
    }
  }
  return null
}

async function apiPost(endpoint, body = {}) {
  const url = `${BASE_URL}${endpoint}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function fetchCustomFields() {
  const endpoint = '/api/v3/customfield/list'
  console.log(`\n📡  POST ${BASE_URL}${endpoint}  body: { type: "equipment", pageSize: 100 }\n`)

  const data = await apiPost(endpoint, { type: 'equipment', pageSize: 100 })
  return data.data ?? []
}

async function fetchEquipmentSample() {
  // Récupérer 1 équipement pour voir la structure des custom_fields réels
  const data = await apiPost('/api/v3/equipment/list', { pageSize: 1, page: 1 })
  return data.data?.[0] ?? null
}

async function main() {
  console.log('='.repeat(60))
  console.log('  STAR aid — Discovery Synchroteam Custom Fields')
  console.log('='.repeat(60))
  console.log(`  Domain  : ${SYNCHROTEAM_DOMAIN}`)
  console.log(`  Base URL: ${BASE_URL}`)
  console.log('='.repeat(60))

  const [fields, sampleEquipment] = await Promise.all([
    fetchCustomFields(),
    fetchEquipmentSample(),
  ])

  console.log(`\n✅  ${fields.length} champ(s) custom trouvé(s) pour type=equipment\n`)

  if (fields.length === 0) {
    console.log('⚠️  Aucun custom field configuré dans Synchroteam.')
    console.log('   Les dates de batterie, électrodes et N° série doivent être')
    console.log('   créées dans : Configuration > Custom Fields > Equipment\n')
    process.exit(0)
  }

  // Tableau récapitulatif
  console.log('┌────────┬──────────────────────────────────────────┬──────────┬─────────────────────────┐')
  console.log('│ ID     │ Label Synchroteam                        │ Type     │ Champ interne suggéré   │')
  console.log('├────────┼──────────────────────────────────────────┼──────────┼─────────────────────────┤')

  const mappings = []

  for (const field of fields) {
    const guess = guessInternalField(field.label, field.type)
    const internalLabel = guess ? guess.internal : '⚠️  À mapper manuellement'
    const id = String(field.id).padEnd(6)
    const label = field.label.slice(0, 40).padEnd(40)
    const type = (field.type ?? 'text').padEnd(8)
    const internal = internalLabel.slice(0, 23).padEnd(23)
    console.log(`│ ${id} │ ${label} │ ${type} │ ${internal} │`)
    mappings.push({ id: field.id, label: field.label, type: field.type ?? 'text', guess })
  }

  console.log('└────────┴──────────────────────────────────────────┴──────────┴─────────────────────────┘')

  // Échantillon équipement
  if (sampleEquipment) {
    console.log('\n📋  Échantillon équipement (structure raw) :')
    console.log(JSON.stringify(sampleEquipment, null, 2).slice(0, 2000))
    if (JSON.stringify(sampleEquipment).length > 2000) console.log('  ... (tronqué)')
  }

  // Générer SQL INSERT pour custom_field_mapping
  const mapped = mappings.filter((m) => m.guess)
  const unmapped = mappings.filter((m) => !m.guess)

  if (mapped.length > 0) {
    console.log('\n\n📄  SQL à coller dans Supabase SQL Editor :')
    console.log('─'.repeat(60))
    console.log('INSERT INTO custom_field_mapping')
    console.log('  (synchroteam_field_id, synchroteam_label, internal_field, field_type)')
    console.log('VALUES')
    const rows = mapped.map(
      (m) =>
        `  (${m.id}, '${m.label.replace(/'/g, "''")}', '${m.guess.internal}', '${m.guess.type}')`
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
    console.log('\n⚠️  Champs NON mappés automatiquement (à configurer manuellement) :')
    for (const m of unmapped) {
      console.log(`   ID ${m.id} — "${m.label}" (type: ${m.type})`)
    }
    console.log('\n   → Utiliser /admin/field-mapping dans le dashboard pour les mapper.')
  }

  console.log('\n✅  Discovery terminée.\n')
}

main().catch((err) => {
  console.error('❌  Erreur inattendue :', err)
  process.exit(1)
})
