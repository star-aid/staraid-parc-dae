'use client'

import { useEffect, useState, useCallback } from 'react'
import { INTERNAL_FIELDS } from '@/lib/field-mapping'
import BackButton from '@/components/BackButton'
import { RefreshCw, Settings2, Trash2 } from 'lucide-react'
import {
  Button, Card, EmptyState, Notice, PageContainer, PageHeader, Select, cx,
  tableClass, tbodyClass, tdClass, thClass, theadClass, trClass,
} from '@/components/ui/primitives'

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
  const [pendingMappings, setPendingMappings] = useState<Record<number, { internal: string; type: string }>>({})

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

  const internalLabel = (value: string) => INTERNAL_FIELDS.find((f) => f.value === value)?.label ?? value

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        eyebrow={<BackButton label="Tableau de bord" />}
        title="Mapping des champs Synchroteam"
        subtitle="Associe chaque champ personnalisé Synchroteam à un champ interne du parc DAE. La discovery lit les champs du compte et propose un mapping automatique."
        actions={
          <Button variant="primary" size="md" icon={RefreshCw} loading={discovering} onClick={handleDiscover}>
            {discovering ? 'Discovery en cours…' : 'Lancer la discovery'}
          </Button>
        }
      />

      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

      {discoverResult && (
        <Notice tone="success" className="mb-4 tabular-nums">
          <strong className="font-semibold">Discovery terminée.</strong>{' '}
          {discoverResult.total} champ{discoverResult.total > 1 ? 's' : ''} trouvé{discoverResult.total > 1 ? 's' : ''}, {discoverResult.auto_mapped} mappé{discoverResult.auto_mapped > 1 ? 's' : ''} automatiquement.
        </Notice>
      )}

      {/* ── Mappings actifs ─────────────────────────────────────────────────── */}
      <Card title={`Mappings actifs (${mappings.length})`} className="mb-4" padded={false}>
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-control bg-surface-sunken" />)}
          </div>
        ) : mappings.length === 0 ? (
          <EmptyState icon={Settings2} title="Aucun mapping" description="Lancez la discovery ou ajoutez-en manuellement ci-dessous." />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>ID</th>
                  <th className={thClass}>Libellé Synchroteam</th>
                  <th className={thClass}>Champ interne</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Mis à jour</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody className={tbodyClass}>
                {mappings.map((m) => (
                  <tr key={m.id} className={trClass}>
                    <td className={cx(tdClass, 'font-mono text-caption text-fg-faint')}>{m.synchroteam_field_id}</td>
                    <td className={cx(tdClass, 'text-fg')}>{m.synchroteam_label}</td>
                    <td className={tdClass}>
                      <span className="inline-flex items-center gap-1.5 rounded-control bg-surface-sunken px-1.5 py-0.5 text-caption text-fg-secondary">
                        <code className="font-mono text-label text-fg-muted">{m.internal_field}</code>
                        <span className="text-border-strong">·</span>
                        {internalLabel(m.internal_field)}
                      </span>
                    </td>
                    <td className={cx(tdClass, 'text-caption text-fg-muted')}>{m.field_type}</td>
                    <td className={cx(tdClass, 'text-caption text-fg-faint tabular-nums')}>{new Date(m.updated_at).toLocaleDateString('fr-FR')}</td>
                    <td className={cx(tdClass, 'text-right')}>
                      <Button variant="danger-outline" size="xs" icon={Trash2} onClick={() => handleDelete(m.synchroteam_field_id)}>
                        Supprimer
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Champs non mappés ───────────────────────────────────────────────── */}
      {unmapped.length > 0 && (
        <Card
          title={`Champs non mappés (${unmapped.length})`}
          actions={<span className="text-caption text-warning">Choisissez le champ interne, puis enregistrez</span>}
          padded={false}
        >
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>ID</th>
                  <th className={thClass}>Libellé Synchroteam</th>
                  <th className={thClass}>Type Synchroteam</th>
                  <th className={thClass}>Champ interne</th>
                  <th className={thClass}>Type interne</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody className={tbodyClass}>
                {unmapped.map((f) => {
                  const pending = pendingMappings[f.id]
                  return (
                    <tr key={f.id} className={trClass}>
                      <td className={cx(tdClass, 'font-mono text-caption text-fg-faint')}>{f.id}</td>
                      <td className={cx(tdClass, 'text-fg')}>{f.label}</td>
                      <td className={cx(tdClass, 'text-caption text-fg-muted')}>{f.type}</td>
                      <td className={tdClass}>
                        <Select
                          wrapperClassName="w-full min-w-[220px]"
                          value={pending?.internal ?? ''}
                          onChange={(e) =>
                            setPendingMappings((prev) => ({
                              ...prev,
                              [f.id]: { internal: e.target.value, type: prev[f.id]?.type ?? f.type ?? 'text' },
                            }))
                          }
                        >
                          <option value="">Choisir…</option>
                          {INTERNAL_FIELDS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </Select>
                      </td>
                      <td className={tdClass}>
                        <Select
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
                        </Select>
                      </td>
                      <td className={cx(tdClass, 'text-right')}>
                        <Button variant="primary" size="xs" disabled={!pending?.internal || saving} onClick={() => handleSaveMapping(f.id, f.label)}>
                          Enregistrer
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageContainer>
  )
}
