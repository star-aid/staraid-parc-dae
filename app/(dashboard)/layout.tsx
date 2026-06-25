import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { createServiceClient, createSessionClient, type UserRole } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import ContratFilterBar from '@/components/dashboard/ContratFilterBar'
import ClientFilterBar, { type ClientOption } from '@/components/dashboard/ClientFilterBar'

export const dynamic = 'force-dynamic'

async function getSidebarData() {
  try {
    const supabase = createServiceClient()
    const [critiqueRes, syncRes, clientsRes] = await Promise.all([
      supabase
        .from('defibrillators')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'critique')
        .eq('active', true),
      supabase
        .from('sync_logs')
        .select('finished_at')
        .eq('source', 'synchroteam')
        .eq('status', 'success')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('clients')
        .select('id, name')
        .eq('active', true)
        .order('name')
        .limit(1000),
    ])
    return {
      critiqueCount: critiqueRes.count ?? 0,
      lastSync: syncRes.data?.finished_at ?? null,
      clients: (clientsRes.data ?? []) as ClientOption[],
    }
  } catch {
    return { critiqueCount: 0, lastSync: null, clients: [] as ClientOption[] }
  }
}

async function getCurrentUser() {
  try {
    const supabase = await createSessionClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    return {
      email: user.email ?? '',
      name:  (user.user_metadata?.name as string | undefined) ?? user.email?.split('@')[0] ?? '',
      role:  ((user.user_metadata?.role as string | undefined) ?? 'direction') as UserRole,
    }
  } catch {
    return null
  }
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const [{ critiqueCount, lastSync, clients }, currentUser] = await Promise.all([
    getSidebarData(),
    getCurrentUser(),
  ])

  const userRole = currentUser?.role ?? 'direction'

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar
        critiqueCount={critiqueCount}
        lastSync={lastSync}
        userRole={userRole}
        userName={currentUser?.name ?? ''}
        userEmail={currentUser?.email ?? ''}
      />

      {/* Colonne droite : filtres globaux + contenu scrollable */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Barre de filtres globaux — persistante sur toutes les pages dashboard */}
        <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-2.5 flex items-center gap-3 flex-wrap pt-14 lg:pt-2.5">
          <Suspense fallback={<div className="h-[28px] w-60" />}>
            <ContratFilterBar />
          </Suspense>
          <div className="w-px h-5 bg-slate-200 shrink-0 hidden sm:block" />
          <Suspense fallback={<div className="h-[28px] w-48" />}>
            <ClientFilterBar clients={clients} />
          </Suspense>
        </div>

        {/* Zone de contenu principale scrollable */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
