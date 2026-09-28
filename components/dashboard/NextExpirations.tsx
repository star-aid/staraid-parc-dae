import Link from 'next/link'
import { CalendarCheck } from 'lucide-react'
import type { ParkSummary, TerritoryCode } from '@/types'
import { EmptyState, Tag, tableClass, tbodyClass, tdClass, thClass, theadClass, trClass, type TagTone } from '@/components/ui/primitives'

type Expiration = ParkSummary['next_expirations'][number]

const TERRITORY_LABELS: Record<TerritoryCode, string> = {
  REU: 'Réunion',
  MYT: 'Mayotte',
  GLP: 'Guadeloupe',
}

const OVERDUE_REASONS = new Set(['Maintenance échue', 'Batterie expirée', 'Électrodes expirées'])

// Pastille de date : rouge si dépassée ou sous 7 jours, ambre sous 30 jours, sinon verte
function urgencyTone(dateStr: string): TagTone {
  const days = (new Date(dateStr).getTime() - Date.now()) / 86_400_000
  if (days <= 7)  return 'danger'
  if (days <= 30) return 'warning'
  return 'success'
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function NextExpirations({ items }: { items: Expiration[] }) {
  if (items.length === 0) {
    return <EmptyState compact icon={CalendarCheck} title="Aucune échéance à venir" description="Aucun DAE en vigilance ou critique sur ce périmètre." />
  }

  return (
    <div className="-mx-4 -mb-4 overflow-x-auto">
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th className={thClass}>DAE</th>
            <th className={thClass}>Client</th>
            <th className={thClass}>Territoire</th>
            <th className={thClass}>Raison</th>
            <th className={`${thClass} text-right`}>Échéance</th>
          </tr>
        </thead>
        <tbody className={tbodyClass}>
          {items.map((item) => (
            <tr key={item.id} className={trClass}>
              <td className={tdClass}>
                <Link
                  prefetch={false}
                  href={`/parc/${item.id}`}
                  className="font-mono text-caption font-semibold text-fg hover:text-brand hover:underline"
                >
                  {item.serial_number ?? item.model ?? item.id.slice(0, 8)}
                </Link>
              </td>
              <td className={`${tdClass} max-w-[180px] truncate`}>{item.client_name ?? '—'}</td>
              <td className={`${tdClass} text-caption text-fg-muted`}>
                {item.territory_code ? (TERRITORY_LABELS[item.territory_code] ?? item.territory_code) : '—'}
              </td>
              <td className={tdClass}>
                <span className={`text-caption font-semibold ${OVERDUE_REASONS.has(item.reason) ? 'text-danger' : 'text-fg-secondary'}`}>
                  {item.reason}
                </span>
              </td>
              <td className={`${tdClass} text-right`}>
                <Tag tone={urgencyTone(item.next_date)} className="tabular-nums">{formatDate(item.next_date)}</Tag>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
