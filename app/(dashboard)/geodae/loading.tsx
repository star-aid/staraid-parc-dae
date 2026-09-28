import { PageSkeleton, Skeleton } from '@/components/ui/skeleton'

// Squelette du contrôle Géo'DAE : en-tête et zone d'accueil
export default function GeodaeLoading() {
  return (
    <PageSkeleton label="Chargement du contrôle Géo'DAE" withEyebrow>
      <Skeleton className="h-40 w-full rounded-lg" />
    </PageSkeleton>
  )
}
