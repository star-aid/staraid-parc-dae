'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  type ContratGroup,
  type AutreType,
  ALL_GROUPS,
  AUCUN_AUTRE_TYPE,
  LOCATION_TYPES,
  MAINTENANCE_TYPES,
  SANS_CONTRAT_SENTINEL,
  isAllSelected,
  parseContratParam,
  parseAutreTypesParam,
} from '@/lib/contract-groups'
import { ChevronDown, X } from 'lucide-react'
import { Button, Chip, ChipGroup, cx } from '@/components/ui/primitives'

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

  // Retire le groupe AUTRES, y compris depuis l'état « tout sélectionné »
  function removeAutre() {
    const rest = (showAll ? [...ALL_GROUPS] : activeGroups).filter((g) => g !== 'autre') as ContratGroup[]
    navigate(rest)
    setShowMenu(false)
  }

  // Toggle un sous-type dans le menu AUTRES
  function toggleAutreType(type: string) {
    const allTypeValues = autreTypes.map((a) => a.type)
    // current = la sélection en cours (null = tous)
    const current = autreTypesSelected ? [...autreTypesSelected] : [...allTypeValues]
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
    const param = next.length === allTypeValues.length ? null : next.length === 0 ? AUCUN_AUTRE_TYPE : next.join('|')
    const groups: ContratGroup[] = activeGroups.includes('autre') ? activeGroups : [...activeGroups, 'autre']
    navigate(groups, param)
  }

  // Tout sélectionner / tout désélectionner dans AUTRES
  function toggleAllAutreTypes(selectAll: boolean) {
    const groups: ContratGroup[] = activeGroups.includes('autre') ? activeGroups : [...activeGroups, 'autre']
    navigate(groups, selectAll ? null : AUCUN_AUTRE_TYPE)
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
                <div className="w-max max-w-xs rounded-control bg-fg px-3 py-2 text-white shadow-float">
                  <p className="mb-1 text-label font-medium uppercase tracking-wider text-sidebar-fg-faint">Valeurs incluses</p>
                  <ul className="space-y-0.5">
                    {tooltip.map((v) => (
                      <li key={v} className="flex items-center gap-1.5 text-caption text-sidebar-fg">
                        <span className="h-1 w-1 shrink-0 rounded-full bg-sidebar-fg-faint" />
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
          {/* Deux gestes : le libellé sélectionne ou désélectionne le groupe, la flèche ouvre le choix des types */}
          <span className="inline-flex items-center">
            <Chip active={autreIsActive} onClick={toggleAutre} className="rounded-r-none pr-2" title={autreIsActive ? 'Retirer le groupe Autres' : 'Ajouter le groupe Autres'}>
              Autres
              {autrePartial && <span className="tabular-nums opacity-70">{nbSelected}/{autreTypes.length}</span>}
            </Chip>
            <button
              type="button"
              aria-label="Choisir les types de contrat inclus dans Autres"
              aria-expanded={showMenu}
              onClick={() => {
                if (!autreIsActive) toggleAutre()
                else setShowMenu((v) => !v)
              }}
              className={cx(
                'inline-flex h-7 items-center rounded-r-[6px] pl-1 pr-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                autreIsActive ? 'bg-fg text-white shadow-sm' : 'text-fg-secondary hover:bg-surface hover:text-fg'
              )}
            >
              <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', showMenu && 'rotate-180')} />
            </button>
          </span>

          {showMenu && autreIsActive && (
            <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-card border border-border bg-surface shadow-float">
              <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
                <span className="text-label font-bold uppercase tracking-wide text-fg-muted">
                  Types inclus dans « Autres »
                </span>
                <div className="flex items-center gap-2 text-caption">
                  <button type="button" onClick={() => toggleAllAutreTypes(true)} className="font-semibold text-brand hover:underline">Tout</button>
                  <span className="text-border-strong">·</span>
                  <button type="button" onClick={() => toggleAllAutreTypes(false)} className="font-semibold text-fg-muted hover:underline">Aucun</button>
                </div>
              </div>

              <div className="scrollbar-thin max-h-64 overflow-y-auto py-1">
                {autreTypes.length === 0 ? (
                  <p className="px-3 py-4 text-center text-caption text-fg-faint">Aucun type disponible</p>
                ) : (
                  autreTypes.map(({ type, count }) => {
                    const checked = !autreTypesSelected || autreTypesSelected.includes(type)
                    const isSansContrat = type === SANS_CONTRAT_SENTINEL
                    return (
                      <label key={type} className="group flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-surface-muted">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAutreType(type)}
                          className="h-3.5 w-3.5 rounded border-border-strong text-brand focus:ring-brand/40"
                        />
                        <span className={cx('flex-1 text-caption leading-tight group-hover:text-fg', isSansContrat ? 'italic text-fg-faint' : 'text-fg-secondary')}>
                          {isSansContrat ? 'Sans contrat' : type}
                        </span>
                        <span className="shrink-0 text-label text-fg-faint tabular-nums">{count}</span>
                      </label>
                    )
                  })
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2">
                <button type="button" onClick={removeAutre} className="text-caption font-semibold text-danger hover:underline">
                  Retirer « Autres »
                </button>
                <Button variant="secondary" size="xs" onClick={() => setShowMenu(false)}>Fermer</Button>
              </div>
            </div>
          )}
        </div>
      </ChipGroup>

      {/* Réinitialisation */}
      {!showAll && (
        <Button variant="ghost" size="xs" icon={X} onClick={() => { navigate([]); setShowMenu(false) }} title="Réinitialiser le filtre contrat">
          Tout
        </Button>
      )}
    </div>
  )
}
