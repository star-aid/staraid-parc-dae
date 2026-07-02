'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabaseBrowserClient, type UserRole } from '@/lib/supabase'

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
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
    ),
  },
  {
    href: '/analyse',
    label: 'Analyse IA',
    roles: ['administrateur'] as UserRole[],
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
      </svg>
    ),
  },
]

const ROLE_LABELS: Record<UserRole, string> = {
  administrateur: 'Administrateur',
  maintenance:    'Gestionnaire de maintenance',
  direction:      'Utilisateur (consultation du parc)',
}

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

const TERRITORIES = [
  { key: 'reu', label: 'Réunion',     route: '/api/sync/reu' },
  { key: 'myt', label: 'Mayotte',     route: '/api/sync/myt' },
  { key: 'glp', label: 'Guadeloupe',  route: '/api/sync/glp' },
] as const

type TerritoryKey = typeof TERRITORIES[number]['key']
type TerritoryStatus = 'pending' | 'running' | 'success' | 'error'

export default function Sidebar({ critiqueCount, lastSync, userRole, userName }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const [open, setOpen]   = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [territoryStatus, setTerritoryStatus] = useState<Record<TerritoryKey, TerritoryStatus> | null>(null)
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)

  const formatSync = lastSync
    ? new Date(lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : null

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(userRole))

  async function handleLogout() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    setDoneMsg(null)
    setCurrentStep(0)
    setTerritoryStatus({ reu: 'pending', myt: 'pending', glp: 'pending' })

    const results: Record<TerritoryKey, TerritoryStatus> = { reu: 'pending', myt: 'pending', glp: 'pending' }

    for (let i = 0; i < TERRITORIES.length; i++) {
      const { key } = TERRITORIES[i]
      setCurrentStep(i + 1)
      results[key] = 'running'
      setTerritoryStatus({ ...results })

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 55_000)
        const res = await fetch(`/api/sync/trigger?territory=${key}`, {
          method: 'POST',
          signal: controller.signal,
        })
        clearTimeout(timeout)
        const body = await res.json() as { status?: string; equipments?: number; errors?: string[] }
        // 'partial' = sync réussie avec quelques erreurs non bloquantes → on affiche succès
        results[key] = (body.status === 'success' || body.status === 'partial') ? 'success'
          : (body.equipments && body.equipments > 0) ? 'success'  // équipements synchro = sync OK malgré statut error
          : 'error'
      } catch {
        results[key] = 'error'
      }

      setTerritoryStatus({ ...results })
    }

    const allOk   = Object.values(results).every(s => s === 'success')
    const anyOk   = Object.values(results).some(s => s === 'success')
    const now     = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    setDoneMsg(allOk ? `Terminée à ${now}` : anyOk ? `Terminée avec erreurs à ${now}` : `Échec à ${now}`)
    setSyncing(false)
    setCurrentStep(0)
    if (anyOk) setTimeout(() => router.refresh(), 1500)
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Logo STAR aid.png" alt="STAR aid" className="h-28 w-auto object-contain" />
          <p className="text-[10px] text-slate-500 mt-2 tracking-wide uppercase">Parc DAE · Réunion · Mayotte · Guadeloupe</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {visibleNav.map(({ href, label, icon, badge }) => {
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
            {/* Mapping champs — administrateur uniquement */}
            {userRole === 'administrateur' && (
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
            )}
          </div>
        </nav>

        {/* Retour + Règles du dashboard */}
        <div className="px-4 pb-2 space-y-0.5">
          <button
            onClick={() => { router.back(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
            Retour
          </button>
          <Link
            href="/regles"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
            </svg>
            Règles du dashboard
          </Link>
        </div>

        {/* Utilisateur connecté + déconnexion */}
        <div className="px-4 py-3 border-t border-slate-800">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-7 h-7 rounded-full bg-[#AF2125] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {userName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-200 truncate">{ROLE_LABELS[userRole]}</p>
              <p className="text-[10px] text-slate-500 truncate">{userName}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Se déconnecter"
              className="ml-auto p-1.5 rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors shrink-0"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Footer sync */}
        <div className="px-4 py-4 border-t border-slate-800">
          <p className="text-[11px] text-slate-500 mb-2">
            {formatSync ? `Dernière sync : ${formatSync}` : 'Aucune synchronisation'}
          </p>
          {/* Sync uniquement pour administrateur et maintenance */}
          {(userRole === 'administrateur' || userRole === 'maintenance') && (
            <>
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
                  ? (() => {
                      const t = TERRITORIES[currentStep - 1]
                      return t ? `${t.label}… (${currentStep}/3)` : 'Sync en cours…'
                    })()
                  : 'Synchroniser maintenant'
                }
              </button>

              {/* Indicateur de progression par territoire */}
              {syncing && territoryStatus && (
                <div className="mt-2 flex items-center gap-2">
                  {TERRITORIES.map(({ key, label }) => {
                    const s = territoryStatus[key]
                    return (
                      <div key={key} className="flex items-center gap-1" title={label}>
                        {s === 'running'  && <SyncIcon spinning />}
                        {s === 'success'  && <span className="text-emerald-400 text-xs">✓</span>}
                        {s === 'error'    && <span className="text-red-400 text-xs">✗</span>}
                        {s === 'pending'  && <span className="text-slate-600 text-xs">·</span>}
                        <span className={`text-[10px] ${
                          s === 'running' ? 'text-slate-300' :
                          s === 'success' ? 'text-emerald-400' :
                          s === 'error'   ? 'text-red-400' : 'text-slate-600'
                        }`}>{label.slice(0, 3)}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Résultat final avec statut par territoire */}
              {!syncing && territoryStatus && doneMsg && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-slate-400">{doneMsg}</p>
                  <div className="flex items-center gap-2">
                    {TERRITORIES.map(({ key, label }) => {
                      const s = territoryStatus[key]
                      return (
                        <span key={key} className={`text-[10px] ${s === 'success' ? 'text-emerald-400' : s === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
                          {label.slice(0, 3)} {s === 'success' ? '✅' : s === 'error' ? '❌' : ''}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
