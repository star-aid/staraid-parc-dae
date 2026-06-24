'use client'
import { useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { type ContratGroup, ALL_GROUPS, isAllSelected } from '@/lib/contract-groups'

const GROUPS_CONFIG: {
  code: ContratGroup
  label: string
  activeClass: string
  tooltip: string[]
}[] = [
  {
    code: 'location',
    label: 'Location',
    activeClass: 'bg-blue-600 border-blue-600 text-white',
    tooltip: ['Location', 'Contrat de location', 'LOCATION LECLERC'],
  },
  {
    code: 'maintenance',
    label: 'Maintenance',
    activeClass: 'bg-amber-600 border-amber-600 text-white',
    tooltip: [
      'Maintenance préventive',
      'Contrat de maintenance',
      'Contrat de maintenance curative',
      'Contrat de maintenance préventive',
    ],
  },
  {
    code: 'autre',
    label: 'Autre',
    activeClass: 'bg-slate-600 border-slate-600 text-white',
    tooltip: ['PDC - Passage Annuel', 'Audit simple', "Contrat d'audit", 'Aucun', '(champ vide)'],
  },
]

export default function ContratFilterBar() {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const rawContrat = sp.get('contrat') ?? ''
  const active: ContratGroup[] = rawContrat
    ? (rawContrat
        .split(',')
        .filter((g): g is ContratGroup =>
          g === 'location' || g === 'maintenance' || g === 'autre'
        ))
    : []
  const showAll = isAllSelected(active)

  const navigate = useCallback(
    (next: ContratGroup[]) => {
      const p = new URLSearchParams(sp.toString())
      if (next.length === 0 || next.length === ALL_GROUPS.length) {
        p.delete('contrat')
      } else {
        p.set('contrat', next.join(','))
      }
      // Réinitialise la pagination sur les pages tableau
      p.delete('page')
      startTransition(() => {
        router.push(`?${p.toString()}`, { scroll: false })
      })
    },
    [router, sp]
  )

  function toggle(code: ContratGroup) {
    if (showAll) {
      // État "tout" → sélectionner uniquement ce type
      navigate([code])
    } else if (active.includes(code)) {
      // Désélectionner ce type (si résultat vide → revient à tout)
      navigate(active.filter((g) => g !== code))
    } else {
      // Ajouter ce type
      navigate([...active, code])
    }
  }

  return (
    <div className={`flex items-center gap-2 transition-opacity ${isPending ? 'opacity-50' : ''}`}>
      <span className="text-xs text-slate-400 font-medium shrink-0">Contrat :</span>
      <div className="flex items-center gap-1.5">
        {GROUPS_CONFIG.map(({ code, label, activeClass, tooltip }) => {
          const isActive = showAll || active.includes(code)
          return (
            <div key={code} className="relative group/tip">
              <button
                onClick={() => toggle(code)}
                className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                  isActive
                    ? activeClass
                    : 'border-slate-200 text-slate-400 bg-white hover:border-slate-300 hover:text-slate-500'
                }`}
              >
                {label}
              </button>
              {/* Tooltip au survol */}
              <div className="absolute left-0 top-full mt-1.5 z-50 hidden group-hover/tip:block min-w-[180px]">
                <div className="bg-slate-800 text-white rounded-lg shadow-xl p-3 text-[11px] leading-relaxed">
                  <p className="font-semibold text-slate-300 mb-1.5 uppercase tracking-wide text-[10px]">Types inclus</p>
                  <ul className="space-y-1">
                    {tooltip.map((v) => (
                      <li key={v} className="flex items-start gap-1.5 text-slate-200">
                        <span className="text-slate-500 shrink-0 mt-0.5">·</span>
                        {v}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {!showAll && (
        <button
          onClick={() => navigate([])}
          className="text-xs text-slate-400 hover:text-slate-600 underline ml-0.5 shrink-0"
        >
          Tout
        </button>
      )}
    </div>
  )
}
