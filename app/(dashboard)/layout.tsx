import type { ReactNode } from 'react'
import { createServiceClient } from '@/lib/supabase'
import Sidebar from '@/components/dashboard/Sidebar'

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

      {/* Zone de contenu — padding-top mobile pour le header fixe */}
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  )
}
