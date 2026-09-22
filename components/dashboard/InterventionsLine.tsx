'use client'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { EmptyState } from '@/components/ui/primitives'

interface MonthlyRow {
  month: string       // YYYY-MM
  total: number
  maintenance: number
  depannage: number
}

interface Props {
  data: MonthlyRow[]
}

// Séries catégorielles (palette validée : bleu / aqua / orange, ordre fixe).
// Distinctes des couleurs de statut pour qu'une série ne se fasse jamais passer pour un état.
const SERIES = [
  { key: 'total',       name: 'Total',       color: '#2a78d6', width: 2 },
  { key: 'maintenance', name: 'Maintenance', color: '#1baf7a', width: 1.5 },
  { key: 'depannage',   name: 'Dépannage',   color: '#eb6834', width: 1.5 },
] as const

const AXIS_TICK = { fontSize: 11, fill: '#64748b' }

function formatMonth(ym: string) {
  const [y, m] = ym.split('-')
  const d = new Date(parseInt(y), parseInt(m) - 1, 1)
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}

export default function InterventionsLine({ data }: Props) {
  const formatted = data.map((r) => ({ ...r, label: formatMonth(r.month) }))

  if (formatted.length === 0) {
    return <EmptyState className="h-44 py-0 flex items-center justify-center">Aucune donnée</EmptyState>
  }

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={formatted} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
            contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px -8px rgb(15 23 42 / 0.18)', padding: '6px 10px' }}
            labelStyle={{ fontWeight: 600, color: '#0f172a', marginBottom: 2 }}
            itemStyle={{ padding: 0, color: '#334155' }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 6, color: '#475569' }} />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={s.width}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
