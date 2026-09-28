'use client'
import { useState, useRef, useEffect, useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Search, X } from 'lucide-react'
import { cx } from '@/components/ui/primitives'

export type ClientOption = { id: string; name: string }

interface Props {
  clients: ClientOption[]
}

export default function ClientFilterBar({ clients }: Props) {
  const router        = useRouter()
  const sp            = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef  = useRef<HTMLDivElement>(null)

  const selectedId     = sp.get('client') ?? ''
  const selectedClient = clients.find((c) => c.id === selectedId) ?? null

  const navigate = useCallback(
    (clientId: string | null) => {
      const p = new URLSearchParams(sp.toString())
      if (clientId) p.set('client', clientId)
      else p.delete('client')
      p.delete('page')
      startTransition(() => {
        router.push(`?${p.toString()}`, { scroll: false })
      })
    },
    [router, sp]
  )

  // Filtre local : 20 premiers résultats correspondant à la saisie
  const matchingClients = query
    ? clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : clients
  const displayed = matchingClients.slice(0, 20)
  const overflow  = matchingClients.length > 20

  function select(client: ClientOption) {
    navigate(client.id)
    setOpen(false)
    setQuery('')
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    navigate(null)
    setQuery('')
    setOpen(false)
  }

  // Fermer le menu au clic extérieur
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className={cx('relative shrink-0 transition-opacity', isPending && 'opacity-60')} ref={wrapRef}>
      <div
        onClick={() => inputRef.current?.focus()}
        className={cx(
          'flex h-8 cursor-text items-center gap-1.5 rounded-control border bg-surface pl-2.5 pr-1 transition-colors',
          selectedClient ? 'border-brand ring-[3px] ring-brand/10' : 'border-border hover:border-border-strong focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/10'
        )}
      >
        <Search className={cx('h-3.5 w-3.5 shrink-0', selectedClient ? 'text-brand' : 'text-fg-faint')} />

        <input
          ref={inputRef}
          type="text"
          placeholder={selectedClient && !open ? selectedClient.name : 'Filtrer par client…'}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => { setTimeout(() => { setOpen(false); setQuery('') }, 150) }}
          aria-label="Filtrer par client"
          className={cx(
            'w-44 bg-transparent text-caption outline-none',
            selectedClient && !open
              ? 'font-semibold text-fg placeholder:text-fg'
              : 'text-fg placeholder:text-fg-faint'
          )}
        />

        {selectedClient ? (
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded-[4px] p-0.5 text-fg-faint transition-colors hover:bg-surface-sunken hover:text-danger"
            title="Retirer le filtre client"
            aria-label="Retirer le filtre client"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="mr-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" />
        )}
      </div>

      {open && (
        <div className="scrollbar-thin absolute left-0 top-full z-50 mt-1.5 max-h-64 w-72 overflow-y-auto rounded-card border border-border bg-surface py-1 shadow-float">
          {displayed.length === 0 ? (
            <p className="px-3 py-3 text-center text-caption text-fg-faint">Aucun client trouvé</p>
          ) : (
            displayed.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => select(client)}
                className={cx(
                  'w-full px-3 py-1.5 text-left text-caption transition-colors',
                  client.id === selectedId ? 'bg-brand/5 font-semibold text-brand' : 'text-fg-secondary hover:bg-surface-muted hover:text-fg'
                )}
              >
                {client.name}
              </button>
            ))
          )}
          {overflow && (
            <p className="border-t border-border-subtle px-3 py-1.5 text-center text-label text-fg-faint">
              {matchingClients.length - 20} autres, affinez la recherche
            </p>
          )}
        </div>
      )}
    </div>
  )
}
