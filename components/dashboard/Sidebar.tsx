'use client'
import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabaseBrowserClient, type UserRole } from '@/lib/supabase'
import { cx } from '@/components/ui/primitives'

interface SidebarProps {
  critiqueCount: number
  lastSync: string | null
  userRole: UserRole
  userName: string
  userEmail: string
}

// Matrice de visibilité par rôle
const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Tableau de bord',
    roles: ['administrateur', 'maintenance', 'direction'] as UserRole[],
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    href: '/parc',
    label: 'Parc DAE',
    roles: ['administrateur', 'maintenance', 'direction'] as UserRole[],
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>
    ),
  },
  {
    href: '/alertes',
    label: 'Alertes',
    badge: true,
    roles: ['administrateur', 'maintenance'] as UserRole[],
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
    ),
  },
  {
    href: '/geodae',
    label: "Contrôle Géo'DAE",
    roles: ['administrateur', 'maintenance'] as UserRole[],
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/>
        <path d="M9 10l2 2 4-4"/>
      </svg>
    ),
  },
  {
    href: '/analyse',
    label: 'Analyse IA',
    roles: ['administrateur'] as UserRole[],
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
      </svg>
    ),
  },
]

const ROLE_LABELS: Record<UserRole, string> = {
  administrateur: 'Administrateur',
  maintenance:    'Gestionnaire de maintenance',
  direction:      'Consultation du parc',
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-3.5 w-3.5 shrink-0', spinning && 'animate-spin')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  )
}

const TERRITORIES = [
  { key: 'reu', label: 'Réunion',    route: '/api/sync/reu' },
  { key: 'myt', label: 'Mayotte',    route: '/api/sync/myt' },
  { key: 'glp', label: 'Guadeloupe', route: '/api/sync/glp' },
] as const

type TerritoryKey = typeof TERRITORIES[number]['key']
type TerritoryStatus = 'pending' | 'running' | 'success' | 'error'
type PollStatus = { status: string; records_synced: number; finished_at: string | null } | null

// Lien secondaire (configuration, règles) : plus discret que la navigation principale
function SecondaryLink({ href, active, onClick, icon, children }: {
  href: string; active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-xs transition-colors',
        active ? 'bg-white/[0.08] text-slate-100' : 'text-slate-500 hover:bg-white/[0.05] hover:text-slate-200'
      )}
    >
      <span className="shrink-0 text-slate-500">{icon}</span>
      <span className="truncate">{children}</span>
    </Link>
  )
}

export default function Sidebar({ critiqueCount, lastSync, userRole, userName }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const [open, setOpen]       = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [territoryStatus, setTerritoryStatus] = useState<Record<TerritoryKey, TerritoryStatus> | null>(null)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)
  const pollingRef   = useRef(false)
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartRef = useRef<number>(0)

  const formatSync = lastSync
    ? new Date(lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : null

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(userRole))
  const canSync = userRole === 'administrateur' || userRole === 'maintenance'
  const close = () => setOpen(false)

  async function handleLogout() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    pollingRef.current = false
  }, [])

  const startPolling = useCallback(() => {
    pollStartRef.current = Date.now()
    pollingRef.current = true
    pollRef.current = setInterval(async () => {
      // Arrêt après 5 min
      if (Date.now() - pollStartRef.current > 5 * 60 * 1000) { stopPolling(); return }

      try {
        const res = await fetch('/api/sync/status?territories=1')
        const data = await res.json() as Record<string, PollStatus>
        const map: Record<TerritoryKey, TerritoryStatus> = { reu: 'pending', myt: 'pending', glp: 'pending' }
        let allDone = true
        for (const key of ['reu', 'myt', 'glp'] as TerritoryKey[]) {
          const row = data[key]
          if (!row || row.status === 'running') { map[key] = 'running'; allDone = false }
          else if (row.status === 'success' || row.status === 'partial') map[key] = 'success'
          else map[key] = 'error'
        }
        setTerritoryStatus({ ...map })
        if (allDone) {
          stopPolling()
          const allOk = Object.values(map).every((s) => s === 'success')
          const anyOk = Object.values(map).some((s) => s === 'success')
          const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          setDoneMsg(allOk ? `Terminée à ${now}` : anyOk ? `Terminée avec erreurs à ${now}` : `Échec à ${now}`)
          setSyncing(false)
          if (anyOk) setTimeout(() => router.refresh(), 1500)
        }
      } catch { /* silencieux */ }
    }, 10_000)
  }, [stopPolling, router])

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    setDoneMsg(null)
    setTerritoryStatus({ reu: 'running', myt: 'running', glp: 'running' })

    // Déclenche les 3 syncs en parallèle
    await Promise.allSettled(
      TERRITORIES.map(({ key }) => fetch(`/api/sync/trigger?territory=${key}`, { method: 'POST' }))
    )

    // Suit la progression réelle
    startPolling()
  }

  const STATUS_CLASS: Record<TerritoryStatus, string> = {
    running: 'text-slate-300',
    success: 'text-emerald-400',
    error:   'text-red-400',
    pending: 'text-slate-600',
  }

  return (
    <>
      {/* Barre supérieure mobile */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-3 border-b border-white/10 bg-slate-900 px-3 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Ouvrir le menu"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18"/>
          </svg>
        </button>
        <span className="text-13 font-semibold text-white">
          STAR aid <span className="font-normal text-slate-400">· Parc DAE</span>
        </span>
      </div>

      {/* Voile mobile */}
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden" onClick={close} />
      )}

      {/* Barre latérale */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-white/[0.06] bg-slate-900 text-slate-200 lg:relative',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo — présentation d'origine conservée : logo entier, mention en dessous */}
        <div className="border-b border-slate-800 px-4 pb-4 pt-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Logo STAR aid.png" alt="STAR aid" className="h-28 w-auto max-w-full object-contain" />
          <p className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">Parc DAE · Réunion · Mayotte · Guadeloupe</p>
        </div>

        {/* Navigation */}
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-2" aria-label="Navigation principale">
          <ul className="space-y-0.5">
            {visibleNav.map(({ href, label, icon, badge }) => {
              const active = pathname.startsWith(href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-13 font-medium transition-colors',
                      active ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100'
                    )}
                  >
                    {active && <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-brand-light" aria-hidden />}
                    <span className={cx('shrink-0', active ? 'text-brand-light' : 'text-slate-500 group-hover:text-slate-300')}>
                      {icon}
                    </span>
                    <span className="flex-1 truncate">{label}</span>
                    {badge && critiqueCount > 0 && (
                      <span className="min-w-[18px] rounded-full bg-red-500 px-1.5 text-center text-2xs font-semibold leading-[18px] text-white tabular-nums">
                        {critiqueCount > 999 ? '999+' : critiqueCount}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>

          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <p className="px-2.5 pb-1 text-2xs font-medium uppercase tracking-wider text-slate-600">Configuration</p>
            <ul className="space-y-0.5">
              {userRole === 'administrateur' && (
                <li>
                  <SecondaryLink
                    href="/admin/field-mapping"
                    active={pathname.startsWith('/admin/field-mapping')}
                    onClick={close}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                      </svg>
                    }
                  >
                    Mapping des champs
                  </SecondaryLink>
                </li>
              )}
              <li>
                <SecondaryLink
                  href="/regles"
                  active={pathname.startsWith('/regles')}
                  onClick={close}
                  icon={
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
                    </svg>
                  }
                >
                  Règles du dashboard
                </SecondaryLink>
              </li>
            </ul>
          </div>
        </nav>

        {/* Synchronisation */}
        <div className="border-t border-white/[0.06] px-3 py-3">
          <p className="mb-2 flex items-center justify-between gap-2 text-2xs text-slate-500">
            <span>Dernière synchro</span>
            <span className="truncate font-medium text-slate-400 tabular-nums">{formatSync ?? 'aucune'}</span>
          </p>

          {canSync && (
            <>
              <button
                onClick={handleSync}
                disabled={syncing}
                className={cx(
                  'flex h-8 w-full items-center justify-center gap-2 rounded-md text-xs font-medium transition-colors',
                  syncing
                    ? 'cursor-not-allowed bg-white/[0.04] text-slate-500'
                    : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-white'
                )}
              >
                <SyncIcon spinning={syncing} />
                {syncing ? 'Synchronisation en cours…' : 'Synchroniser maintenant'}
              </button>

              {/* Progression / résultat par territoire */}
              {territoryStatus && (syncing || doneMsg) && (
                <div className="mt-2 flex items-center justify-between gap-2 text-2xs">
                  <div className="flex items-center gap-2.5">
                    {TERRITORIES.map(({ key, label }) => {
                      const s = territoryStatus[key]
                      return (
                        <span key={key} className={cx('inline-flex items-center gap-1 font-medium', STATUS_CLASS[s])} title={label}>
                          {s === 'running' && <SyncIcon spinning />}
                          {s === 'success' && '✓'}
                          {s === 'error'   && '✗'}
                          {s === 'pending' && '·'}
                          {key.toUpperCase()}
                        </span>
                      )
                    })}
                  </div>
                  {!syncing && doneMsg && <span className="truncate text-slate-400">{doneMsg}</span>}
                </div>
              )}
            </>
          )}
        </div>

        {/* Utilisateur */}
        <div className="flex items-center gap-2.5 border-t border-white/[0.06] px-3 py-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
            {userName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-200">{userName}</p>
            <p className="truncate text-2xs text-slate-500">{ROLE_LABELS[userRole]}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Se déconnecter"
            aria-label="Se déconnecter"
            className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </aside>
    </>
  )
}
