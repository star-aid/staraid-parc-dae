import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { createServiceClient, type UserRole } from '@/lib/supabase'
import { createSessionClient } from '@/lib/supabase-server'
import Sidebar from '@/components/dashboard/Sidebar'
import ContratFilterBar from '@/components/dashboard/ContratFilterBar'
import ClientFilterBar, { type ClientOption } from '@/components/dashboard/ClientFilterBar'

export const dynamic = 'force-dynamic'

async function getSidebarData() {
  try {
    const supabase = createServiceClient()
    const { LOCATION_TYPES, MAINTENANCE_TYPES } = await import('@/lib/contract-groups')
    const [critiqueRes, syncRes, clientsRes, autreTypesRes] = await Promise.all([
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
      // Récupère les types de contrats "Autres" (hors Location et Maintenance)
      supabase
        .from('defibrillators')
        .select('contract_type')
        .not('contract_type', 'is', null)
        .not('contract_type', 'in', `(${[...LOCATION_TYPES, ...MAINTENANCE_TYPES].join(',')})`)
        .order('contract_type'),
    ])

    // Comptage des types "Autres" côté JS
    const autreCountMap = new Map<string, number>()
    for (const row of (autreTypesRes.data ?? [])) {
      const t = row.contract_type as string
      autreCountMap.set(t, (autreCountMap.get(t) ?? 0) + 1)
    }
    const autreTypes = Array.from(autreCountMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type))

    return {
      critiqueCount: critiqueRes.count ?? 0,
      lastSync: syncRes.data?.finished_at ?? null,
      clients: (clientsRes.data ?? []) as ClientOption[],
      autreTypes,
    }
  } catch {
    return { critiqueCount: 0, lastSync: null, clients: [] as ClientOption[], autreTypes: [] }
  }
}

async function getCurrentUser() {
  try {
    const supabase = await createSessionClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    // Identifiant court = email sans @parc-dae.local (ex: "admin")
    const identifier = (user.email ?? '').replace('@parc-dae.local', '')
    return {
      email:      user.email ?? '',
      name:       (user.user_metadata?.name as string | undefined) ?? identifier,
      identifier,
      role:       ((user.user_metadata?.role as string | undefined) ?? 'direction') as UserRole,
    }
  } catch {
    return null
  }
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const [{ critiqueCount, lastSync, clients, autreTypes }, currentUser] = await Promise.all([
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
            <ContratFilterBar autreTypes={autreTypes} />
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
