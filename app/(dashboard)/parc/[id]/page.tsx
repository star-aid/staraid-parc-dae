interface Props {
  params: { id: string }
}

export default function ParcDetailPage({ params }: Props) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Fiche DAE #{params.id}</h1>
      <p className="text-gray-400 text-sm">Détail DAE — à implémenter.</p>
    </div>
  )
}
