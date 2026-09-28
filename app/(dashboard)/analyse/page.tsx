export const dynamic = 'force-dynamic'

import { Sparkles } from 'lucide-react'
import BackButton from '@/components/BackButton'
import { Card, EmptyState, PageContainer, PageHeader } from '@/components/ui/primitives'

export default function AnalysePage() {
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        eyebrow={<BackButton label="Tableau de bord" />}
        title="Analyse IA"
        subtitle="Assistant d'analyse du parc : priorisation des interventions, projection des échéances, détection d'anomalies."
      />
      <Card>
        <EmptyState
          icon={Sparkles}
          title="Module en préparation"
          description="L'agent conversationnel s'appuiera sur l'état du parc synchronisé pour répondre à des questions comme « quels DAE sont les plus urgents ? » ou « quel est le taux de conformité par territoire ? »."
        />
      </Card>
    </PageContainer>
  )
}
