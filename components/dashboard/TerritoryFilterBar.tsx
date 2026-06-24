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

  const active = sp.get('territoire') ?? ''

  const navigate = useCallback(
    (code: string) => {
      const p = new URLSearchParams(sp.toString())
      if (code === active || code === '') {
        p.delete('territoire')
      } else {
        p.set('territoire', code)
      }
      p.delete('page')
      startTransition(() => router.push(`?${p.toString()}`, { scroll: false }))
    },
    [router, sp, active]
  )

  return (
    <div className={`flex items-center gap-2 transition-opacity ${isPending ? 'opacity-50' : ''}`}>
      <span className="text-xs text-slate-500 font-medium shrink-0">Territoire :</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => navigate('')}
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
            onClick={() => navigate(code)}
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
    </div>
  )
}
