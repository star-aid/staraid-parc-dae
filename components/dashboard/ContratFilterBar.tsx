'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  type ContratGroup,
  type AutreType,
  ALL_GROUPS,
  LOCATION_TYPES,
  MAINTENANCE_TYPES,
  SANS_CONTRAT_SENTINEL,
  isAllSelected,
  parseContratParam,
  parseAutreTypesParam,
} from '@/lib/contract-groups'
import { Chip, ChipGroup, cx } from '@/components/ui/primitives'

interface Props {
  autreTypes: AutreType[]
}

const FIXED_GROUPS: { code: Exclude<ContratGroup, 'autre'>; label: string; tooltip: readonly string[] }[] = [
  { code: 'location',    label: 'Location',    tooltip: LOCATION_TYPES },
  { code: 'maintenance', label: 'Maintenance', tooltip: MAINTENANCE_TYPES },
]

export default function ContratFilterBar({ autreTypes }: Props) {
  const router = useRouter()
  const sp     = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // État courant depuis URL
  const activeGroups       = parseContratParam(sp.get('contrat') ?? undefined)
  const autreTypesSelected = parseAutreTypesParam(sp.get('autreTypes') ?? undefined)
  const showAll            = isAllSelected(activeGroups, autreTypesSelected)

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
      navigate(activeGroups.filter((g) => g !== code), autreTypesSelected?.join('|') ?? null)
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
      navigate(activeGroups.filter((g) => g !== 'autre'))
      setShowMenu(false)
    } else {
      navigate([...activeGroups, 'autre'] as ContratGroup[])
      setShowMenu(true)
    }
  }

  // Toggle un sous-type dans le menu AUTRES
  function toggleAutreType(type: string) {
    const allTypeValues = autreTypes.map((a) => a.type)
    // current = la sélection en cours (null = tous)
    const current = autreTypesSelected ? [...autreTypesSelected] : [...allTypeValues]
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
    const param = next.length === allTypeValues.length ? null : next.join('|')
    const groups: ContratGroup[] = activeGroups.includes('autre') ? activeGroups : [...activeGroups, 'autre']
    navigate(groups, param)
  }

  // Tout sélectionner / tout désélectionner dans AUTRES
  function toggleAllAutreTypes(selectAll: boolean) {
    const groups: ContratGroup[] = activeGroups.includes('autre') ? activeGroups : [...activeGroups, 'autre']
    navigate(groups, selectAll ? null : autreTypes.map((a) => a.type).join('|'))
  }

  const autreIsActive = showAll || activeGroups.includes('autre')
  const nbSelected    = autreTypesSelected?.length ?? autreTypes.length
  const autrePartial  = autreTypesSelected !== null && autreTypesSelected.length < autreTypes.length

  return (
    <div className={cx('flex items-center gap-2 transition-opacity', isPending && 'opacity-60')}>
      <ChipGroup label="Contrat">
        {/* Location + Maintenance, avec infobulle listant les valeurs incluses */}
        {FIXED_GROUPS.map(({ code, label, tooltip }) => {
          const isActive = showAll || activeGroups.includes(code)
          return (
            <div key={code} className="group/tip relative">
              <Chip active={isActive} onClick={() => toggleFixed(code)}>{label}</Chip>
              <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden group-hover/tip:block">
                <div className="w-max max-w-xs rounded-md bg-slate-900 px-3 py-2 text-white shadow-pop">
                  <p className="mb-1 text-2xs font-medium uppercase tracking-wider text-slate-400">Valeurs incluses</p>
                  <ul className="space-y-0.5">
                    {tooltip.map((v) => (
                      <li key={v} className="flex items-center gap-1.5 text-xs text-slate-200">
                        <span className="h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                        {v}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )
        })}

        {/* Autres + menu déroulant */}
        <div className="relative" ref={menuRef}>
          <Chip
            active={autreIsActive}
            onClick={() => {
              if (!autreIsActive) toggleAutre()
              else setShowMenu((v) => !v)
            }}
            aria-expanded={showMenu}
          >
            Autres
            {autrePartial && <span className="tabular-nums opacity-70">{nbSelected}/{autreTypes.length}</span>}
            <svg
              viewBox="0 0 24 24"
              className={cx('h-3 w-3 transition-transform', showMenu && 'rotate-180')}
              fill="none" stroke="currentColor" strokeWidth="2.5"
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </Chip>

          {showMenu && autreIsActive && (
            <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-slate-200 bg-white shadow-pop">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span className="text-2xs font-medium uppercase tracking-wider text-slate-400">
                  Types inclus dans « Autres »
                </span>
                <div className="flex items-center gap-2 text-2xs">
                  <button type="button" onClick={() => toggleAllAutreTypes(true)} className="font-medium text-slate-700 hover:underline">Tout</button>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => toggleAllAutreTypes(false)} className="text-slate-500 hover:underline">Aucun</button>
                </div>
              </div>

              <div className="scrollbar-thin max-h-64 overflow-y-auto py-1">
                {autreTypes.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-slate-400">Aucun type disponible</p>
                ) : (
                  autreTypes.map(({ type, count }) => {
                    const checked = !autreTypesSelected || autreTypesSelected.includes(type)
                    const isSansContrat = type === SANS_CONTRAT_SENTINEL
                    return (
                      <label key={type} className="group flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAutreType(type)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand/40"
                        />
                        <span className={cx('flex-1 text-xs leading-tight group-hover:text-slate-900', isSansContrat ? 'italic text-slate-400' : 'text-slate-700')}>
                          {isSansContrat ? 'Sans contrat' : type}
                        </span>
                        <span className="shrink-0 text-2xs text-slate-400 tabular-nums">{count}</span>
                      </label>
                    )
                  })
                )}
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
                <button type="button" onClick={() => { toggleAutre(); setShowMenu(false) }} className="text-2xs text-red-600 hover:underline">
                  Retirer « Autres »
                </button>
                <button type="button" onClick={() => setShowMenu(false)} className="rounded-md bg-slate-900 px-2.5 py-1 text-2xs font-medium text-white hover:bg-slate-800">
                  Fermer
                </button>
              </div>
            </div>
          )}
        </div>
      </ChipGroup>

      {/* Réinitialisation */}
      {!showAll && (
        <button
          type="button"
          onClick={() => { navigate([]); setShowMenu(false) }}
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title="Réinitialiser le filtre contrat"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          Tout
        </button>
      )}
    </div>
  )
}
