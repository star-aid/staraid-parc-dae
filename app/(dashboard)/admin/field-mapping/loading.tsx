import { PageSkeleton, TableSkeleton } from '@/components/ui/skeleton'

// Squelette du mapping des champs : en-tête et tableau des mappings
export default function FieldMappingLoading() {
  return (
    <PageSkeleton label="Chargement du mapping des champs" className="max-w-5xl" withEyebrow>
      <TableSkeleton rows={8} cols={5} />
    </PageSkeleton>
  )
}
