import type { DAEStatus, BatteryStatus } from '@/types'

// Couleurs de statut : réservées à la sémantique conforme / vigilance / critique.
// Chaque badge porte un point coloré ET un libellé : la couleur n'est jamais seule.
const DAE_BADGE: Record<DAEStatus, string> = {
  conforme:  'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  vigilance: 'bg-amber-50 text-amber-800 ring-amber-500/30',
  critique:  'bg-red-50 text-red-700 ring-red-600/20',
  inconnu:   'bg-slate-100 text-slate-600 ring-slate-300',
}

const DAE_DOT: Record<DAEStatus, string> = {
  conforme:  'bg-emerald-500',
  vigilance: 'bg-amber-500',
  critique:  'bg-red-500',
  inconnu:   'bg-slate-400',
}

const DAE_LABEL: Record<DAEStatus, string> = {
  conforme:  'Conforme',
  vigilance: 'Vigilance',
  critique:  'Critique',
  inconnu:   'Inconnu',
}

const BATTERY_CLASS: Record<BatteryStatus, string> = {
  ok:          'text-emerald-700',
  a_remplacer: 'text-amber-700',
  expire:      'text-red-700',
  inconnu:     'text-slate-400',
}

const BATTERY_LABEL: Record<BatteryStatus, string> = {
  ok:          'OK',
  a_remplacer: 'À remplacer',
  expire:      'Expirée',
  inconnu:     '—',
}

export function DAEStatusBadge({ status }: { status: string }) {
  const s = ((status ?? 'inconnu') in DAE_BADGE ? status : 'inconnu') as DAEStatus
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-2xs font-semibold ring-1 ring-inset ${DAE_BADGE[s]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DAE_DOT[s]}`} aria-hidden />
      {DAE_LABEL[s]}
    </span>
  )
}

export function ConsumableStatus({ status, date }: { status: string; date: string | null }) {
  const s = ((status ?? 'inconnu') in BATTERY_CLASS ? status : 'inconnu') as BatteryStatus
  const formatted = date
    ? new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : null
  return (
    <span className={`whitespace-nowrap text-xs font-medium ${BATTERY_CLASS[s]}`}>
      {BATTERY_LABEL[s]}
      {formatted && <span className="ml-1 font-normal text-slate-400 tabular-nums">{formatted}</span>}
    </span>
  )
}
