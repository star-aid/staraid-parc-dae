'use client'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/primitives'

/** Retour à la page précédente, en tête de page (eyebrow du PageHeader) */
export default function BackButton({ label = 'Retour' }: { label?: string }) {
  const router = useRouter()
  return (
    <Button variant="ghost" size="xs" icon={ArrowLeft} onClick={() => router.back()} className="-ml-2.5 text-fg-muted">
      {label}
    </Button>
  )
}
