import type { DAEStatus, BatteryStatus } from '@/types'
import { Tag, cx, type TagTone } from '@/components/ui/primitives'

// Couleurs de statut : réservées à la sémantique conforme / vigilance / critique.
// Chaque badge porte un point coloré ET un libellé : la couleur n'est jamais seule.
const DAE_TONE: Record<DAEStatus, TagTone> = {
  conforme:  'success',
  vigilance: 'warning',
  critique:  'danger',
  inconnu:   'neutral',
}

const DAE_LABEL: Record<DAEStatus, string> = {
  conforme:  'Conforme',
  vigilance: 'Vigilance',
  critique:  'Critique',
  inconnu:   'Inconnu',
}

const BATTERY_CLASS: Record<BatteryStatus, string> = {
  ok:          'text-success',
  a_remplacer: 'text-warning',
  expire:      'text-danger',
  inconnu:     'text-fg-faint',
}

const BATTERY_LABEL: Record<BatteryStatus, string> = {
  ok:          'OK',
  a_remplacer: 'À remplacer',
  expire:      'Expirée',
  inconnu:     '—',
}

export function DAEStatusBadge({ status }: { status: string }) {
  const s = ((status ?? 'inconnu') in DAE_TONE ? status : 'inconnu') as DAEStatus
  return <Tag tone={DAE_TONE[s]} dot>{DAE_LABEL[s]}</Tag>
}

export function ConsumableStatus({ status, date }: { status: string; date: string | null }) {
  const s = ((status ?? 'inconnu') in BATTERY_CLASS ? status : 'inconnu') as BatteryStatus
  const formatted = date
    ? new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : null
  return (
    <span className={cx('whitespace-nowrap text-caption font-semibold', BATTERY_CLASS[s])}>
      {BATTERY_LABEL[s]}
      {formatted && <span className="ml-1 font-normal text-fg-faint tabular-nums">{formatted}</span>}
    </span>
  )
}
