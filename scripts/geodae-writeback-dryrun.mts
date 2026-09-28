// Simulation du report d'identifiant Géo'DAE vers Synchroteam, sans aucune écriture.
// À lancer avant d'activer le report sur un compte (Réunion, Mayotte, Guadeloupe) :
// vérifie le mapping du champ « Identifiant GEO DAE », la relecture d'un équipement
// et les garde-fous (n° de série divergent, champ déjà renseigné, idempotence).
//
// Usage : npm run geodae:dryrun -- REU|MYT|GLP        (défaut : REU)
// Prérequis : .env avec SYNCHROTEAM_DOMAIN[_MYT|_GLP], SYNCHROTEAM_API_KEY[_MYT|_GLP],
//             NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from 'node:fs'

for (const raw of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(raw.trim())
  if (!m) continue
  let v = m[2].trim()
  const q = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v)
  if (q) v = q[1]
  if (process.env[m[1]] === undefined) process.env[m[1]] = v
}

const { createSynchroteamClient, extractCustomFields } = await import('@/lib/synchroteam')
const { buildAccounts } = await import('@/lib/sync-territory-route')
const { resolveMappings } = await import('@/lib/geodae/extract-synchroteam')
const { loadDbMappings } = await import('@/lib/geodae/mappings')
const { writeGeoDaeId } = await import('@/lib/geodae/writeback')

const account = ((process.argv[2] ?? 'REU').toUpperCase()) as 'REU' | 'MYT' | 'GLP'
if (!['REU', 'MYT', 'GLP'].includes(account)) { console.error('Compte attendu : REU, MYT ou GLP'); process.exit(1) }

const acc = buildAccounts(account)
if (!acc) { console.error(`Compte ${account} non configuré : variables SYNCHROTEAM_* absentes du .env`); process.exit(1) }
const client = createSynchroteamClient(acc.domain, acc.key)

const { mappings: db, warning } = await loadDbMappings()
console.log(`compte ${account} · mapping base : ${db.length} lignes${warning ? ` (${warning})` : ''}`)
const { mappings, source } = await resolveMappings(client, db)
const geo = mappings.find((m) => m.internal_field === 'geo_dae_id')
const serial = mappings.find((m) => m.internal_field === 'serial_number')
console.log('mapping résolu :', source)
console.log('champ identifiant Géo\'DAE :', geo ? `${geo.synchroteam_field_id} « ${geo.synchroteam_label} » (${geo.field_type})` : 'NON RÉSOLU → report impossible')
console.log('champ n° de série          :', serial ? `${serial.synchroteam_field_id} « ${serial.synchroteam_label} »` : 'NON RÉSOLU')
if (!geo) process.exit(2)

// Première page des équipements actifs : un sans identifiant, un avec
const page = await client.fetchAllPages<Record<string, unknown>>('/Api/v3/equipment/list', { pageSize: 100 }).then((all) => all.slice(0, 100))
const rows = page.map((eq) => ({ eq, cf: extractCustomFields(eq, mappings) }))
const sans = rows.find((r) => r.cf.serial_number && !r.cf.geo_dae_id)
const avec = rows.find((r) => r.cf.serial_number && r.cf.geo_dae_id)
console.log('exemples :', sans ? `sans identifiant → équipement ${sans.eq.id} (série ${sans.cf.serial_number})` : 'aucun DAE sans identifiant dans l\'échantillon',
  '|', avec ? `avec identifiant → équipement ${avec.eq.id} (série ${avec.cf.serial_number}, id ${avec.cf.geo_dae_id})` : 'aucun DAE avec identifiant dans l\'échantillon')

const show = (label: string, r: unknown) => console.log(label.padEnd(36), JSON.stringify(r))
if (sans) {
  show('1. simulation sur un DAE sans id', await writeGeoDaeId({ account, synchroteam_id: String(sans.eq.id), serial_number: sans.cf.serial_number, gid: '999999' }, db, { dryRun: true }))
  show('2. n° de série divergent (refus)', await writeGeoDaeId({ account, synchroteam_id: String(sans.eq.id), serial_number: 'MAUVAIS-SERIE', gid: '999999' }, db, { dryRun: true }))
}
if (avec) {
  show('3. champ déjà renseigné (refus)', await writeGeoDaeId({ account, synchroteam_id: String(avec.eq.id), serial_number: avec.cf.serial_number, gid: '999999' }, db, { dryRun: true }))
  show('4. même identifiant (idempotent)', await writeGeoDaeId({ account, synchroteam_id: String(avec.eq.id), serial_number: avec.cf.serial_number, gid: String(avec.cf.geo_dae_id) }, db, { dryRun: true }))
}
show('5. identifiant invalide (refus)', await writeGeoDaeId({ account, synchroteam_id: '1', serial_number: null, gid: 'a b' }, db, { dryRun: true }))
console.log('Aucune écriture effectuée.')
