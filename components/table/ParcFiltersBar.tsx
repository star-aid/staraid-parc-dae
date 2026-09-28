'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Search, X } from 'lucide-react'
import { Button, Chip, ChipGroup, Select, cx, inputClass } from '@/components/ui/primitives'

const TERRITORIES = [
  { code: 'REU', label: 'La Réunion' },
  { code: 'MYT', label: 'Mayotte' },
  { code: 'GLP', label: 'Guadeloupe' },
]

// Point coloré : la couleur de statut accompagne toujours un libellé
const STATUTS = [
  { code: 'critique',  label: 'Critique',  dot: 'bg-danger' },
  { code: 'vigilance', label: 'Vigilance', dot: 'bg-warning' },
  { code: 'conforme',  label: 'Conforme',  dot: 'bg-success' },
  { code: 'inconnu',   label: 'Inconnu',   dot: 'bg-fg-faint' },
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
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
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

      <label className="inline-flex items-center gap-2">
        <span className="text-label font-bold uppercase tracking-wide text-fg-faint">Équipements</span>
        <Select
          value={currentActif}
          onChange={(e) => navigate(buildParams({ actif: e.target.value === 'actif' ? null : e.target.value }))}
          controlSize="sm"
        >
          <option value="actif">Actifs</option>
          <option value="inactif">Inactifs</option>
          <option value="tous">Tous</option>
        </Select>
      </label>

      {hasFilters && (
        <Button variant="ghost" size="sm" icon={X} onClick={clearAll}>Effacer</Button>
      )}

      {/* Compteur + export, alignés à droite */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-caption text-fg-muted tabular-nums">
          {shown.toLocaleString('fr-FR')} / {total.toLocaleString('fr-FR')} DAE
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={Download}
          loading={exporting}
          onClick={exportAllCSV}
          disabled={total === 0}
          title={`Exporter les ${total.toLocaleString('fr-FR')} DAE filtrés, pas seulement la page affichée`}
        >
          {exporting ? 'Export…' : 'CSV'}
        </Button>
      </div>
    </div>
  )
}
