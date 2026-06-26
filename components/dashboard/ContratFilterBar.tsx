'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  type ContratGroup,
  type AutreType,
  ALL_GROUPS,
  LOCATION_TYPES,
  MAINTENANCE_TYPES,
  isAllSelected,
  parseContratParam,
  parseAutreTypesParam,
} from '@/lib/contract-groups'

interface Props {
  autreTypes: AutreType[]
}

const FIXED_GROUPS: { code: Exclude<ContratGroup, 'autre'>; label: string; activeClass: string; tooltip: string[] }[] = [
  {
    code: 'location',
    label: 'Location',
    activeClass: 'bg-blue-600 border-blue-600 text-white',
    tooltip: LOCATION_TYPES,
  },
  {
    code: 'maintenance',
    label: 'Contrat de maintenance',
    activeClass: 'bg-amber-600 border-amber-600 text-white',
    tooltip: MAINTENANCE_TYPES,
  },
]

export default function ContratFilterBar({ autreTypes }: Props) {
  const router = useRouter()
  const sp     = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // État courant depuis URL
  const activeGroups     = parseContratParam(sp.get('contrat') ?? undefined)
  const autreTypesSelected = parseAutreTypesParam(sp.get('autreTypes') ?? undefined)
  const showAll          = isAllSelected(activeGroups, autreTypesSelected)

  // Fermer le menu au clic extérieur
  useEffect(() => {
    if (!showMenu) return
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [showMenu])

  const navigate = useCallback(
    (groups: ContratGroup[], autreParam?: string | null) => {
      const p = new URLSearchParams(sp.toString())
      if (groups.length === 0 || groups.length === ALL_GROUPS.length) p.delete('contrat')
      else p.set('contrat', groups.join(','))
      if (!autreParam) p.delete('autreTypes')
      else p.set('autreTypes', autreParam)
      p.delete('page')
      startTransition(() => router.push(`?${p.toString()}`, { scroll: false }))
    },
    [router, sp]
  )

  // Toggle LOCATION ou MAINTENANCE
  function toggleFixed(code: Exclude<ContratGroup, 'autre'>) {
    if (showAll) {
      navigate([code])
    } else if (activeGroups.includes(code)) {
      navigate(activeGroups.filter(g => g !== code), autreTypesSelected?.join('|') ?? null)
    } else {
      navigate([...activeGroups, code], autreTypesSelected?.join('|') ?? null)
    }
  }

  // Toggle le groupe AUTRES (ouvre/ferme le menu)
  function toggleAutre() {
    if (showAll) {
      navigate(['autre'])
      setShowMenu(true)
      return
    }
    if (activeGroups.includes('autre')) {
      navigate(activeGroups.filter(g => g !== 'autre'))
      setShowMenu(false)
    } else {
      navigate([...activeGroups, 'autre'] as ContratGroup[])
      setShowMenu(true)
    }
  }

  // Toggle un sous-type dans le menu AUTRES
  function toggleAutreType(type: string) {
    const allTypeValues = autreTypes.map(a => a.type)
    // current = la sélection en cours (null = tous)
    const current = autreTypesSelected ? [...autreTypesSelected] : [...allTypeValues]
    const next = current.includes(type) ? current.filter(t => t !== type) : [...current, type]
    const param = next.length === allTypeValues.length ? null : next.join('|')
    const groups: ContratGroup[] = activeGroups.includes('autre') ? activeGroups : [...activeGroups, 'autre']
    navigate(groups, param)
  }

  // Tout sélectionner / tout désélectionner dans AUTRES
  function toggleAllAutreTypes(selectAll: boolean) {
    const groups: ContratGroup[] = activeGroups.includes('autre') ? activeGroups : [...activeGroups, 'autre']
    navigate(groups, selectAll ? null : autreTypes.map(a => a.type).join('|'))
  }

  const autreIsActive    = showAll || activeGroups.includes('autre')
  const nbSelected       = autreTypesSelected?.length ?? autreTypes.length
  const autreLabel       = autreTypesSelected && autreTypesSelected.length < autreTypes.length
    ? `Autres (${nbSelected}/${autreTypes.length})`
    : 'Autres'

  return (
    <div className={`flex items-center gap-2 transition-opacity ${isPending ? 'opacity-50' : ''}`}>
      <span className="text-xs text-slate-400 font-medium shrink-0">Contrat :</span>

      <div className="flex items-center gap-1.5">
        {/* Boutons LOCATION + CONTRAT DE MAINTENANCE */}
        {FIXED_GROUPS.map(({ code, label, activeClass, tooltip }) => {
          const isActive = showAll || activeGroups.includes(code)
          return (
            <div key={code} className="relative group/tip">
              <button
                onClick={() => toggleFixed(code)}
                className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                  isActive ? activeClass : 'border-slate-200 text-slate-400 bg-white hover:border-slate-300 hover:text-slate-500'
                }`}
              >
                {label}
              </button>
              {/* Tooltip au survol */}
              <div className="pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden group-hover/tip:block">
                <div className="bg-slate-800 text-white rounded-lg shadow-xl px-3 py-2 w-max max-w-xs">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Valeurs incluses</p>
                  <ul className="space-y-0.5">
                    {tooltip.map(v => (
                      <li key={v} className="text-xs text-slate-200 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-slate-500 shrink-0" />
                        {v}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )
        })}

        {/* Bouton AUTRES + menu déroulant */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => {
              if (!autreIsActive) toggleAutre()
              else setShowMenu(v => !v)
            }}
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
              autreIsActive
                ? 'bg-slate-600 border-slate-600 text-white'
                : 'border-slate-200 text-slate-400 bg-white hover:border-slate-300 hover:text-slate-500'
            }`}
          >
            {autreLabel}
            <svg
              viewBox="0 0 24 24"
              className={`w-3 h-3 transition-transform ${showMenu ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2.5"
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {/* Menu déroulant */}
          {showMenu && autreIsActive && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-white rounded-xl border border-slate-200 shadow-xl">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  Types inclus dans &quot;Autres&quot;
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleAllAutreTypes(true)}
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    Tout
                  </button>
                  <span className="text-slate-300">·</span>
                  <button
                    onClick={() => toggleAllAutreTypes(false)}
                    className="text-[10px] text-slate-500 hover:underline"
                  >
                    Aucun
                  </button>
                </div>
              </div>

              {/* Liste des types */}
              <div className="max-h-64 overflow-y-auto py-1">
                {autreTypes.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-slate-400 text-center">Aucun type disponible</p>
                ) : (
                  autreTypes.map(({ type, count }) => {
                    const checked = !autreTypesSelected || autreTypesSelected.includes(type)
                    return (
                      <label
                        key={type}
                        className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50 cursor-pointer group"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAutreType(type)}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-slate-600 focus:ring-slate-500"
                        />
                        <span className="flex-1 text-xs text-slate-700 group-hover:text-slate-900 leading-tight">
                          {type}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">{count}</span>
                      </label>
                    )
                  })
                )}
              </div>

              {/* Footer — fermer + désactiver le groupe */}
              <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100">
                <button
                  onClick={() => { toggleAutre(); setShowMenu(false) }}
                  className="text-[10px] text-red-500 hover:underline"
                >
                  Retirer &quot;Autres&quot;
                </button>
                <button
                  onClick={() => setShowMenu(false)}
                  className="text-[10px] px-2.5 py-1 bg-slate-800 text-white rounded-md hover:bg-slate-700"
                >
                  Fermer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bouton reset */}
      {!showAll && (
        <button
          onClick={() => { navigate([]); setShowMenu(false) }}
          className="text-xs text-slate-400 hover:text-slate-600 underline ml-0.5 shrink-0"
        >
          Tout
        </button>
      )}
    </div>
  )
}
