'use client'
// Composition de l'espace connecté : bandeau rouge en haut, navigation sombre
// à gauche, barre d'outils des filtres globaux puis contenu clair défilant.
// Composant client pour porter l'état du tiroir mobile ; les données viennent
// du layout serveur.
import { useState, type ReactNode } from 'react'
import type { UserRole } from '@/lib/supabase'
import Header from './Header'
import Sidebar from './Sidebar'

interface AppShellProps {
  critiqueCount: number
  geodaeAnomalyCount: number
  lastSync: string | null
  userRole: UserRole
  userName: string
  userEmail: string
  /** Filtres globaux (contrat, client), rendus par le layout serveur */
  toolbar: ReactNode
  children: ReactNode
}

export default function AppShell({
  critiqueCount, geodaeAnomalyCount, lastSync, userRole, userName, userEmail, toolbar, children,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-muted">
      <Header userName={userName} userEmail={userEmail} userRole={userRole} onOpenNav={() => setNavOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          critiqueCount={critiqueCount}
          geodaeAnomalyCount={geodaeAnomalyCount}
          lastSync={lastSync}
          userRole={userRole}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Barre d'outils : filtres globaux, persistants sur toutes les pages */}
          <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border bg-surface px-4 py-1.5 sm:px-6 lg:px-8">
            {toolbar}
          </div>

          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
