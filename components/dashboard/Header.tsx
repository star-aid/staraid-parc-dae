'use client'
// Bandeau supérieur rouge : le repère de marque de l'application (comme dans
// prospection-app). Il porte le logo, le nom du module, l'ouverture du menu sur
// mobile et le menu utilisateur. Les actions métier restent dans les pages.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, LogOut, Menu } from 'lucide-react'
import { getSupabaseBrowserClient, type UserRole } from '@/lib/supabase'
import { Button, IconButton, cx } from '@/components/ui/primitives'

export const ROLE_LABELS: Record<UserRole, string> = {
  administrateur: 'Administrateur',
  maintenance:    'Gestionnaire de maintenance',
  direction:      'Consultation du parc',
}

interface HeaderProps {
  userName: string
  userEmail: string
  userRole: UserRole
  onOpenNav: () => void
}

export default function Header({ userName, userEmail, userRole, onOpenNav }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 bg-brand pl-3 pr-4 text-brand-foreground sm:pr-5">
      <IconButton icon={Menu} label="Ouvrir la navigation" variant="inverted-ghost" size="md" onClick={onOpenNav} className="lg:hidden" />

      {/* Marque : logo blanc sur le rouge, nom du module en dessous */}
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-star-aid-white.webp" alt="STAR aid" className="h-8 w-auto" />
        <span className="hidden leading-tight sm:block">
          <span className="block whitespace-nowrap text-body font-extrabold">Parc DAE</span>
          <span className="block whitespace-nowrap text-label text-brand-foreground/75">Réunion · Mayotte · Guadeloupe</span>
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center border-l border-white/20 pl-3">
        <UserMenu userName={userName} userEmail={userEmail} userRole={userRole} />
      </div>
    </header>
  )
}

// ─── Menu utilisateur : identité, rôle, déconnexion ──────────────────────────

function UserMenu({ userName, userEmail, userRole }: { userName: string; userEmail: string; userRole: UserRole }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fermeture au clic extérieur ou à Échap
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setConfirming(false) }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); setConfirming(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function logout() {
    setLeaving(true)
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initial = (userName || userEmail || '?').slice(0, 1).toUpperCase()

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setConfirming(false) }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Menu du profil"
        className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-1.5 text-brand-foreground transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-label font-bold">{initial}</span>
        <span className="hidden whitespace-nowrap text-caption font-semibold sm:inline">{userName}</span>
        <ChevronDown className={cx('h-3.5 w-3.5 text-white/70 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-60 overflow-hidden rounded-card border border-border bg-surface text-fg shadow-float">
          <div className="border-b border-border-subtle px-3.5 py-2.5">
            <p className="truncate text-body font-semibold text-fg">{userName}</p>
            <p className="truncate text-caption text-fg-muted">{ROLE_LABELS[userRole]}</p>
            {userEmail && <p className="truncate text-caption text-fg-faint">{userEmail}</p>}
          </div>
          {confirming ? (
            <div className="flex flex-col gap-2 px-3.5 py-2.5">
              <p className="text-caption text-fg-muted">Vous devrez vous reconnecter pour accéder au parc.</p>
              <div className="flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>Annuler</Button>
                <Button variant="danger" size="xs" icon={LogOut} loading={leaving} onClick={logout}>Se déconnecter</Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-body font-medium text-fg-secondary transition-colors hover:bg-surface-sunken hover:text-danger"
            >
              <LogOut className="h-4 w-4" />
              Se déconnecter
            </button>
          )}
        </div>
      )}
    </div>
  )
}
