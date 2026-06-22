'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const TERRITORIES = [
  { code: 'REU', label: 'La Réunion' },
  { code: 'MYT', label: 'Mayotte' },
  { code: 'GLP', label: 'Guadeloupe' },
]

const STATUTS = [
  { code: 'critique',  label: 'Critique' },
  { code: 'vigilance', label: 'Vigilance' },
  { code: 'conforme',  label: 'Conforme' },
  { code: 'inconnu',   label: 'Inconnu' },
]

interface Props {
  total: number
  shown: number
  csvData: Record<string, string | null>[]
}

function csvEscape(v: string | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadCSV(rows: Record<string, string | null>[], filename: string) {
  if (rows.length === 0) return
  const cols = Object.keys(rows[0])
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function ParcFiltersBar({ total, shown, csvData }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const currentQ = sp.get('q') ?? ''
  const currentTerr = sp.get('territoire')?.split(',').filter(Boolean) ?? []
  const currentStat = sp.get('statut')?.split(',').filter(Boolean) ?? []

  const [inputQ, setInputQ] = useState(currentQ)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync search input with URL (back/forward navigation)
  useEffect(() => { setInputQ(currentQ) }, [currentQ])

  const navigate = useCallback((params: URLSearchParams) => {
    startTransition(() => {
      router.push(`/parc?${params.toString()}`, { scroll: false })
    })
  }, [router])

  function buildParams(overrides: Record<string, string | string[] | null> = {}) {
    const p = new URLSearchParams(sp.toString())
    p.delete('page') // reset à page 1 sur tout changement de filtre
    for (const [k, v] of Object.entries(overrides)) {
      if (v == null || (Array.isArray(v) && v.length === 0) || v === '') p.delete(k)
      else p.set(k, Array.isArray(v) ? v.join(',') : v)
    }
    return p
  }

  function onSearch(value: string) {
    setInputQ(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      navigate(buildParams({ q: value || null }))
    }, 300)
  }

  function toggleTerr(code: string) {
    const next = currentTerr.includes(code)
      ? currentTerr.filter((c) => c !== code)
      : [...currentTerr, code]
    navigate(buildParams({ territoire: next }))
  }

  function toggleStat(code: string) {
    const next = currentStat.includes(code)
      ? currentStat.filter((c) => c !== code)
      : [...currentStat, code]
    navigate(buildParams({ statut: next }))
  }

  function clearAll() {
    navigate(new URLSearchParams())
    setInputQ('')
  }

  const hasFilters = inputQ || currentTerr.length > 0 || currentStat.length > 0
  const STAT_COLORS: Record<string, string> = {
    critique: 'border-red-300 bg-red-50 text-red-700',
    vigilance: 'border-amber-300 bg-amber-50 text-amber-700',
    conforme: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    inconnu: 'border-slate-300 bg-slate-50 text-slate-500',
  }

  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 mb-4 shadow-sm transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap gap-3 items-center">
        {/* Recherche texte */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            value={inputQ}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="N° série, modèle…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Territoire */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-500 font-medium mr-0.5">Territoire :</span>
          {TERRITORIES.map(({ code, label }) => (
            <button
              key={code}
              onClick={() => toggleTerr(code)}
              className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                currentTerr.includes(code)
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Statut */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-500 font-medium mr-0.5">Statut :</span>
          {STATUTS.map(({ code, label }) => (
            <button
              key={code}
              onClick={() => toggleStat(code)}
              className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                currentStat.includes(code)
                  ? STAT_COLORS[code]
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Compteur + actions */}
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button onClick={clearAll} className="text-xs text-slate-500 hover:text-slate-800 underline">
              Effacer
            </button>
          )}
          <span className="text-xs text-slate-400">
            {shown.toLocaleString('fr-FR')} / {total.toLocaleString('fr-FR')} DAE
          </span>
          <button
            onClick={() => downloadCSV(csvData, 'parc-dae.csv')}
            disabled={csvData.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            CSV
          </button>
        </div>
      </div>
    </div>
  )
}
