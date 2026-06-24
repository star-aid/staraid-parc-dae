export const dynamic = 'force-dynamic'

import BackButton from '@/components/BackButton'

export default function AnalysePage() {
  return (
    <div className="p-8">
      <div className="mb-4">
        <BackButton label="Tableau de bord" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analyse IA</h1>
      <p className="text-gray-400 text-sm">Agent Claude Sonnet — à implémenter.</p>
    </div>
  )
}
