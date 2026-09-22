'use client'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

interface Props {
  conforme: number
  vigilance: number
  critique: number
  inconnu: number
  total: number
}

// Couleurs de statut (sémantiques, jamais réutilisées pour des séries).
// L'orange est sous 3:1 sur blanc : la légende porte toujours libellé + compte.
const SLICES = [
  { key: 'conforme',  label: 'Conforme',  color: '#059669' },
  { key: 'vigilance', label: 'Vigilance', color: '#f59e0b' },
  { key: 'critique',  label: 'Critique',  color: '#dc2626' },
  { key: 'inconnu',   label: 'Inconnu',   color: '#94a3b8' },
] as const

interface TooltipProps {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: { color: string } }>
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  const { name, value, payload: { color } } = payload[0]
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-pop">
      <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} />
      <span className="font-medium text-slate-800">{name}</span>
      <span className="ml-2 text-slate-500 tabular-nums">{value.toLocaleString('fr-FR')} DAE</span>
    </div>
  )
}

export default function StatusDonut({ conforme, vigilance, critique, inconnu, total }: Props) {
  const counts: Record<(typeof SLICES)[number]['key'], number> = { conforme, vigilance, critique, inconnu }
  const data = SLICES.map((s) => ({ name: s.label, value: counts[s.key], color: s.color })).filter((d) => d.value > 0)

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={56}
              outerRadius={78}
              paddingAngle={2}
              cornerRadius={3}
              dataKey="value"
              stroke="#ffffff"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{total.toLocaleString('fr-FR')}</span>
          <span className="text-2xs font-medium uppercase tracking-wider text-slate-400">DAE</span>
        </div>
      </div>

      {/* Légende avec compte et part : identité jamais portée par la couleur seule */}
      <ul className="flex-1 space-y-1.5">
        {SLICES.map((s) => {
          const n = counts[s.key]
          const share = total > 0 ? Math.round((n / total) * 100) : 0
          return (
            <li key={s.key} className="flex items-center gap-2 text-13">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
              <span className="flex-1 text-slate-600">{s.label}</span>
              <span className="font-medium text-slate-900 tabular-nums">{n.toLocaleString('fr-FR')}</span>
              <span className="w-9 text-right text-xs text-slate-400 tabular-nums">{share} %</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
