'use client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { TerritoryCode } from '@/types'

interface TerritoryStats {
  total: number
  conforme: number
  vigilance: number
  critique: number
  inconnu: number
}

interface Props {
  byTerritory: Partial<Record<TerritoryCode, TerritoryStats>>
}

const TERRITORY_LABELS: Record<TerritoryCode, string> = {
  REU: 'La Réunion',
  MYT: 'Mayotte',
  GLP: 'Guadeloupe',
}

const COLORS = {
  Conforme:  '#10b981',
  Vigilance: '#f59e0b',
  Critique:  '#ef4444',
  Inconnu:   '#94a3b8',
}

export default function TerritoryBars({ byTerritory }: Props) {
  const data = (Object.entries(byTerritory) as [TerritoryCode, TerritoryStats][]).map(([code, s]) => ({
    name: TERRITORY_LABELS[code] ?? code,
    Conforme:  s.conforme,
    Vigilance: s.vigilance,
    Critique:  s.critique,
    Inconnu:   s.inconnu,
  }))

  if (data.length === 0) {
    return <div className="h-48 flex items-center justify-center text-sm text-slate-400">Aucune donnée</div>
  }

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            cursor={{ fill: '#f8fafc' }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
          <Bar dataKey="Conforme"  fill={COLORS.Conforme}  radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Vigilance" fill={COLORS.Vigilance} radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Critique"  fill={COLORS.Critique}  radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Inconnu"   fill={COLORS.Inconnu}   radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
