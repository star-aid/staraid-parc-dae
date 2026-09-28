'use client'
// Panneau de navigation sombre (encre froide), à part du contenu clair : le
// contraste header rouge / navigation sombre / contenu clair structure l'écran.
// Déployé en permanence sur grand écran, tiroir coulissant sur mobile.
import { useEffect, useState, useRef, useCallback, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Bell, BookOpen, ClipboardCheck, HeartPulse, LayoutDashboard, Loader2, RefreshCw, Settings2, Sparkles, X, type LucideIcon,
} from 'lucide-react'
import type { UserRole } from '@/lib/supabase'
import { IconButton, cx } from '@/components/ui/primitives'

interface SidebarProps {
  critiqueCount: number
  /** Anomalies Géo'DAE ouvertes (badge de l'entrée Contrôle Géo'DAE) */
  geodaeAnomalyCount?: number
  lastSync: string | null
  userRole: UserRole
  /** Tiroir ouvert (mobile) */
  open: boolean
  onClose: () => void
}

type BadgeKind = 'critique' | 'geodae'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  roles: UserRole[]
  badge?: BadgeKind
}

// Matrice de visibilité par rôle
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Tableau de bord',   icon: LayoutDashboard, roles: ['administrateur', 'maintenance', 'direction'] },
  { href: '/parc',      label: 'Parc DAE',          icon: HeartPulse,      roles: ['administrateur', 'maintenance', 'direction'] },
  { href: '/alertes',   label: 'Alertes',           icon: Bell,            roles: ['administrateur', 'maintenance'], badge: 'critique' },
  { href: '/geodae',    label: "Contrôle Géo'DAE",  icon: ClipboardCheck,  roles: ['administrateur', 'maintenance'], badge: 'geodae' },
  { href: '/analyse',   label: 'Analyse IA',        icon: Sparkles,        roles: ['administrateur'] },
]

const CONFIG_ITEMS: NavItem[] = [
  { href: '/admin/field-mapping', label: 'Mapping des champs',  icon: Settings2, roles: ['administrateur'] },
  { href: '/regles',              label: 'Règles du dashboard', icon: BookOpen,  roles: ['administrateur', 'maintenance', 'direction'] },
]

const TERRITORIES = [
  { key: 'reu', label: 'Réunion',    route: '/api/sync/reu' },
  { key: 'myt', label: 'Mayotte',    route: '/api/sync/myt' },
  { key: 'glp', label: 'Guadeloupe', route: '/api/sync/glp' },
] as const

type TerritoryKey = typeof TERRITORIES[number]['key']
type TerritoryStatus = 'pending' | 'running' | 'success' | 'error'
type PollStatus = { status: string; records_synced: number; finished_at: string | null } | null

const STATUS_CLASS: Record<TerritoryStatus, string> = {
  running: 'text-sidebar-fg-muted',
  success: 'text-success',
  error:   'text-danger',
  pending: 'text-sidebar-fg-faint',
}

// ─── Entrée de navigation ────────────────────────────────────────────────────

function NavRow({ item, active, pending, count, onClick }: {
  item: NavItem
  active: boolean
  pending: boolean
  count: number
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex items-center gap-3 rounded-control px-3 py-2 text-body font-semibold transition-colors',
        active ? 'bg-sidebar-active text-sidebar-fg' : 'text-sidebar-fg-muted hover:bg-sidebar-raised hover:text-sidebar-fg'
      )}
    >
      <span className="shrink-0">
        {pending ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Icon className="h-[18px] w-[18px]" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count > 0 && (
        <span
          className={cx(
            'flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-2xs font-bold leading-none text-white tabular-nums',
            item.badge === 'geodae' ? 'bg-warning' : 'bg-danger'
          )}
        >
          {count > 999 ? '999+' : count}
        </span>
      )}
    </Link>
  )
}

export default function Sidebar({ critiqueCount, geodaeAnomalyCount = 0, lastSync, userRole, open, onClose }: SidebarProps) {
  const badgeCount = (badge?: BadgeKind) => (badge === 'critique' ? critiqueCount : badge === 'geodae' ? geodaeAnomalyCount : 0)
  const pathname = usePathname()
  const router   = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [territoryStatus, setTerritoryStatus] = useState<Record<TerritoryKey, TerritoryStatus> | null>(null)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)
  const pollingRef   = useRef(false)
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartRef = useRef<number>(0)

  const formatSync = lastSync
    ? new Date(lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : null

  const visibleNav    = NAV_ITEMS.filter((item) => item.roles.includes(userRole))
  const visibleConfig = CONFIG_ITEMS.filter((item) => item.roles.includes(userRole))
  const canSync = userRole === 'administrateur' || userRole === 'maintenance'

  // ── Navigation optimiste ─────────────────────────────────────────────────
  // Au clic, l'entrée visée passe active immédiatement et affiche un indicateur
  // jusqu'à ce que la nouvelle page commence à s'afficher (son squelette
  // loading.tsx suffit).
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => { setPendingHref(null) }, [pathname])

  const isActive = (href: string) => pendingHref === href || (pendingHref === null && pathname.startsWith(href))

  function navigateTo(href: string) {
    return (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Laisser le navigateur gérer les ouvertures dans un nouvel onglet
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      onClose()
      if (pathname === href) return
      setPendingHref(href)
      startTransition(() => router.push(href))
    }
  }

  // ── Synchronisation Synchroteam ──────────────────────────────────────────
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
    // Déclenche les 3 syncs en parallèle, puis suit la progression réelle
    await Promise.allSettled(
      TERRITORIES.map(({ key }) => fetch(`/api/sync/trigger?territory=${key}`, { method: 'POST' }))
    )
    startPolling()
  }

  return (
    <>
      {/* Voile mobile */}
      {open && <div className="fixed inset-0 z-40 bg-surface-overlay lg:hidden" onClick={onClose} aria-hidden />}

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-fg transition-transform duration-200 ease-out',
          'lg:static lg:z-auto lg:w-56 lg:shrink-0 lg:translate-x-0',
          open ? 'translate-x-0 shadow-panel' : '-translate-x-full'
        )}
        aria-label="Navigation principale"
      >
        {/* En-tête du tiroir (mobile seulement : sur grand écran, la marque est dans le bandeau) */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-4 lg:hidden">
          <span className="text-body font-extrabold">Parc DAE</span>
          <IconButton icon={X} label="Fermer la navigation" variant="ghost" className="text-sidebar-fg-muted hover:bg-sidebar-raised hover:text-sidebar-fg" onClick={onClose} />
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {visibleNav.map((item) => (
              <li key={item.href}>
                <NavRow
                  item={item}
                  active={isActive(item.href)}
                  pending={pendingHref === item.href}
                  count={badgeCount(item.badge)}
                  onClick={navigateTo(item.href)}
                />
              </li>
            ))}
          </ul>

          {visibleConfig.length > 0 && (
            <div className="mt-4 border-t border-sidebar-border pt-3">
              <p className="px-3 pb-1.5 text-label font-bold uppercase tracking-wide text-sidebar-fg-faint">Configuration</p>
              <ul className="space-y-0.5">
                {visibleConfig.map((item) => (
                  <li key={item.href}>
                    <NavRow
                      item={item}
                      active={isActive(item.href)}
                      pending={pendingHref === item.href}
                      count={0}
                      onClick={navigateTo(item.href)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>

        {/* Synchronisation */}
        <div className="shrink-0 border-t border-sidebar-border px-3 py-3">
          <p className="mb-2 flex items-center justify-between gap-2 text-label">
            <span className="shrink-0 whitespace-nowrap text-sidebar-fg-faint">Dernière synchro</span>
            <span className="truncate font-semibold text-sidebar-fg-muted tabular-nums" title={formatSync ?? undefined}>{formatSync ?? 'aucune'}</span>
          </p>

          {canSync && (
            <>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className={cx(
                  'flex h-8 w-full items-center justify-center gap-2 rounded-control text-caption font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
                  syncing
                    ? 'cursor-not-allowed bg-sidebar-raised text-sidebar-fg-faint'
                    : 'bg-sidebar-active text-sidebar-fg hover:bg-sidebar-raised'
                )}
              >
                <RefreshCw className={cx('h-3.5 w-3.5 shrink-0', syncing && 'animate-spin')} />
                {syncing ? 'Synchronisation en cours…' : 'Synchroniser maintenant'}
              </button>

              {/* Progression / résultat par territoire */}
              {territoryStatus && (syncing || doneMsg) && (
                <div className="mt-2 flex items-center justify-between gap-2 text-label">
                  <div className="flex items-center gap-2.5">
                    {TERRITORIES.map(({ key, label }) => {
                      const s = territoryStatus[key]
                      return (
                        <span key={key} className={cx('inline-flex items-center gap-1 font-semibold', STATUS_CLASS[s])} title={label}>
                          {s === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
                          {s === 'success' && '✓'}
                          {s === 'error'   && '✗'}
                          {s === 'pending' && '·'}
                          {key.toUpperCase()}
                        </span>
                      )
                    })}
                  </div>
                  {!syncing && doneMsg && <span className="truncate text-sidebar-fg-muted">{doneMsg}</span>}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
