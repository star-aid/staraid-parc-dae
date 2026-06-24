'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface SidebarProps {
  critiqueCount: number
  lastSync: string | null
}

const NAV = [
  {
    href: '/dashboard',
    label: 'Tableau de bord',
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    href: '/parc',
    label: 'Parc DAE',
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>
    ),
  },
  {
    href: '/alertes',
    label: 'Alertes',
    badge: true,
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
    ),
  },
  {
    href: '/analyse',
    label: 'Analyse IA',
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
      </svg>
    ),
  },
]

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-3.5 h-3.5 shrink-0 ${spinning ? 'animate-spin' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  )
}

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18"/>
    </svg>
  )
}

export default function Sidebar({ critiqueCount, lastSync }: SidebarProps) {
  const pathname = usePathname()
  const [open, setOpen]       = useState(false)
  const [syncing, setSyncing]  = useState(false)
  const [syncMsg, setSyncMsg]  = useState<string | null>(null)
  const [elapsed, setElapsed]  = useState(0)

  const formatSync = lastSync
    ? new Date(lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : null

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    setSyncMsg(null)
    setElapsed(0)

    // Timer d'affichage — montre que la sync progresse
    const timerRef = setInterval(() => setElapsed((s) => s + 1), 1000)

    try {
      // Démarre la sync côté serveur — retourne immédiatement avec un logId
      const startRes = await fetch('/api/sync/trigger')
      if (!startRes.ok) {
        setSyncMsg(`Erreur démarrage (${startRes.status})`)
        return
      }
      const { logId } = await startRes.json() as { logId: string | null }

      if (!logId) {
        setSyncMsg('Erreur : pas de logId')
        return
      }

      // Polling toutes les 3 secondes jusqu'à success / partial / error
      await new Promise<void>((resolve) => {
        const poll = setInterval(async () => {
          try {
            const r = await fetch(`/api/sync/status?id=${logId}`)
            const body = await r.json() as { status: string; records_synced?: number; error_message?: string }

            if (body.status === 'success' || body.status === 'partial') {
              clearInterval(poll)
              const msg = body.status === 'partial'
                ? `Sync terminée avec avertissements (${body.records_synced ?? 0} enreg.)`
                : `Sync terminée — ${body.records_synced ?? 0} enregistrements`
              setSyncMsg(msg)
              setTimeout(() => window.location.reload(), 1200)
              resolve()
            } else if (body.status === 'error') {
              clearInterval(poll)
              setSyncMsg(`Erreur : ${body.error_message?.slice(0, 60) ?? 'inconnue'}`)
              resolve()
            }
            // 'running' ou 'unknown' → on repoll
          } catch {
            // Erreur réseau transitoire → on continue de poller
          }
        }, 3000)
      })
    } catch {
      setSyncMsg('Erreur réseau')
    } finally {
      clearInterval(timerRef)
      setSyncing(false)
    }
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 bg-slate-900 flex items-center px-4 gap-3">
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Menu"
        >
          <HamburgerIcon />
        </button>
        <span className="text-white font-semibold text-sm tracking-wide">STAR <span className="font-light">aid</span> · Parc DAE</span>
      </div>

      {/* Overlay mobile */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'fixed lg:relative inset-y-0 left-0 z-50 w-64 flex flex-col bg-slate-900 text-white',
          'transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="px-5 pt-5 pb-4 border-b border-slate-800">
          {/* Logo STAR aid */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Logo STAR aid.png" alt="STAR aid" className="h-28 w-auto object-contain" />
          <p className="text-[10px] text-slate-500 mt-2 tracking-wide uppercase">Parc DAE · Réunion · Mayotte · Guadeloupe</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon, badge }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-bold transition-colors group',
                  active
                    ? 'bg-[#AF2125] text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white',
                ].join(' ')}
              >
                {icon}
                <span className="flex-1">{label}</span>
                {badge && critiqueCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
                    {critiqueCount > 999 ? '999+' : critiqueCount}
                  </span>
                )}
              </Link>
            )
          })}

          <div className="pt-4 mt-2 border-t border-slate-800">
            <Link
              href="/admin/field-mapping"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-slate-600 hover:bg-slate-800 hover:text-slate-300 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              Mapping champs
            </Link>
          </div>
        </nav>

        {/* Footer sync */}
        <div className="px-4 py-4 border-t border-slate-800">
          <p className="text-[11px] text-slate-500 mb-2">
            {formatSync ? `Dernière sync : ${formatSync}` : 'Aucune synchronisation'}
          </p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className={[
              'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors',
              syncing
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white',
            ].join(' ')}
          >
            <SyncIcon spinning={syncing} />
            {syncing
              ? `Sync en cours… ${elapsed > 0 ? `(${elapsed}s)` : ''}`
              : syncMsg ?? 'Synchroniser maintenant'
            }
          </button>
        </div>
      </aside>
    </>
  )
}
