import Link from 'next/link'
import type { ParkSummary, TerritoryCode } from '@/types'

type Expiration = ParkSummary['next_expirations'][number]

const TERRITORY_LABELS: Record<TerritoryCode, string> = {
  REU: 'Réunion',
  MYT: 'Mayotte',
  GLP: 'Guadeloupe',
}

const REASON_CLASSES: Record<string, string> = {
  'Maintenance échue':    'text-red-600',
  'Batterie expirée':     'text-red-600',
  'Électrodes expirées':  'text-red-600',
}

function urgencyClass(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  if (d < now) return 'bg-red-50 text-red-700 ring-red-200'
  const days = (d.getTime() - now.getTime()) / 86_400_000
  if (days <= 7)  return 'bg-red-50 text-red-700 ring-red-200'
  if (days <= 30) return 'bg-amber-50 text-amber-700 ring-amber-200'
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function NextExpirations({ items }: { items: Expiration[] }) {
  if (items.length === 0) {
    return (
      <div className="text-sm text-slate-400 text-center py-8">
        Aucune échéance à venir
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs uppercase tracking-wide">DAE</th>
            <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Client</th>
            <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Territoire</th>
            <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Raison</th>
            <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map((item) => {
            const badgeCls = urgencyClass(item.next_date)
            return (
              <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-2.5 px-3">
                  <Link
                    href={`/parc/${item.id}`}
                    className="font-mono text-xs text-blue-600 hover:underline"
                  >
                    {item.serial_number ?? item.model ?? item.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="py-2.5 px-3 text-slate-600 max-w-[160px] truncate">
                  {item.client_name ?? '—'}
                </td>
                <td className="py-2.5 px-3">
                  {item.territory_code ? (
                    <span className="text-xs text-slate-500">
                      {TERRITORY_LABELS[item.territory_code] ?? item.territory_code}
                    </span>
                  ) : '—'}
                </td>
                <td className="py-2.5 px-3">
                  <span className={`text-xs font-medium ${REASON_CLASSES[item.reason] ?? 'text-slate-600'}`}>
                    {item.reason}
                  </span>
                </td>
                <td className="py-2.5 px-3">
                  <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ring-1 ${badgeCls}`}>
                    {formatDate(item.next_date)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
