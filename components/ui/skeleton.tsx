// Squelettes de chargement : affichés instantanément par les fichiers loading.tsx
// pendant que le serveur prépare la page. Ils reprennent la structure réelle de
// chaque écran pour que la bascule vers le contenu se fasse sans saut de mise en page.
import type { ReactNode } from 'react'
import { PageContainer, cx, tableWrapClass } from './primitives'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-control bg-surface-sunken', className)} aria-hidden />
}

/** Conteneur de page avec en-tête fantôme (titre, sous-titre, action) */
export function PageSkeleton({
  label, children, className, withEyebrow = false, action = true,
}: {
  label: string
  children: ReactNode
  className?: string
  withEyebrow?: boolean
  action?: boolean
}) {
  return (
    <PageContainer className={className}>
      <div role="status" aria-live="polite" aria-busy="true" aria-label={label}>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {withEyebrow && <Skeleton className="mb-2 h-4 w-24" />}
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-2 h-3.5 w-72" />
          </div>
          {action && <Skeleton className="h-8 w-36" />}
        </div>
        {children}
      </div>
    </PageContainer>
  )
}

/** Carte fantôme : ligne de titre puis quelques lignes de contenu */
export function CardSkeleton({ className, lines = 3, height }: { className?: string; lines?: number; height?: string }) {
  return (
    <div className={cx('rounded-card border border-border bg-surface shadow-card', className)}>
      <div className="border-b border-border-subtle px-4 py-3">
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div className={cx('space-y-2.5 p-4', height)}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cx('h-3', i % 3 === 0 ? 'w-full' : i % 3 === 1 ? 'w-5/6' : 'w-2/3')} />
        ))}
      </div>
    </div>
  )
}

/** Tableau fantôme : en-tête puis lignes de cellules de largeurs variées */
export function TableSkeleton({ rows = 10, cols = 6, className }: { rows?: number; cols?: number; className?: string }) {
  const widths = ['w-24', 'w-32', 'w-40', 'w-20', 'w-28', 'w-16', 'w-36', 'w-24']
  return (
    <div className={cx(tableWrapClass, className)}>
      <div className="flex h-9 items-center gap-6 border-b border-border bg-surface-muted px-3">
        {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} className={cx('h-2.5', widths[i % widths.length])} />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex h-9 items-center gap-6 border-t border-border-subtle px-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cx('h-2.5', widths[(c + r) % widths.length])} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Barre de filtres fantôme */
export function FiltersSkeleton({ className }: { className?: string }) {
  return (
    <div className={cx('mb-3 flex flex-wrap items-center gap-2', className)}>
      <Skeleton className="h-8 w-60" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="ml-auto h-8 w-24" />
    </div>
  )
}
