'use client'
import { useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const TERRITORIES = [
  { code: 'REU', label: 'La Réunion', activeClass: 'bg-[#AF2125] border-[#AF2125] text-white' },
  { code: 'GLP', label: 'Guadeloupe', activeClass: 'bg-indigo-600 border-indigo-600 text-white' },
  { code: 'MYT', label: 'Mayotte',    activeClass: 'bg-teal-600 border-teal-600 text-white' },
]

export default function TerritoryFilterBar() {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const active    = sp.get('territoire') ?? ''
  const actif     = sp.get('actif') ?? 'actif'

  const navigate = useCallback(
    (params: URLSearchParams) => {
      params.delete('page')
      startTransition(() => router.push(`?${params.toString()}`, { scroll: false }))
    },
    [router]
  )

  function navigateTerr(code: string) {
    const p = new URLSearchParams(sp.toString())
    if (code === active || code === '') p.delete('territoire')
    else p.set('territoire', code)
    navigate(p)
  }

  function navigateActif(val: string) {
    const p = new URLSearchParams(sp.toString())
    if (val === 'actif') p.delete('actif')
    else p.set('actif', val)
    navigate(p)
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 transition-opacity ${isPending ? 'opacity-50' : ''}`}>
      {/* Territoire */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 font-medium shrink-0">Territoire :</span>
        <button
          onClick={() => navigateTerr('')}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
            !active
              ? 'bg-slate-700 border-slate-700 text-white'
              : 'border-slate-200 text-slate-400 bg-white hover:border-slate-300 hover:text-slate-600'
          }`}
        >
          Tous
        </button>
        {TERRITORIES.map(({ code, label, activeClass }) => (
          <button
            key={code}
            onClick={() => navigateTerr(code)}
            className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
              active === code
                ? activeClass
                : 'border-slate-200 text-slate-400 bg-white hover:border-slate-300 hover:text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Actif / Inactif */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 font-medium shrink-0">Équipements :</span>
        <select
          value={actif}
          onChange={(e) => navigateActif(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700"
        >
          <option value="actif">Actifs uniquement</option>
          <option value="inactif">Inactifs uniquement</option>
          <option value="tous">Tous</option>
        </select>
      </div>
    </div>
  )
}
