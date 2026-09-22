import { FiltersSkeleton, PageSkeleton, TableSkeleton } from '@/components/ui/skeleton'

// Squelette des alertes : en-tête, filtres, tableau
export default function AlertesLoading() {
  return (
    <PageSkeleton label="Chargement des alertes" withEyebrow>
      <FiltersSkeleton />
      <TableSkeleton rows={12} cols={7} />
    </PageSkeleton>
  )
}
