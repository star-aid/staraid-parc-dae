export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { DAEStatusBadge } from '@/components/table/StatusBadge'

const DetailMap = dynamicImport(() => import('./DetailMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full min-h-[220px] bg-slate-100 rounded-lg animate-pulse flex items-center justify-center text-xs text-slate-400">
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
    : expiry - 2 * 365.25 * 24 * 3600 * 1000  // fallback : durée de vie 2 ans

  if (today >= expiry) return 100
  if (today <= start)  return 0
  return Math.round(((today - start) / (expiry - start)) * 100)
}

function barColor(expiryDate: string | null): string {
  const days = daysUntil(expiryDate)
  if (days === null)  return 'bg-slate-300'
  if (days < 0)       return 'bg-red-500'
  if (days < 30)      return 'bg-red-400'
  if (days < 180)     return 'bg-amber-400'
  return 'bg-emerald-400'
}

function daysBadge(days: number | null): { label: string; cls: string } | null {
  if (days === null) return null
  if (days < 0)   return { label: `${Math.abs(days)} j de dépassement`, cls: 'bg-red-100 text-red-700' }
  if (days < 30)  return { label: `${days} j restants`, cls: 'bg-amber-100 text-amber-700' }
  if (days < 180) return { label: `${days} j restants`, cls: 'bg-amber-50 text-amber-600' }
  return { label: `${days} j restants`, cls: 'bg-emerald-50 text-emerald-600' }
}

const JOB_TYPE_LABEL: Record<string, string> = {
  maintenance:  'Maintenance',
  depannage:    'Dépannage',
  installation: 'Installation',
  autre:        'Autre',
}

const JOB_TYPE_COLOR: Record<string, string> = {
  maintenance:  'bg-blue-100 text-blue-700',
  depannage:    'bg-red-100 text-red-700',
  installation: 'bg-emerald-100 text-emerald-700',
  autre:        'bg-slate-100 text-slate-600',
}

const JOB_STATUS_LABEL: Record<string, string> = {
  termine:  'Terminée',
  planifie: 'Planifiée',
  en_cours: 'En cours',
  annule:   'Annulée',
}

const JOB_STATUS_COLOR: Record<string, string> = {
  termine:  'bg-emerald-100 text-emerald-700',
  planifie: 'bg-blue-100 text-blue-700',
  en_cours: 'bg-amber-100 text-amber-700',
  annule:   'bg-slate-100 text-slate-500 line-through',
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
      {children}
    </h2>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="text-sm text-slate-800 font-medium text-right">{value ?? '—'}</span>
    </div>
  )
}

function ConsumableBar({
  label,
  installDate,
  expiryDate,
}: {
  label: string
  installDate?: string | null
  expiryDate?: string | null
}) {
  const pct  = progressPct(installDate ?? null, expiryDate ?? null)
  const days = daysUntil(expiryDate ?? null)
  const badge = daysBadge(days)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {badge && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>

      {expiryDate ? (
        <>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor(expiryDate ?? null)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            {installDate
              ? <span>Installation : {fmtDate(installDate)}</span>
              : <span className="italic">Date d&apos;installation inconnue</span>
            }
            <span className={`font-medium ${(days ?? 1) < 0 ? 'text-red-600' : (days ?? 999) < 30 ? 'text-amber-600' : 'text-slate-600'}`}>
              Exp. {fmtDate(expiryDate ?? null)}
            </span>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400 italic">Non renseigné</p>
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

  const [daeRes, interventionsRes] = await Promise.all([
    supabase
      .from('defibrillators')
      .select(`
        id, serial_number, model, brand, status, status_reason,
        last_maintenance_date, next_maintenance_date,
        battery_install_date, battery_expiry, battery_status,
        electrodes_adult_expiry, electrodes_pediatric_expiry, electrodes_status,
        contract_type, contract_start, contract_end,
        manufacture_date, location_detail, zone_geographique, cabinet_code,
        kit_rcp, registre_star_aid,
        clients(name, address, city, contact_email, contact_phone),
        sites(name, address, city, latitude, longitude),
        territories(code, name)
      `)
      .eq('id', params.id)
      .single(),

    supabase
      .from('interventions')
      .select('id, type, status, scheduled_date, completed_date, technician_name, duration_minutes, report')
      .eq('defibrillator_id', params.id)
      .order('completed_date', { ascending: false, nullsFirst: false })
      .order('scheduled_date', { ascending: false })
      .limit(20),
  ])

  if (daeRes.error || !daeRes.data) notFound()

  const d  = daeRes.data as unknown as DaeDetail
  const ivs = (interventionsRes.data ?? []) as Intervention[]

  const client    = d.clients as DaeDetail['clients']
  const site      = d.sites as DaeDetail['sites']
  const territory = d.territories as DaeDetail['territories']

  const hasGPS = !!(site?.latitude && site?.longitude)

  // Technicien le plus récent (depuis les interventions de maintenance)
  const lastMaintTech = ivs.find((i) => i.type === 'maintenance' && i.technician_name)?.technician_name ?? null

  return (
    <div className="p-6 lg:p-8 max-w-screen-xl mx-auto space-y-6">

      {/* ── Fil d'Ariane + retour ───────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/parc" className="hover:text-slate-800 transition-colors flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Parc DAE
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-medium truncate">
          {d.serial_number ?? `Fiche ${d.id.slice(0, 8)}`}
        </span>
      </div>

      {/* ── En-tête principal ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          {/* Icône DAE */}
          <div className="shrink-0 w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-7 h-7 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>

          {/* Identité DAE */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <DAEStatusBadge status={d.status} />
              {territory && (
                <span className="text-xs text-slate-400 font-medium">{territory.name}</span>
              )}
            </div>
            <h1 className="text-xl font-bold text-slate-800 truncate">
              {[d.brand, d.model].filter(Boolean).join(' — ') || 'Modèle non renseigné'}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              {d.serial_number && (
                <span className="font-mono text-sm text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                  {d.serial_number}
                </span>
              )}
              {d.status_reason && (
                <span className="text-sm text-slate-500 italic">{d.status_reason}</span>
              )}
            </div>
          </div>

          {/* Client / Site résumé */}
          <div className="text-right text-sm shrink-0">
            {client && <p className="font-semibold text-slate-700">{client.name}</p>}
            {site    && <p className="text-slate-500">{site.name}</p>}
            {site?.city && <p className="text-slate-400 text-xs">{site.city}</p>}
          </div>
        </div>
      </div>

      {/* ── Ligne 1 : Consommables · Maintenance · Contrat & Infos ─────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Consommables */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <SectionTitle>Consommables</SectionTitle>
          <div className="space-y-6">
            <ConsumableBar
              label="Batterie"
              installDate={d.battery_install_date}
              expiryDate={d.battery_expiry}
            />
            <ConsumableBar
              label="Électrodes adulte"
              expiryDate={d.electrodes_adult_expiry}
            />
            {d.electrodes_pediatric_expiry && (
              <ConsumableBar
                label="Électrodes pédiatrique"
                expiryDate={d.electrodes_pediatric_expiry}
              />
            )}
            {!d.battery_expiry && !d.electrodes_adult_expiry && (
              <p className="text-sm text-slate-400 italic text-center py-4">
                Aucune date de consommable renseignée
              </p>
            )}
          </div>
        </div>

        {/* Maintenance */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <SectionTitle>Maintenance</SectionTitle>
          <div className="space-y-0.5">
            <InfoRow
              label="Dernière intervention"
              value={
                d.last_maintenance_date ? (
                  <span>
                    {fmtDate(d.last_maintenance_date)}
                    {(() => {
                      const days = daysUntil(d.last_maintenance_date)
                      if (days === null) return null
                      return (
                        <span className="ml-1.5 text-xs text-slate-400 font-normal">
                          (il y a {Math.abs(days)} j)
                        </span>
                      )
                    })()}
                  </span>
                ) : null
              }
            />
            <InfoRow
              label="Prochaine maintenance"
              value={
                d.next_maintenance_date ? (
                  <span className={daysUntil(d.next_maintenance_date) !== null && (daysUntil(d.next_maintenance_date) ?? 1) < 0 ? 'text-red-600' : daysUntil(d.next_maintenance_date) !== null && (daysUntil(d.next_maintenance_date) ?? 999) < 30 ? 'text-amber-600' : ''}>
                    {fmtDate(d.next_maintenance_date)}
                  </span>
                ) : null
              }
            />
            <InfoRow
              label="Technicien"
              value={lastMaintTech}
            />
          </div>

          {ivs.length === 0 && (
            <p className="text-xs text-slate-400 italic mt-4 text-center">Aucune intervention enregistrée</p>
          )}
        </div>

        {/* Contrat & infos */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <SectionTitle>Contrat &amp; Informations</SectionTitle>
          <div className="space-y-0.5">
            <InfoRow label="Type de contrat"   value={d.contract_type} />
            <InfoRow label="Début contrat"     value={fmtDate(d.contract_start)} />
            <InfoRow label="Fin contrat"       value={fmtDate(d.contract_end)} />
            <InfoRow label="Date de fabrication" value={fmtDate(d.manufacture_date)} />
            <InfoRow label="Zone géographique" value={d.zone_geographique} />
            {d.cabinet_code && (
              <InfoRow label="Code cabinet" value={d.cabinet_code} />
            )}
            {d.location_detail && (
              <InfoRow label="Localisation détail" value={d.location_detail} />
            )}
            <InfoRow
              label="Kit RCP"
              value={
                d.kit_rcp === null ? null
                  : d.kit_rcp
                    ? <span className="text-emerald-600 font-semibold">Oui</span>
                    : <span className="text-slate-400">Non</span>
              }
            />
            <InfoRow
              label="Registre STAR aid"
              value={
                d.registre_star_aid === null ? null
                  : d.registre_star_aid
                    ? <span className="text-emerald-600 font-semibold">Oui</span>
                    : <span className="text-slate-400">Non</span>
              }
            />
          </div>
        </div>
      </div>

      {/* ── Ligne 2 : Localisation + Carte ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Localisation textuelle */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <SectionTitle>Localisation</SectionTitle>

          {client && (
            <div className="mb-5">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Client</p>
              <p className="font-semibold text-slate-800">{client.name}</p>
              {client.address && <p className="text-sm text-slate-500">{client.address}</p>}
              {client.city    && <p className="text-sm text-slate-500">{client.city}</p>}
              <div className="mt-2 flex flex-wrap gap-3">
                {client.contact_phone && (
                  <a href={`tel:${client.contact_phone}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 9.77 19.79 19.79 0 0 1 1.62 6.06 2 2 0 0 1 3.64 4h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 11.5a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    {client.contact_phone}
                  </a>
                )}
                {client.contact_email && (
                  <a href={`mailto:${client.contact_email}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    {client.contact_email}
                  </a>
                )}
              </div>
            </div>
          )}

          {site && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Site</p>
              <p className="font-semibold text-slate-700">{site.name}</p>
              {site.address && <p className="text-sm text-slate-500">{site.address}</p>}
              {site.city    && <p className="text-sm text-slate-500">{site.city}</p>}
              {hasGPS && (
                <p className="text-xs text-slate-400 mt-1.5">
                  GPS : {site.latitude?.toFixed(5)}, {site.longitude?.toFixed(5)}
                </p>
              )}
            </div>
          )}

          {!client && !site && (
            <p className="text-sm text-slate-400 italic">Aucune information de localisation</p>
          )}
        </div>

        {/* Carte */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-h-[260px]">
          {hasGPS ? (
            <DetailMap
              latitude={site!.latitude!}
              longitude={site!.longitude!}
              siteName={site?.name ?? null}
              status={d.status}
            />
          ) : (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center gap-3 text-slate-400">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-slate-200" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <div className="text-center">
                <p className="text-sm font-medium text-slate-500">Coordonnées GPS non disponibles</p>
                <p className="text-xs text-slate-400 mt-0.5">Le site n&apos;a pas de position enregistrée</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Historique interventions ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Historique interventions
            {ivs.length > 0 && (
              <span className="ml-2 text-slate-300 font-normal normal-case">
                — {ivs.length} enregistrée{ivs.length > 1 ? 's' : ''}
              </span>
            )}
          </h2>
        </div>

        {ivs.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            Aucune intervention enregistrée pour ce DAE.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Date', 'Type', 'Technicien', 'Durée', 'Statut', 'Rapport'].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {ivs.map((iv) => {
                  const dateRef = iv.completed_date ?? iv.scheduled_date
                  const typeKey = iv.type ?? 'autre'
                  const statusKey = iv.status ?? 'planifie'
                  const durationMin = iv.duration_minutes
                  const durationLabel = durationMin
                    ? durationMin >= 60
                      ? `${Math.floor(durationMin / 60)} h ${durationMin % 60 > 0 ? `${durationMin % 60} min` : ''}`
                      : `${durationMin} min`
                    : null

                  return (
                    <tr key={iv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap tabular-nums text-slate-700 font-medium">
                        {fmtDate(dateRef)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ${JOB_TYPE_COLOR[typeKey] ?? JOB_TYPE_COLOR.autre}`}>
                          {JOB_TYPE_LABEL[typeKey] ?? typeKey}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600 whitespace-nowrap">
                        {iv.technician_name ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap tabular-nums">
                        {durationLabel ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ${JOB_STATUS_COLOR[statusKey] ?? JOB_STATUS_COLOR.planifie}`}>
                          {JOB_STATUS_LABEL[statusKey] ?? statusKey}
                        </span>
                      </td>
                      <td className="px-5 py-3 max-w-xs">
                        {iv.report ? (
                          <span className="block truncate text-slate-500 text-xs" title={iv.report}>
                            {iv.report}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
