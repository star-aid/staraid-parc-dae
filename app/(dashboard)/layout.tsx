import type { ReactNode } from 'react'
import Link from 'next/link'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-lg font-bold text-blue-700">STAR aid</h1>
          <p className="text-xs text-gray-500 mt-0.5">Parc DAE</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <span>📊</span> Tableau de bord
          </Link>
          <Link
            href="/parc"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <span>🏥</span> Parc DAE
          </Link>
          <Link
            href="/alertes"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <span>🚨</span> Alertes
          </Link>
          <Link
            href="/analyse"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <span>🤖</span> Analyse IA
          </Link>

          <div className="pt-3 mt-3 border-t border-gray-100">
            <Link
              href="/admin/field-mapping"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100"
            >
              <span>⚙️</span> Mapping champs
            </Link>
          </div>
        </nav>

        <div className="p-4 border-t border-gray-200 text-xs text-gray-400">
          <p>Dernière sync : —</p>
          <button className="mt-2 text-blue-600 hover:underline">
            Synchroniser maintenant
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
