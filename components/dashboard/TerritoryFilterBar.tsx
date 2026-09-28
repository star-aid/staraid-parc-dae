'use client'
import { useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Chip, ChipGroup, Select, cx } from '@/components/ui/primitives'

const TERRITORIES = [
  { code: 'REU', label: 'La Réunion' },
  { code: 'GLP', label: 'Guadeloupe' },
  { code: 'MYT', label: 'Mayotte' },
]

export default function TerritoryFilterBar() {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const active = sp.get('territoire') ?? ''
  const actif  = sp.get('actif') ?? 'actif'

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
    <div className={cx('flex flex-wrap items-center gap-3 transition-opacity', isPending && 'opacity-60')}>
      <ChipGroup label="Territoire">
        <Chip active={!active} onClick={() => navigateTerr('')}>Tous</Chip>
        {TERRITORIES.map(({ code, label }) => (
          <Chip key={code} active={active === code} onClick={() => navigateTerr(code)}>{label}</Chip>
        ))}
      </ChipGroup>

      <label className="inline-flex items-center gap-2">
        <span className="text-label font-bold uppercase tracking-wide text-fg-faint">Équipements</span>
        <Select value={actif} onChange={(e) => navigateActif(e.target.value)} controlSize="sm">
          <option value="actif">Actifs</option>
          <option value="inactif">Inactifs</option>
          <option value="tous">Tous</option>
        </Select>
      </label>
    </div>
  )
}
