'use client'
import { useState, useRef, useEffect, useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

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

  // Fermer le dropdown au clic extérieur
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className={`relative shrink-0 ${isPending ? 'opacity-60' : ''}`} ref={wrapRef}>
      {/* Champ de saisie / affichage */}
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 border rounded-lg bg-white cursor-text transition-colors ${
          selectedClient
            ? 'border-blue-400 ring-1 ring-blue-200'
            : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
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
          className={`text-xs w-40 outline-none bg-transparent ${
            selectedClient && !open
              ? 'text-blue-700 font-medium placeholder:text-blue-700'
              : 'text-slate-700 placeholder:text-slate-400'
          }`}
        />

        {selectedClient ? (
          <button onClick={clear} className="p-0.5 text-slate-400 hover:text-red-500 shrink-0 transition-colors" title="Retirer le filtre client">
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        ) : (
          <svg viewBox="0 0 24 24" className="w-3 h-3 text-slate-300 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
          {displayed.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-400 text-center">Aucun client trouvé</p>
          ) : (
            displayed.map((client) => (
              <button
                key={client.id}
                onClick={() => select(client)}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                  client.id === selectedId
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {client.name}
              </button>
            ))
          )}
          {overflow && (
            <p className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100 text-center">
              {matchingClients.length - 20} autres — affinez la recherche
            </p>
          )}
        </div>
      )}
    </div>
  )
}
