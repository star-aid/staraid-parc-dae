import { FiltersSkeleton, PageSkeleton, TableSkeleton } from '@/components/ui/skeleton'

// Squelette du parc : en-tête, barre de filtres, tableau
export default function ParcLoading() {
  return (
    <PageSkeleton label="Chargement du parc DAE" className="max-w-[1600px]">
      <FiltersSkeleton />
      <TableSkeleton rows={14} cols={8} />
    </PageSkeleton>
  )
}
