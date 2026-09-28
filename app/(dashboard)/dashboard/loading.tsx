import { CardSkeleton, PageSkeleton, Skeleton } from '@/components/ui/skeleton'

// Squelette du tableau de bord : 4 tuiles, 2 rangées de cartes
export default function DashboardLoading() {
  return (
    <PageSkeleton label="Chargement du tableau de bord">
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-card border border-border bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-7 w-7 rounded-control" />
            </div>
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-2 h-2.5 w-24" />
          </div>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardSkeleton lines={5} height="h-52" />
        <CardSkeleton lines={5} height="h-52" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <CardSkeleton className="xl:col-span-2" lines={5} height="h-52" />
        <CardSkeleton className="xl:col-span-3" lines={6} height="h-52" />
      </div>
    </PageSkeleton>
  )
}
