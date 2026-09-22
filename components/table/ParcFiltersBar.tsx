'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Chip, ChipGroup, cx, inputClass, selectClass } from '@/components/ui/primitives'

const TERRITORIES = [
  { code: 'REU', label: 'La Réunion' },
  { code: 'MYT', label: 'Mayotte' },
  { code: 'GLP', label: 'Guadeloupe' },
]

// Point coloré : la couleur de statut accompagne toujours un libellé
const STATUTS = [
  { code: 'critique',  label: 'Critique',  dot: 'bg-red-500' },
  { code: 'vigilance', label: 'Vigilance', dot: 'bg-amber-500' },
  { code: 'conforme',  label: 'Conforme',  dot: 'bg-emerald-500' },
  { code: 'inconnu',   label: 'Inconnu',   dot: 'bg-slate-400' },
]

interface Props {
  total: number
  shown: number
}

export default function ParcFiltersBar({ total, shown }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [exporting, setExporting] = useState(false)

  async function exportAllCSV() {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch(`/api/parc/export?${sp.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? 'parc-dae.csv'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert("Échec de l'export CSV, réessayez.")
    } finally {
      setExporting(false)
    }
  }

  const currentQ     = sp.get('q') ?? ''
  const currentTerr  = sp.get('territoire')?.split(',').filter(Boolean) ?? []
  const currentStat  = sp.get('statut')?.split(',').filter(Boolean) ?? []
  const currentActif = sp.get('actif') ?? 'actif'

  const [inputQ, setInputQ] = useState(currentQ)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Synchronise le champ de recherche avec l'URL (navigation précédent / suivant)
  useEffect(() => { setInputQ(currentQ) }, [currentQ])

  const navigate = useCallback((params: URLSearchParams) => {
    startTransition(() => {
      router.push(`/parc?${params.toString()}`, { scroll: false })
    })
  }, [router])

  function buildParams(overrides: Record<string, string | string[] | null> = {}) {
    const p = new URLSearchParams(sp.toString())
    p.delete('page') // retour à la page 1 sur tout changement de filtre
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
    const next = currentTerr.includes(code) ? currentTerr.filter((c) => c !== code) : [...currentTerr, code]
    navigate(buildParams({ territoire: next }))
  }

  function toggleStat(code: string) {
    const next = currentStat.includes(code) ? currentStat.filter((c) => c !== code) : [...currentStat, code]
    navigate(buildParams({ statut: next }))
  }

  function clearAll() {
    // Conserve la vue (tableau / carte), efface tous les filtres
    const p = new URLSearchParams()
    const vue = sp.get('vue')
    if (vue) p.set('vue', vue)
    navigate(p)
    setInputQ('')
  }

  const hasFilters = inputQ !== '' || currentTerr.length > 0 || currentStat.length > 0 || currentActif !== 'actif'

  return (
    <div className={cx('mb-3 flex flex-wrap items-center gap-2 transition-opacity', isPending && 'opacity-60')}>
      {/* Recherche */}
      <div className="relative">
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="search"
          value={inputQ}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="N° série, modèle, client…"
          aria-label="Rechercher un DAE"
          className={cx(inputClass, 'w-60 pl-8')}
        />
      </div>

      <ChipGroup label="Territoire">
        {TERRITORIES.map(({ code, label }) => (
          <Chip key={code} active={currentTerr.includes(code)} onClick={() => toggleTerr(code)}>{label}</Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="Statut">
        {STATUTS.map(({ code, label, dot }) => (
          <Chip key={code} active={currentStat.includes(code)} onClick={() => toggleStat(code)}>
            <span className={cx('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
            {label}
          </Chip>
        ))}
      </ChipGroup>

      <label className="inline-flex items-center gap-1.5">
        <span className="text-2xs font-medium uppercase tracking-wider text-slate-400">Équipements</span>
        <select
          value={currentActif}
          onChange={(e) => navigate(buildParams({ actif: e.target.value === 'actif' ? null : e.target.value }))}
          className={cx(selectClass, 'h-7 text-xs')}
        >
          <option value="actif">Actifs</option>
          <option value="inactif">Inactifs</option>
          <option value="tous">Tous</option>
        </select>
      </label>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          Effacer
        </Button>
      )}

      {/* Compteur + export, alignés à droite */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-slate-500 tabular-nums">
          {shown.toLocaleString('fr-FR')} / {total.toLocaleString('fr-FR')} DAE
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={exportAllCSV}
          disabled={exporting || total === 0}
          title={`Exporter les ${total.toLocaleString('fr-FR')} DAE filtrés, pas seulement la page affichée`}
        >
          <svg viewBox="0 0 24 24" className={cx('h-3.5 w-3.5', exporting && 'animate-pulse')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {exporting ? 'Export…' : 'CSV'}
        </Button>
      </div>
    </div>
  )
}
