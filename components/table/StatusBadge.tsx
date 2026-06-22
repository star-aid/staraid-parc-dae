import type { DAEStatus, BatteryStatus } from '@/types'

const DAE_BADGE: Record<DAEStatus, string> = {
  conforme:  'bg-emerald-100 text-emerald-700 ring-emerald-200',
  vigilance: 'bg-amber-100 text-amber-700 ring-amber-200',
  critique:  'bg-red-100 text-red-700 ring-red-200',
  inconnu:   'bg-slate-100 text-slate-500 ring-slate-200',
}

const DAE_LABEL: Record<DAEStatus, string> = {
  conforme:  'Conforme',
  vigilance: 'Vigilance',
  critique:  'Critique',
  inconnu:   'Inconnu',
}

const BATTERY_BADGE: Record<BatteryStatus, string> = {
  ok:          'text-emerald-600',
  a_remplacer: 'text-amber-600',
  expire:      'text-red-600',
  inconnu:     'text-slate-400',
}

const BATTERY_LABEL: Record<BatteryStatus, string> = {
  ok:          'OK',
  a_remplacer: 'À remplacer',
  expire:      'Expirée',
  inconnu:     '—',
}

export function DAEStatusBadge({ status }: { status: string }) {
  const s = (status ?? 'inconnu') as DAEStatus
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${DAE_BADGE[s] ?? DAE_BADGE.inconnu}`}>
      {DAE_LABEL[s] ?? s}
    </span>
  )
}

export function ConsumableStatus({ status, date }: { status: string; date: string | null }) {
  const s = (status ?? 'inconnu') as BatteryStatus
  const formatted = date
    ? new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : null
  return (
    <span className={`text-xs font-medium ${BATTERY_BADGE[s] ?? BATTERY_BADGE.inconnu}`}>
      {BATTERY_LABEL[s]}
      {formatted && <span className="ml-1 text-slate-400 font-normal">{formatted}</span>}
    </span>
  )
}
