'use client'

import { useEffect, useState, useCallback } from 'react'
import { INTERNAL_FIELDS } from '@/lib/field-mapping'
import BackButton from '@/components/BackButton'

interface SyncField {
  synchroteam_field_id: number
  synchroteam_label: string
  synchroteam_type: string
  suggestion: { internal: string; type: string } | null
}

interface Mapping {
  id: string
  synchroteam_field_id: number
  synchroteam_label: string
  internal_field: string
  field_type: string
  updated_at: string
}

interface UnmappedField {
  id: number
  label: string
  type: string
}

type DiscoverResult = {
  total: number
  auto_mapped: number
  suggestions: SyncField[]
  internal_fields: typeof INTERNAL_FIELDS
} | null

export default function FieldMappingPage() {
  const [mappings, setMappings]       = useState<Mapping[]>([])
  const [unmapped, setUnmapped]       = useState<UnmappedField[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [loading, setLoading]         = useState(true)
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult>(null)
  const [error, setError]             = useState<string | null>(null)

  // État local pour les champs non mappés en cours d'édition
  const [pendingMappings, setPendingMappings] = useState<
    Record<number, { internal: string; type: string }>
  >({})

  const loadMappings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/field-mapping')
      const data = await res.json() as { mappings: Mapping[]; unmapped: UnmappedField[] }
      setMappings(data.mappings ?? [])
      setUnmapped(data.unmapped ?? [])
    } catch {
      setError('Impossible de charger les mappings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadMappings() }, [loadMappings])

  async function handleDiscover() {
    setDiscovering(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/field-mapping/discover', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        setError(d.error)
        return
      }
      const data = await res.json() as DiscoverResult
      setDiscoverResult(data)
      await loadMappings()
    } catch {
      setError('Erreur lors de la discovery.')
    } finally {
      setDiscovering(false)
    }
  }

  async function handleSaveMapping(fieldId: number, label: string) {
    const pending = pendingMappings[fieldId]
    if (!pending?.internal) return

    setSaving(true)
    try {
      const res = await fetch('/api/admin/field-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: [{
            synchroteam_field_id: fieldId,
            synchroteam_label:    label,
            internal_field:       pending.internal,
            field_type:           pending.type || 'text',
          }],
        }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        setError(d.error)
        return
      }
      setPendingMappings((prev) => { const n = { ...prev }; delete n[fieldId]; return n })
      await loadMappings()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(fieldId: number) {
    if (!confirm('Supprimer ce mapping ?')) return
    await fetch(`/api/admin/field-mapping?field_id=${fieldId}`, { method: 'DELETE' })
    await loadMappings()
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-4">
        <BackButton label="Tableau de bord" />
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mapping custom fields</h1>
          <p className="text-sm text-gray-500 mt-1">
            Associe les champs Synchroteam aux champs internes du parc DAE.
          </p>
        </div>
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {discovering ? '⏳ Discovery en cours…' : '🔍 Lancer la discovery'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {discoverResult && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-sm">
          <strong className="text-green-800">Discovery terminée :</strong>
          <span className="text-green-700 ml-2">
            {discoverResult.total} champ(s) trouvé(s) — {discoverResult.auto_mapped} mappé(s) automatiquement.
          </span>
        </div>
      )}

      {/* Mappings existants */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-800 mb-3">
          Mappings actifs ({mappings.length})
        </h2>

        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : mappings.length === 0 ? (
          <p className="text-sm text-gray-400">Aucun mapping. Lancer la discovery ou ajouter manuellement.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">ID Synchroteam</th>
                  <th className="px-4 py-3 text-left">Label Synchroteam</th>
                  <th className="px-4 py-3 text-left">Champ interne</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Mis à jour</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mappings.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-500">{m.synchroteam_field_id}</td>
                    <td className="px-4 py-3 text-gray-900">{m.synchroteam_label}</td>
                    <td className="px-4 py-3">
                      <code className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">
                        {m.internal_field}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{m.field_type}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(m.updated_at).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(m.synchroteam_field_id)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Champs non mappés */}
      {unmapped.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-800 mb-3">
            Champs non mappés ({unmapped.length})
          </h2>
          <div className="border border-amber-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-amber-50 text-amber-700 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Label Synchroteam</th>
                  <th className="px-4 py-3 text-left">Type Synchroteam</th>
                  <th className="px-4 py-3 text-left">Champ interne</th>
                  <th className="px-4 py-3 text-left">Type interne</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {unmapped.map((f) => {
                  const pending = pendingMappings[f.id]
                  return (
                    <tr key={f.id} className="bg-white hover:bg-amber-50/40">
                      <td className="px-4 py-3 font-mono text-gray-500">{f.id}</td>
                      <td className="px-4 py-3 text-gray-900">{f.label}</td>
                      <td className="px-4 py-3 text-gray-500">{f.type}</td>
                      <td className="px-4 py-3">
                        <select
                          className="border border-gray-200 rounded px-2 py-1 text-xs w-full"
                          value={pending?.internal ?? ''}
                          onChange={(e) =>
                            setPendingMappings((prev) => ({
                              ...prev,
                              [f.id]: {
                                internal: e.target.value,
                                type: prev[f.id]?.type ?? f.type ?? 'text',
                              },
                            }))
                          }
                        >
                          <option value="">— Choisir —</option>
                          {INTERNAL_FIELDS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="border border-gray-200 rounded px-2 py-1 text-xs"
                          value={pending?.type ?? f.type ?? 'text'}
                          onChange={(e) =>
                            setPendingMappings((prev) => ({
                              ...prev,
                              [f.id]: { internal: prev[f.id]?.internal ?? '', type: e.target.value },
                            }))
                          }
                        >
                          <option value="date">date</option>
                          <option value="text">text</option>
                          <option value="number">number</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          disabled={!pending?.internal || saving}
                          onClick={() => handleSaveMapping(f.id, f.label)}
                          className="bg-blue-600 text-white text-xs px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-40 transition-colors"
                        >
                          Sauvegarder
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
