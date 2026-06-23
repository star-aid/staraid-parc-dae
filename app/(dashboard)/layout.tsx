import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'
import ContratFilterBar from '@/components/dashboard/ContratFilterBar'

export const dynamic = 'force-dynamic'

async function getSidebarData() {
  try {
    const supabase = createServiceClient()
    const [critiqueRes, syncRes] = await Promise.all([
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
    ])
    return {
      critiqueCount: critiqueRes.count ?? 0,
      lastSync: syncRes.data?.finished_at ?? null,
    }
  } catch {
    return { critiqueCount: 0, lastSync: null }
  }
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { critiqueCount, lastSync } = await getSidebarData()

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar critiqueCount={critiqueCount} lastSync={lastSync} />

      {/* Colonne droite : filtre global + contenu scrollable */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Barre de filtre contrat — persistante sur toutes les pages dashboard */}
        <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-2.5 flex items-center gap-3 pt-14 lg:pt-2.5">
          <Suspense fallback={<div className="h-[28px]" />}>
            <ContratFilterBar />
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
