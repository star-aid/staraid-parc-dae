export default function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Tableau de bord</h1>

      {/* KPI cards placeholder */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total DAE', value: '—', color: 'bg-blue-50 border-blue-200' },
          { label: 'Conformes', value: '—', color: 'bg-green-50 border-green-200' },
          { label: 'Vigilance', value: '—', color: 'bg-amber-50 border-amber-200' },
          { label: 'Critiques', value: '—', color: 'bg-red-50 border-red-200' },
        ].map((card) => (
          <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
            <p className="text-sm text-gray-600">{card.label}</p>
            <p className="text-3xl font-bold mt-1 text-gray-900">{card.value}</p>
          </div>
        ))}
      </div>

      <p className="text-gray-400 text-sm">Connectez Supabase pour afficher les données réelles.</p>
    </div>
  )
}
