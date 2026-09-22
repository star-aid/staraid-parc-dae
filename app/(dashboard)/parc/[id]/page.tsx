export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import dynamicImport from 'next/dynamic'
import { DAEStatusBadge } from '@/components/table/StatusBadge'
import BackButton from '@/components/BackButton'
import {
  Card, EmptyState, PageContainer, cx,
  tableClass, tbodyClass, tdClass, thClass, theadClass, trClass,
} from '@/components/ui/primitives'

const DetailMap = dynamicImport(() => import('./DetailMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[260px] animate-pulse items-center justify-center bg-slate-100 text-xs text-slate-400">
      Chargement de la carte…
    </div>
  ),
})

// ─── Types ────────────────────────────────────────────────────────────────────

type DaeDetail = {
  id: string
  serial_number: string | null
  model: string | null
  brand: string | null
  status: string
  status_reason: string | null
  last_maintenance_date: string | null
  next_maintenance_date: string | null
  battery_install_date: string | null
  battery_expiry: string | null
  battery_status: string
  electrodes_adult_expiry: string | null
  electrodes_pediatric_expiry: string | null
  electrodes_status: string
  contract_type: string | null
  contract_start: string | null
  contract_end: string | null
  manufacture_date: string | null
  location_detail: string | null
  zone_geographique: string | null
  cabinet_code: string | null
  kit_rcp: boolean | null
  registre_star_aid: boolean | null
  clients: { name: string; address: string | null; city: string | null; contact_email: string | null; contact_phone: string | null } | null
  sites: { name: string; address: string | null; city: string | null; latitude: number | null; longitude: number | null } | null
  territories: { code: string; name: string } | null
}

type Intervention = {
  id: string
  type: string | null
  status: string | null
  scheduled_date: string | null
  completed_date: string | null
  technician_name: string | null
  duration_minutes: number | null
  report: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return d
  }
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  return Math.floor((new Date(d).getTime() - Date.now()) / 86_400_000)
}

function progressPct(installDate: string | null, expiryDate: string | null): number {
  if (!expiryDate) return 0
  const expiry = new Date(expiryDate).getTime()
  const today  = Date.now()
  const start  = installDate
    ? new Date(installDate).getTime()
    : expiry - 2 * 365.25 * 24 * 3600 * 1000  // repli : durée de vie 2 ans

  if (today >= expiry) return 100
  if (today <= start)  return 0
  return Math.round(((today - start) / (expiry - start)) * 100)
}

function barColor(expiryDate: string | null): string {
  const days = daysUntil(expiryDate)
  if (days === null)  return 'bg-slate-300'
  if (days < 30)      return 'bg-red-500'
  if (days < 180)     return 'bg-amber-500'
  return 'bg-emerald-500'
}

function daysBadge(days: number | null): { label: string; cls: string } | null {
  if (days === null) return null
  if (days < 0)   return { label: `${Math.abs(days)} j de dépassement`, cls: 'bg-red-50 text-red-700 ring-red-600/20' }
  if (days < 30)  return { label: `${days} j restants`, cls: 'bg-amber-50 text-amber-800 ring-amber-500/30' }
  if (days < 180) return { label: `${days} j restants`, cls: 'bg-slate-100 text-slate-600 ring-slate-300' }
  return { label: `${days} j restants`, cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' }
}

function dateTone(d: string | null): string {
  const days = daysUntil(d)
  if (days === null) return ''
  if (days < 0)  return 'text-red-700'
  if (days < 30) return 'text-amber-700'
  return ''
}

const JOB_TYPE_LABEL: Record<string, string> = {
  maintenance:  'Maintenance',
  depannage:    'Dépannage',
  installation: 'Installation',
  autre:        'Autre',
}

// Types d'intervention : couleurs catégorielles, distinctes des couleurs de statut
const JOB_TYPE_CLASS: Record<string, string> = {
  maintenance:  'bg-blue-50 text-blue-700 ring-blue-600/20',
  depannage:    'bg-orange-50 text-orange-700 ring-orange-600/20',
  installation: 'bg-teal-50 text-teal-700 ring-teal-600/20',
  autre:        'bg-slate-100 text-slate-600 ring-slate-300',
}

const JOB_STATUS_LABEL: Record<string, string> = {
  termine:  'Terminée',
  planifie: 'Planifiée',
  en_cours: 'En cours',
  annule:   'Annulée',
}

const JOB_STATUS_CLASS: Record<string, string> = {
  termine:  'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  planifie: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  en_cours: 'bg-amber-50 text-amber-800 ring-amber-500/30',
  annule:   'bg-slate-100 text-slate-500 ring-slate-300 line-through',
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-2xs font-semibold ring-1 ring-inset', className)}>
      {children}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="text-right text-13 font-medium text-slate-800">{value ?? <span className="text-slate-300">—</span>}</dd>
    </div>
  )
}

function YesNo({ value }: { value: boolean | null }) {
  if (value === null) return null
  return value ? <span className="text-emerald-700">Oui</span> : <span className="text-slate-400">Non</span>
}

function ConsumableBar({ label, installDate, expiryDate }: { label: string; installDate?: string | null; expiryDate?: string | null }) {
  const pct   = progressPct(installDate ?? null, expiryDate ?? null)
  const days  = daysUntil(expiryDate ?? null)
  const badge = daysBadge(days)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-13 font-medium text-slate-800">{label}</span>
        {badge && <Pill className={cx(badge.cls, 'tabular-nums')}>{badge.label}</Pill>}
      </div>

      {expiryDate ? (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={cx('h-full rounded-full', barColor(expiryDate))} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-2xs text-slate-400 tabular-nums">
            {installDate
              ? <span>Installée le {fmtDate(installDate)}</span>
              : <span className="italic">Date d&apos;installation inconnue</span>}
            <span className={cx('font-medium', dateTone(expiryDate) || 'text-slate-600')}>Expire le {fmtDate(expiryDate)}</span>
          </div>
        </>
      ) : installDate ? (
        <p className="text-2xs text-slate-400">
          Installée le {fmtDate(installDate)} · <span className="italic">date d&apos;expiration non renseignée dans Synchroteam</span>
        </p>
      ) : (
        <p className="text-xs italic text-slate-400">Non renseigné</p>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface Props {
  params: { id: string }
}

export default async function ParcDetailPage({ params }: Props) {
  const supabase = createServiceClient()

  const daeRes = await supabase
    .from('defibrillators')
    .select(`
      id, serial_number, model, brand, status, status_reason,
      last_maintenance_date, next_maintenance_date,
      battery_install_date, battery_expiry, battery_status,
      electrodes_adult_expiry, electrodes_pediatric_expiry, electrodes_status,
      contract_type, contract_start, contract_end,
      manufacture_date, location_detail, zone_geographique, cabinet_code,
      kit_rcp, registre_star_aid, site_id,
      clients(name, address, city, contact_email, contact_phone),
      sites(name, address, city, latitude, longitude),
      territories(code, name)
    `)
    .eq('id', params.id)
    .single()

  if (daeRes.error || !daeRes.data) notFound()

  const d = daeRes.data as unknown as DaeDetail & { site_id: string | null }

  // Interventions : par DAE direct OU par site (jobs Synchroteam souvent liés au site, pas à l'équipement)
  const orFilter = d.site_id
    ? `defibrillator_id.eq.${params.id},site_id.eq.${d.site_id}`
    : `defibrillator_id.eq.${params.id}`

  const interventionsRes = await supabase
    .from('interventions')
    .select('id, type, status, scheduled_date, completed_date, technician_name, duration_minutes, report')
    .or(orFilter)
    .order('completed_date', { ascending: false, nullsFirst: false })
    .order('scheduled_date', { ascending: false })
    .limit(50)

  const ivs = (interventionsRes.data ?? []) as Intervention[]

  const client    = d.clients as DaeDetail['clients']
  const site      = d.sites as DaeDetail['sites']
  const territory = d.territories as DaeDetail['territories']

  const hasGPS = !!(site?.latitude && site?.longitude)

  // Technicien le plus récent (depuis les interventions de maintenance)
  const lastMaintTech = ivs.find((i) => i.type === 'maintenance' && i.technician_name)?.technician_name ?? null

  const lastMaintDays = daysUntil(d.last_maintenance_date)
  const pediatricFirst = !!d.electrodes_pediatric_expiry &&
    (!d.electrodes_adult_expiry || d.electrodes_pediatric_expiry < d.electrodes_adult_expiry)

  return (
    <PageContainer>
      {/* ── Fil d'Ariane ────────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-center gap-2 text-13 text-slate-500">
        <BackButton label="Parc DAE" />
        <span className="text-slate-300">/</span>
        <span className="truncate font-medium text-slate-700">{d.serial_number ?? `Fiche ${d.id.slice(0, 8)}`}</span>
      </div>

      {/* ── En-tête ─────────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <DAEStatusBadge status={d.status} />
              {territory && <span>{territory.name}</span>}
              {d.status_reason && <span>· {d.status_reason}</span>}
            </div>
            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900">
              {[d.brand, d.model].filter(Boolean).join(' · ') || 'Modèle non renseigné'}
            </h1>
            {d.serial_number && (
              <p className="mt-1.5">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-13 text-slate-700">{d.serial_number}</span>
              </p>
            )}
          </div>

          <div className="shrink-0 text-13 sm:text-right">
            {client && <p className="font-semibold text-slate-800">{client.name}</p>}
            {site && <p className="text-slate-600">{site.name}</p>}
            {site?.city && <p className="text-xs text-slate-400">{site.city}</p>}
          </div>
        </div>
      </Card>

      {/* ── Consommables · Maintenance · Contrat ────────────────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Consommables">
          <div className="space-y-5">
            <ConsumableBar label="Batterie" installDate={d.battery_install_date} expiryDate={d.battery_expiry} />
            {pediatricFirst ? (
              <>
                <ConsumableBar label="Électrodes pédiatriques" expiryDate={d.electrodes_pediatric_expiry} />
                <ConsumableBar label="Électrodes adultes" expiryDate={d.electrodes_adult_expiry} />
              </>
            ) : (
              <>
                <ConsumableBar label="Électrodes adultes" expiryDate={d.electrodes_adult_expiry} />
                {d.electrodes_pediatric_expiry && (
                  <ConsumableBar label="Électrodes pédiatriques" expiryDate={d.electrodes_pediatric_expiry} />
                )}
              </>
            )}
            {!d.battery_expiry && !d.electrodes_adult_expiry && (
              <p className="py-2 text-center text-xs italic text-slate-400">Aucune date de consommable renseignée</p>
            )}
          </div>
        </Card>

        <Card title="Maintenance">
          <dl>
            <InfoRow
              label="Dernière intervention"
              value={d.last_maintenance_date ? (
                <span className="tabular-nums">
                  {fmtDate(d.last_maintenance_date)}
                  {lastMaintDays !== null && <span className="ml-1.5 text-xs font-normal text-slate-400">il y a {Math.abs(lastMaintDays)} j</span>}
                </span>
              ) : null}
            />
            <InfoRow
              label="Prochaine maintenance"
              value={d.next_maintenance_date ? <span className={cx('tabular-nums', dateTone(d.next_maintenance_date))}>{fmtDate(d.next_maintenance_date)}</span> : null}
            />
            <InfoRow label="Technicien" value={lastMaintTech} />
          </dl>
          {ivs.length === 0 && <p className="mt-3 text-center text-xs italic text-slate-400">Aucune intervention enregistrée</p>}
        </Card>

        <Card title="Contrat et informations">
          <dl>
            <InfoRow label="Type de contrat" value={d.contract_type} />
            <InfoRow label="Début de contrat" value={d.contract_start ? <span className="tabular-nums">{fmtDate(d.contract_start)}</span> : null} />
            <InfoRow label="Fin de contrat" value={d.contract_end ? <span className={cx('tabular-nums', dateTone(d.contract_end))}>{fmtDate(d.contract_end)}</span> : null} />
            <InfoRow label="Date de fabrication" value={d.manufacture_date ? <span className="tabular-nums">{fmtDate(d.manufacture_date)}</span> : null} />
            <InfoRow label="Zone géographique" value={d.zone_geographique} />
            {d.cabinet_code && <InfoRow label="Code armoire" value={d.cabinet_code} />}
            {d.location_detail && <InfoRow label="Emplacement" value={d.location_detail} />}
            <InfoRow label="Kit RCP" value={<YesNo value={d.kit_rcp} />} />
            <InfoRow label="Registre STAR aid" value={<YesNo value={d.registre_star_aid} />} />
          </dl>
        </Card>
      </div>

      {/* ── Localisation + carte ────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Localisation">
          {client && (
            <div className="mb-4">
              <p className="mb-1 text-2xs font-medium uppercase tracking-wider text-slate-400">Client</p>
              <p className="text-13 font-semibold text-slate-800">{client.name}</p>
              {client.address && <p className="text-13 text-slate-500">{client.address}</p>}
              {client.city && <p className="text-13 text-slate-500">{client.city}</p>}
              {(client.contact_phone || client.contact_email) && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {client.contact_phone && (
                    <a href={`tel:${client.contact_phone}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 9.77 19.79 19.79 0 0 1 1.62 6.06 2 2 0 0 1 3.64 4h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 11.5a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      {client.contact_phone}
                    </a>
                  )}
                  {client.contact_email && (
                    <a href={`mailto:${client.contact_email}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                      {client.contact_email}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {site && (
            <div>
              <p className="mb-1 text-2xs font-medium uppercase tracking-wider text-slate-400">Site</p>
              <p className="text-13 font-semibold text-slate-800">{site.name}</p>
              {site.address && <p className="text-13 text-slate-500">{site.address}</p>}
              {site.city && <p className="text-13 text-slate-500">{site.city}</p>}
              {hasGPS && (
                <p className="mt-1.5 font-mono text-2xs text-slate-400 tabular-nums">
                  {site.latitude?.toFixed(5)}, {site.longitude?.toFixed(5)}
                </p>
              )}
            </div>
          )}

          {!client && !site && <p className="text-xs italic text-slate-400">Aucune information de localisation</p>}
        </Card>

        <Card title="Carte" padded={false} bodyClassName="h-[280px] overflow-hidden rounded-b-lg">
          {hasGPS ? (
            <DetailMap latitude={site!.latitude!} longitude={site!.longitude!} siteName={site?.name ?? null} status={d.status} />
          ) : (
            <EmptyState className="flex h-full flex-col items-center justify-center gap-1 py-0">
              <span className="font-medium text-slate-500">Coordonnées GPS non disponibles</span>
              <span className="text-xs">Le site n&apos;a pas de position enregistrée</span>
            </EmptyState>
          )}
        </Card>
      </div>

      {/* ── Historique des interventions ────────────────────────────────────── */}
      <Card
        title={<>Historique des interventions{ivs.length > 0 && <span className="ml-1.5 font-normal text-slate-400 tabular-nums">({ivs.length})</span>}</>}
        padded={false}
      >
        {ivs.length === 0 ? (
          <EmptyState>Aucune intervention enregistrée pour ce DAE.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  {['Date', 'Type', 'Technicien', 'Durée', 'Statut', 'Rapport'].map((h) => (
                    <th key={h} className={thClass}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className={tbodyClass}>
                {ivs.map((iv) => {
                  const dateRef   = iv.completed_date ?? iv.scheduled_date
                  const typeKey   = iv.type ?? 'autre'
                  const statusKey = iv.status ?? 'planifie'
                  const min = iv.duration_minutes
                  const durationLabel = min
                    ? min >= 60 ? `${Math.floor(min / 60)} h${min % 60 > 0 ? ` ${min % 60} min` : ''}` : `${min} min`
                    : null

                  return (
                    <tr key={iv.id} className={trClass}>
                      <td className={cx(tdClass, 'whitespace-nowrap font-medium text-slate-800 tabular-nums')}>{fmtDate(dateRef)}</td>
                      <td className={cx(tdClass, 'whitespace-nowrap')}>
                        <Pill className={JOB_TYPE_CLASS[typeKey] ?? JOB_TYPE_CLASS.autre}>{JOB_TYPE_LABEL[typeKey] ?? typeKey}</Pill>
                      </td>
                      <td className={cx(tdClass, 'whitespace-nowrap text-slate-700')}>{iv.technician_name ?? <span className="text-slate-300">—</span>}</td>
                      <td className={cx(tdClass, 'whitespace-nowrap text-slate-500 tabular-nums')}>{durationLabel ?? <span className="text-slate-300">—</span>}</td>
                      <td className={cx(tdClass, 'whitespace-nowrap')}>
                        <Pill className={JOB_STATUS_CLASS[statusKey] ?? JOB_STATUS_CLASS.planifie}>{JOB_STATUS_LABEL[statusKey] ?? statusKey}</Pill>
                      </td>
                      <td className={cx(tdClass, 'max-w-sm')}>
                        {iv.report
                          ? <span className="block truncate text-xs text-slate-500" title={iv.report}>{iv.report}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  )
}
