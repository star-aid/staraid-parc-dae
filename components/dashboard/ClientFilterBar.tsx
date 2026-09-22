'use client'
import { useState, useRef, useEffect, useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
          'flex h-7 cursor-text items-center gap-1.5 rounded-md border bg-white pl-2 pr-1 shadow-card transition-colors',
          selectedClient ? 'border-slate-900' : 'border-slate-200 hover:border-slate-300'
        )}
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>

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
            'w-44 bg-transparent text-xs outline-none',
            selectedClient && !open
              ? 'font-medium text-slate-900 placeholder:text-slate-900'
              : 'text-slate-700 placeholder:text-slate-400'
          )}
        />

        {selectedClient ? (
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600"
            title="Retirer le filtre client"
            aria-label="Retirer le filtre client"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        ) : (
          <svg viewBox="0 0 24 24" className="mr-0.5 h-3 w-3 shrink-0 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        )}
      </div>

      {open && (
        <div className="scrollbar-thin absolute left-0 top-full z-50 mt-1.5 max-h-64 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop">
          {displayed.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-slate-400">Aucun client trouvé</p>
          ) : (
            displayed.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => select(client)}
                className={cx(
                  'w-full px-3 py-1.5 text-left text-xs transition-colors',
                  client.id === selectedId ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                )}
              >
                {client.name}
              </button>
            ))
          )}
          {overflow && (
            <p className="border-t border-slate-100 px-3 py-1.5 text-center text-2xs text-slate-400">
              {matchingClients.length - 20} autres, affinez la recherche
            </p>
          )}
        </div>
      )}
    </div>
  )
}
