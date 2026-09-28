// Compare les comptages de l'ancienne méthode (N requêtes count HEAD) avec la
// nouvelle fonction SQL get_dashboard_status_counts, sur plusieurs combinaisons
// de filtres, et mesure le temps de chacune. Lecture seule.
// Usage : npx tsx --tsconfig ./tsconfig.json scripts/dashboard-compare-counts.mts   (après npm run db:push)
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import {
  buildContratOrFilter, buildContratSqlParams, parseContratParam, parseAutreTypesParam,
} from '@/lib/contract-groups'

// Charge .env (variables non déjà présentes dans l'environnement)
import { readFileSync } from 'node:fs'
for (const raw of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(raw.trim())
  if (!m) continue
  let v = m[2].trim()
  const q = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v)
  if (q) v = q[1]
  if (process.env[m[1]] === undefined) process.env[m[1]] = v
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents'); process.exit(1) }
const sb = createClient(url, key, { auth: { persistSession: false } })

const STATUSES = ['conforme', 'vigilance', 'critique', 'inconnu'] as const

async function oldCount(status: string | undefined, contrat: string | null, actif: string, clientOr: string | null) {
  let q = sb.from('defibrillators').select('*', { count: 'exact', head: true })
  if (!actif || actif === 'actif') q = q.eq('active', true)
  else if (actif === 'inactif')    q = q.eq('active', false)
  if (status)   q = q.eq('status', status)
  if (contrat)  q = q.or(contrat)
  if (clientOr) q = q.or(clientOr)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

type Row = { territory_code: string | null; dae_status: string | null; dae_count: number }

const cases: Array<{ label: string; contrat?: string; autreTypes?: string; actif: string; clientId?: string }> = [
  { label: 'defaut (actifs)',                         actif: 'actif' },
  { label: 'inactifs',                                actif: 'inactif' },
  { label: 'tous',                                    actif: 'tous' },
  { label: 'location',                                actif: 'actif', contrat: 'location' },
  { label: 'maintenance',                             actif: 'actif', contrat: 'maintenance' },
  { label: 'autres (tous)',                           actif: 'actif', contrat: 'autre' },
  { label: 'autres = sans contrat',                   actif: 'actif', contrat: 'autre', autreTypes: '__sans_contrat__' },
  { label: 'location + autres',                      actif: 'actif', contrat: 'location,autre' },
]

// Un client réel pour tester le filtre client
const { data: someClient } = await sb.from('defibrillators').select('client_id').not('client_id', 'is', null).limit(1).maybeSingle()
if (someClient?.client_id) cases.push({ label: 'client filtré', actif: 'actif', clientId: someClient.client_id as string })

let allOk = true
for (const c of cases) {
  const groups = parseContratParam(c.contrat)
  const autre  = parseAutreTypesParam(c.autreTypes)
  const contratOr  = buildContratOrFilter(groups, autre)
  const contratSql = buildContratSqlParams(groups, autre)

  let clientOr: string | null = null
  if (c.clientId) {
    const { data: cs } = await sb.from('sites').select('id').eq('client_id', c.clientId).limit(100)
    const ids = (cs ?? []).map((s: { id: string }) => s.id)
    clientOr = [`client_id.eq.${c.clientId}`, ...(ids.length ? [`site_id.in.(${ids.join(',')})`] : [])].join(',')
  }

  const t0 = performance.now()
  const oldRes = await Promise.all([undefined, ...STATUSES].map((s) => oldCount(s, contratOr, c.actif, clientOr)))
  const tOld = performance.now() - t0

  const t1 = performance.now()
  const { data, error } = await sb.rpc('get_dashboard_status_counts', {
    p_active: c.actif === 'tous' ? null : c.actif !== 'inactif',
    p_client_id: c.clientId ?? null,
    p_contract_in: contratSql?.contract_in ?? null,
    p_contract_not_in: contratSql?.contract_not_in ?? null,
    p_contract_null: contratSql?.contract_null ?? false,
  })
  const tNew = performance.now() - t1
  if (error) { console.error(`  RPC ERREUR (${c.label}) :`, error.message); allOk = false; continue }

  const rows = (data ?? []) as Row[]
  const agg = { total: 0, conforme: 0, vigilance: 0, critique: 0, inconnu: 0 }
  for (const r of rows) {
    const n = Number(r.dae_count)
    agg.total += n
    if (r.dae_status && r.dae_status in agg) agg[r.dae_status as keyof typeof agg] += n
  }
  const newRes = [agg.total, agg.conforme, agg.vigilance, agg.critique, agg.inconnu]
  const same = JSON.stringify(oldRes) === JSON.stringify(newRes)
  if (!same) allOk = false
  console.log(`${same ? 'OK ' : 'DIFF'}  ${c.label.padEnd(24)} ancien=${JSON.stringify(oldRes)} (${tOld.toFixed(0)} ms, 5 req)  nouveau=${JSON.stringify(newRes)} (${tNew.toFixed(0)} ms, 1 req)`)
}

// Répartition par type de contrat : ancienne lecture (plafonnée à 1000) vs RPC
const { data: oldTypes } = await sb.from('defibrillators').select('contract_type').not('contract_type', 'is', null)
const { data: newTypes, error: e2 } = await sb.rpc('get_contract_type_counts')
if (e2) { console.error('get_contract_type_counts ERREUR :', e2.message); allOk = false }
else {
  const totalNew = (newTypes as Array<{ contract_type: string | null; dae_count: number }>).filter((r) => r.contract_type !== null).reduce((s, r) => s + Number(r.dae_count), 0)
  console.log(`\nTypes de contrat : ancienne lecture ${oldTypes?.length ?? 0} lignes (plafond 1000) — SQL agrégé ${totalNew} DAE avec type${(oldTypes?.length ?? 0) < totalNew ? '  → le plafond tronquait bien les compteurs' : ''}`)
}

// Interventions mensuelles : ancien regroupement JS vs RPC
const from = new Date(); from.setFullYear(from.getFullYear() - 1)
const dateFrom = from.toISOString().split('T')[0]
const oldIv: Array<{ type: string | null; completed_date: string }> = []
for (let p = 0; ; p++) {
  const { data } = await sb.from('interventions').select('type, completed_date').not('completed_date', 'is', null).gte('completed_date', dateFrom).order('completed_date').range(p * 1000, (p + 1) * 1000 - 1)
  if (!data?.length) break
  oldIv.push(...(data as typeof oldIv)); if (data.length < 1000) break
}
const oldMonthly = new Map<string, number>()
for (const iv of oldIv) oldMonthly.set(iv.completed_date.slice(0, 7), (oldMonthly.get(iv.completed_date.slice(0, 7)) ?? 0) + 1)
const { data: newMonthly, error: e3 } = await sb.rpc('get_dashboard_interventions_monthly', { p_months: 12, p_client_id: null })
if (e3) { console.error('get_dashboard_interventions_monthly ERREUR :', e3.message); allOk = false }
else {
  const nm = new Map((newMonthly as Array<{ month: string; total: number }>).map((r) => [r.month, Number(r.total)]))
  const months = new Set([...oldMonthly.keys(), ...nm.keys()])
  let diffs = 0
  for (const m of months) if ((oldMonthly.get(m) ?? 0) !== (nm.get(m) ?? 0)) { diffs++; console.log(`  DIFF mois ${m} : ancien ${oldMonthly.get(m) ?? 0} / nouveau ${nm.get(m) ?? 0}`) }
  console.log(`Interventions mensuelles : ${months.size} mois compares, ${diffs} différence(s) (ancien ${oldIv.length} lignes lues)`)
  if (diffs) allOk = false
}

console.log(allOk ? '\nRESULTAT : identique sur tous les cas' : '\nRESULTAT : des différences existent, voir ci-dessus')
assert.ok(allOk)
