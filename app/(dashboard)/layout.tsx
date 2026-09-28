import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { createServiceClient, type UserRole } from '@/lib/supabase'
import { createSessionClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/auth/session'
import Sidebar from '@/components/dashboard/Sidebar'
import ContratFilterBar from '@/components/dashboard/ContratFilterBar'
import ClientFilterBar, { type ClientOption } from '@/components/dashboard/ClientFilterBar'
import { LOCATION_TYPES, MAINTENANCE_TYPES, SANS_CONTRAT_SENTINEL, SANS_CONTRAT_STRINGS, type AutreType } from '@/lib/contract-groups'

export const dynamic = 'force-dynamic'

type SidebarData = {
  critiqueCount: number
  geodaeAnomalyCount: number
  lastSync: string | null
  clients: ClientOption[]
  autreTypes: AutreType[]
}
const EMPTY_SIDEBAR: SidebarData = { critiqueCount: 0, geodaeAnomalyCount: 0, lastSync: null, clients: [], autreTypes: [] }

// Données de la barre latérale, communes à tous les utilisateurs : une seule
// vague de requêtes parallèles, la répartition par type de contrat étant
// agrégée en SQL (get_contract_type_counts, migration 20260928000013) au lieu
// de lire la colonne de chaque DAE, ce qui était plafonné à 1 000 lignes.
async function fetchSidebarData(): Promise<SidebarData> {
  const supabase = createServiceClient()
  // Types exclus des « Autres » : Location, Maintenance et valeurs « sans contrat »
  const excludedFromAutre = new Set<string>([...LOCATION_TYPES, ...MAINTENANCE_TYPES, ...SANS_CONTRAT_STRINGS])
  const [critiqueRes, syncRes, clientsRes, typesRes, geodaeRes] = await Promise.all([
    supabase
      .from('defibrillators')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'critique')
      .eq('active', true),
    supabase
      .from('sync_logs')
      .select('finished_at')
      .in('source', ['synchroteam_reu', 'synchroteam_myt', 'synchroteam_glp', 'synchroteam'])
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
    supabase.rpc('get_contract_type_counts'),
    // Anomalies Géo'DAE ouvertes, pour le badge du menu (table absente avant la migration 9 : erreur ignorée)
    supabase
      .from('geodae_anomalies')
      .select('id', { count: 'exact', head: true })
      .is('resolved_at', null),
  ])
  if (typesRes.error) throw new Error(`get_contract_type_counts : ${typesRes.error.message}`)

  const autreTypes: AutreType[] = []
  let sansContratCount = 0
  for (const r of (typesRes.data ?? []) as Array<{ contract_type: string | null; dae_count: number }>) {
    const n = Number(r.dae_count)
    if (r.contract_type === null || SANS_CONTRAT_STRINGS.includes(r.contract_type)) {
      sansContratCount += n
      continue
    }
    if (excludedFromAutre.has(r.contract_type)) continue
    autreTypes.push({ type: r.contract_type, count: n })
  }
  autreTypes.sort((a, b) => a.type.localeCompare(b.type))
  // « Sans contrat » en premier si des DAE concernés existent
  if (sansContratCount > 0) autreTypes.unshift({ type: SANS_CONTRAT_SENTINEL, count: sansContratCount })

  return {
    critiqueCount: critiqueRes.count ?? 0,
    geodaeAnomalyCount: geodaeRes.error ? 0 : (geodaeRes.count ?? 0),
    lastSync: syncRes.data?.finished_at ?? null,
    clients: (clientsRes.data ?? []) as ClientOption[],
    autreTypes,
  }
}

// Ces données ne changent qu'à la synchronisation (quotidienne) ou au
// rapprochement Géo'DAE : on les garde en mémoire 2 minutes au lieu de refaire
// 5 requêtes à chaque chargement complet. Une erreur vide le cache.
const SIDEBAR_TTL_MS = 120_000
let sidebarCache: { at: number; promise: Promise<SidebarData> } | null = null

function getSidebarData(): Promise<SidebarData> {
  const now = Date.now()
  if (!sidebarCache || now - sidebarCache.at > SIDEBAR_TTL_MS) {
    const promise = fetchSidebarData().catch((err: unknown) => {
      sidebarCache = null
      throw err
    })
    sidebarCache = { at: now, promise }
  }
  return sidebarCache.promise
}

async function getCurrentUser() {
  try {
    // Jeton vérifié localement : pas d'aller-retour vers Supabase Auth à chaque page
    const user = await getSessionUser(await createSessionClient())
    if (!user) return null
    // Identifiant court = email sans @parc-dae.local (ex: "admin")
    const identifier = (user.email ?? '').replace('@parc-dae.local', '')
    return {
      email:      user.email ?? '',
      name:       user.name ?? identifier,
      identifier,
      role:       user.role as UserRole,
    }
  } catch {
    return null
  }
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const [{ critiqueCount, geodaeAnomalyCount, lastSync, clients, autreTypes }, currentUser] = await Promise.all([
    getSidebarData().catch((err: unknown) => {
      console.error('getSidebarData:', err)
      return EMPTY_SIDEBAR
    }),
    getCurrentUser(),
  ])

  const userRole = currentUser?.role ?? 'direction'

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar
        critiqueCount={critiqueCount}
        geodaeAnomalyCount={geodaeAnomalyCount}
        lastSync={lastSync}
        userRole={userRole}
        userName={currentUser?.name ?? ''}
        userEmail={currentUser?.email ?? ''}
      />

      {/* Colonne droite : filtres globaux + contenu scrollable */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Barre de filtres globaux — persistante sur toutes les pages dashboard */}
        <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-white/90 px-5 py-1.5 pt-[3.375rem] backdrop-blur lg:px-7 lg:pt-1.5">
          <Suspense fallback={<div className="h-7 w-64 rounded-md bg-slate-100" />}>
            <ContratFilterBar autreTypes={autreTypes} />
          </Suspense>
          <div className="hidden h-5 w-px bg-slate-200 sm:block" />
          <Suspense fallback={<div className="h-7 w-44 rounded-md bg-slate-100" />}>
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
