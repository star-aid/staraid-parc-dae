export const dynamic = 'force-dynamic'

import BackButton from '@/components/BackButton'
import { Card, PageContainer, PageHeader } from '@/components/ui/primitives'

export default function AnalysePage() {
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        eyebrow={<BackButton label="Tableau de bord" />}
        title="Analyse IA"
        subtitle="Assistant d'analyse du parc : priorisation des interventions, projection des échéances, détection d'anomalies."
      />
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
            </svg>
          </span>
          <p className="text-13 font-medium text-slate-800">Module en préparation</p>
          <p className="max-w-sm text-xs text-slate-500">
            L&apos;agent conversationnel s&apos;appuiera sur l&apos;état du parc synchronisé pour répondre à des questions
            comme « quels DAE sont les plus urgents ? » ou « quel est le taux de conformité par territoire ? ».
          </p>
        </div>
      </Card>
    </PageContainer>
  )
}
