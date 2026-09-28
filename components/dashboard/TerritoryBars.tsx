'use client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { TerritoryCode } from '@/types'
import { EmptyState } from '@/components/ui/primitives'

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

// Mêmes couleurs de statut que le reste de l'application
const SERIES = [
  { key: 'Conforme',  color: '#059669' },
  { key: 'Vigilance', color: '#f59e0b' },
  { key: 'Critique',  color: '#dc2626' },
  { key: 'Inconnu',   color: '#94a3b8' },
] as const

const AXIS_TICK = { fontSize: 11, fill: '#575c6b' }

export default function TerritoryBars({ byTerritory }: Props) {
  const data = (Object.entries(byTerritory) as [TerritoryCode, TerritoryStats][])
    .filter(([, s]) => s.total > 0)
    .map(([code, s]) => ({
      name: TERRITORY_LABELS[code] ?? code,
      Conforme:  s.conforme,
      Vigilance: s.vigilance,
      Critique:  s.critique,
      Inconnu:   s.inconnu,
    }))

  if (data.length === 0) {
    return <EmptyState className="h-44 py-0 flex items-center justify-center">Aucune donnée</EmptyState>
  }

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="28%" barGap={2}>
          <CartesianGrid vertical={false} stroke="#e2e4ea" />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: '#e9ebf1' }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e4ea', boxShadow: '0 8px 24px rgb(15 18 25 / 0.10)', padding: '6px 10px' }}
            labelStyle={{ fontWeight: 600, color: '#171921', marginBottom: 2 }}
            itemStyle={{ padding: 0, color: '#414552' }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 6, color: '#575c6b' }} />
          {SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
