/**
 * Vérification post-sync : contrôle qualité des données en base Supabase
 * Usage : node scripts/verify-sync.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '../.env.local')

try {
  const env = readFileSync(envPath, 'utf8')
  for (const line of env.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const val = trimmed.slice(eqIndex + 1).replace(/\s+#.*$/, '').trim()
    if (val) process.env[key] = val
  }
} catch {
  console.error('❌  .env.local introuvable')
  process.exit(1)
}

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!BASE || !KEY) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant')
  process.exit(1)
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'count=exact',
}

async function count(table, filter = '') {
  const url = `${BASE}/rest/v1/${table}?select=id${filter ? `&${filter}` : ''}`
  const res = await fetch(url, { headers: { ...headers, Prefer: 'count=exact' }, method: 'HEAD' })
  return parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10)
}

async function query(table, select, filter = '', limit = 5) {
  const url = `${BASE}/rest/v1/${table}?select=${select}${filter ? `&${filter}` : ''}&limit=${limit}`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

async function rpc(fn) {
  const url = `${BASE}/rest/v1/rpc/${fn}`
  const res = await fetch(url, { method: 'POST', headers, body: '{}' })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

function bar(n, total, width = 20) {
  const filled = Math.round((n / Math.max(total, 1)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function pct(n, total) {
  return total ? `${Math.round((n / total) * 100)}%` : '—'
}

async function main() {
  console.log('\n' + '═'.repeat(62))
  console.log('  STAR aid — Vérification post-sync Synchroteam')
  console.log('═'.repeat(62))

  // ── Comptages ────────────────────────────────────────────────
  console.log('\n📊  VOLUMES\n')
  const tables = ['clients', 'sites', 'defibrillators', 'technicians', 'interventions', 'sync_logs']
  for (const t of tables) {
    const n = await count(t)
    console.log(`  ${t.padEnd(18)} ${String(n).padStart(6)} enregistrements`)
  }

  // ── DAE : répartition statuts ─────────────────────────────────
  console.log('\n📡  DAE — STATUTS\n')
  const total = await count('defibrillators')
  const conforme  = await count('defibrillators', 'status=eq.conforme')
  const vigilance = await count('defibrillators', 'status=eq.vigilance')
  const critique  = await count('defibrillators', 'status=eq.critique')
  const inconnu   = await count('defibrillators', 'status=eq.inconnu')

  console.log(`  conforme   ${bar(conforme,  total)} ${String(conforme).padStart(5)}  (${pct(conforme, total)})`)
  console.log(`  vigilance  ${bar(vigilance, total)} ${String(vigilance).padStart(5)}  (${pct(vigilance, total)})`)
  console.log(`  critique   ${bar(critique,  total)} ${String(critique).padStart(5)}  (${pct(critique, total)})`)
  console.log(`  inconnu    ${bar(inconnu,   total)} ${String(inconnu).padStart(5)}  (${pct(inconnu, total)})`)

  // ── DAE : couverture données ──────────────────────────────────
  console.log('\n🔍  DAE — QUALITÉ DES DONNÉES\n')
  const withSerial     = await count('defibrillators', 'serial_number=not.is.null')
  const withBattery    = await count('defibrillators', 'battery_expiry=not.is.null')
  const withElecAdult  = await count('defibrillators', 'electrodes_adult_expiry=not.is.null')
  const withClient     = await count('defibrillators', 'client_id=not.is.null')
  const withSite       = await count('defibrillators', 'site_id=not.is.null')
  const withTerritory  = await count('defibrillators', 'territory_id=not.is.null')

  const fields = [
    ['N° série renseigné',      withSerial],
    ['Batterie renseignée',      withBattery],
    ['Électrodes adultes',       withElecAdult],
    ['Client lié',               withClient],
    ['Site lié',                 withSite],
    ['Territoire détecté',       withTerritory],
  ]
  for (const [label, n] of fields) {
    const ok = n === total ? '✅' : n > total * 0.8 ? '🟡' : '🔴'
    console.log(`  ${ok} ${label.padEnd(24)} ${String(n).padStart(5)}/${total}  (${pct(n, total)})`)
  }

  // ── Sites : couverture GPS ────────────────────────────────────
  console.log('\n🗺️   SITES — GPS\n')
  const totalSites  = await count('sites')
  const withGPS     = await count('sites', 'latitude=not.is.null')
  const withoutGPS  = totalSites - withGPS
  console.log(`  Avec GPS         ${bar(withGPS, totalSites)} ${String(withGPS).padStart(5)}  (${pct(withGPS, totalSites)})`)
  console.log(`  Sans GPS         ${bar(withoutGPS, totalSites)} ${String(withoutGPS).padStart(5)}  (${pct(withoutGPS, totalSites)})`)

  // ── Sync logs ────────────────────────────────────────────────
  console.log('\n📋  DERNIÈRES SYNCS\n')
  try {
    const logs = await query('sync_logs', 'source,status,records_synced,started_at,finished_at', 'order=started_at.desc', 5)
    for (const l of logs) {
      const duration = l.finished_at && l.started_at
        ? Math.round((new Date(l.finished_at) - new Date(l.started_at)) / 1000) + 's'
        : '—'
      const icon = l.status === 'success' ? '✅' : l.status === 'running' ? '🔄' : '❌'
      console.log(`  ${icon} ${l.source.padEnd(14)} ${l.status.padEnd(8)} ${String(l.records_synced).padStart(6)} enreg.  ${duration}`)
    }
  } catch (e) {
    console.log('  (logs non accessibles)')
  }

  // ── Échantillon DAE ────────────────────────────────────────────
  console.log('\n🔬  ÉCHANTILLON DAE (5 premiers)\n')
  try {
    const sample = await query(
      'defibrillators',
      'synchroteam_id,serial_number,model,brand,status,battery_expiry,territory_id',
      'order=created_at.asc',
      5
    )
    for (const d of sample) {
      console.log(`  ID ${d.synchroteam_id} | ${(d.brand ?? '—').padEnd(12)} ${(d.model ?? '—').slice(0, 20).padEnd(20)} | ${d.status.padEnd(9)} | batterie: ${d.battery_expiry ?? '—'}`)
    }
  } catch (e) {
    console.log('  (échantillon non accessible)')
  }

  // ── Alertes critiques ─────────────────────────────────────────
  console.log('\n🚨  DAE CRITIQUES (5 premiers)\n')
  try {
    const critical = await query(
      'defibrillators',
      'serial_number,model,status_reason,battery_expiry,electrodes_adult_expiry',
      'status=eq.critique&order=battery_expiry.asc',
      5
    )
    if (critical.length === 0) {
      console.log('  Aucun DAE critique — vérifier si les statuts ont été calculés')
    } else {
      for (const d of critical) {
        console.log(`  🔴 ${(d.serial_number ?? 'SN?').padEnd(15)} ${(d.model ?? '—').slice(0, 20).padEnd(20)} — ${d.status_reason ?? '—'}`)
      }
    }
  } catch (e) {
    console.log('  (données critiques non accessibles)')
  }

  console.log('\n' + '═'.repeat(62))
  console.log('  Vérification terminée.')
  console.log('═'.repeat(62) + '\n')
}

main().catch((err) => {
  console.error('❌  Erreur :', err.message)
  process.exit(1)
})
