'use client'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

interface Props {
  conforme: number
  vigilance: number
  critique: number
  inconnu: number
  total: number
}

const SLICES = [
  { key: 'conforme',  label: 'Conforme',  color: '#10b981' },
  { key: 'vigilance', label: 'Vigilance', color: '#f59e0b' },
  { key: 'critique',  label: 'Critique',  color: '#ef4444' },
  { key: 'inconnu',   label: 'Inconnu',   color: '#94a3b8' },
]

interface TooltipProps {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: { color: string } }>
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  const { name, value, payload: { color } } = payload[0]
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg text-sm">
      <span style={{ color }} className="font-semibold">{name}</span>
      <span className="ml-2 text-slate-600">{value} DAE</span>
    </div>
  )
}

export default function StatusDonut({ conforme, vigilance, critique, inconnu, total }: Props) {
  const data = SLICES.map((s) => ({
    name: s.label,
    value: s.key === 'conforme' ? conforme : s.key === 'vigilance' ? vigilance : s.key === 'critique' ? critique : inconnu,
    color: s.color,
  })).filter((d) => d.value > 0)

  return (
    <div className="relative h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={88}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {/* Centre label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-bold text-slate-800">{total.toLocaleString('fr-FR')}</span>
        <span className="text-xs text-slate-500 mt-0.5">DAE total</span>
      </div>
      {/* Légende */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-4 text-xs">
        {SLICES.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: s.color }} />
            <span className="text-slate-500">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
