import { CardSkeleton, PageSkeleton, Skeleton, TableSkeleton } from '@/components/ui/skeleton'

// Squelette de la fiche DAE : en-tête, 3 cartes, localisation + carte, historique
export default function ParcDetailLoading() {
  return (
    <PageSkeleton label="Chargement de la fiche DAE" withEyebrow action={false}>
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-card">
        <div className="flex gap-4">
          <Skeleton className="h-11 w-11 rounded-lg" />
          <div className="flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-5 w-64" />
            <Skeleton className="mt-2 h-4 w-28" />
          </div>
          <div className="hidden text-right sm:block">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <CardSkeleton lines={6} />
        <CardSkeleton lines={4} />
        <CardSkeleton lines={7} />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <CardSkeleton lines={6} />
        <div className="h-[330px] rounded-lg border border-slate-200 bg-slate-100 shadow-card" aria-hidden />
      </div>
      <TableSkeleton rows={5} cols={6} />
    </PageSkeleton>
  )
}
