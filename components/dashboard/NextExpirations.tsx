import Link from 'next/link'
import type { ParkSummary, TerritoryCode } from '@/types'
import { EmptyState, tableClass, tbodyClass, tdClass, thClass, theadClass, trClass } from '@/components/ui/primitives'

type Expiration = ParkSummary['next_expirations'][number]

const TERRITORY_LABELS: Record<TerritoryCode, string> = {
  REU: 'Réunion',
  MYT: 'Mayotte',
  GLP: 'Guadeloupe',
}

const OVERDUE_REASONS = new Set(['Maintenance échue', 'Batterie expirée', 'Électrodes expirées'])

// Pastille de date : rouge si dépassée ou sous 7 jours, orange sous 30 jours, sinon verte
function urgencyClass(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const days = (d.getTime() - now.getTime()) / 86_400_000
  if (days <= 7)  return 'bg-red-50 text-red-700 ring-red-600/20'
  if (days <= 30) return 'bg-amber-50 text-amber-800 ring-amber-500/30'
  return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function NextExpirations({ items }: { items: Expiration[] }) {
  if (items.length === 0) {
    return <EmptyState className="py-8">Aucune échéance à venir</EmptyState>
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
                  href={`/parc/${item.id}`}
                  className="font-mono text-xs font-medium text-slate-800 hover:text-brand hover:underline"
                >
                  {item.serial_number ?? item.model ?? item.id.slice(0, 8)}
                </Link>
              </td>
              <td className={`${tdClass} max-w-[180px] truncate text-slate-600`}>{item.client_name ?? '—'}</td>
              <td className={`${tdClass} text-xs text-slate-500`}>
                {item.territory_code ? (TERRITORY_LABELS[item.territory_code] ?? item.territory_code) : '—'}
              </td>
              <td className={tdClass}>
                <span className={`text-xs font-medium ${OVERDUE_REASONS.has(item.reason) ? 'text-red-700' : 'text-slate-600'}`}>
                  {item.reason}
                </span>
              </td>
              <td className={`${tdClass} text-right`}>
                <span className={`inline-flex whitespace-nowrap rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset tabular-nums ${urgencyClass(item.next_date)}`}>
                  {formatDate(item.next_date)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
