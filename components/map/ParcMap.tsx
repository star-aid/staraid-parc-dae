'use client'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useEffect, useRef } from 'react'
import type {} from 'leaflet.markercluster'
import type L from 'leaflet'

export type MapMarker = {
  id: string
  latitude: number
  longitude: number
  status: string
  status_reason: string | null
  site_name: string | null
  client_name: string | null
  serial_number: string | null
  model: string | null
  territory_code: string | null
  next_expiry: string | null
}

interface Props {
  markers: MapMarker[]
  statusFilter: string[]
  territoryFilter: string[]
}

// Mêmes couleurs de statut que les badges et les graphiques
const STATUS_COLORS: Record<string, string> = {
  conforme:  '#059669',
  vigilance: '#f59e0b',
  critique:  '#dc2626',
  inconnu:   '#94a3b8',
}

const STATUS_LABELS: Record<string, string> = {
  conforme:  'Conforme',
  vigilance: 'Vigilance',
  critique:  'Critique',
  inconnu:   'Inconnu',
}

function fmtDate(s: string | null): string | null {
  if (!s) return null
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

type MarkerEntry = {
  circle: L.CircleMarker
  status: string
  territory_code: string | null
}

function isVisible(entry: MarkerEntry, sf: Set<string> | null, tf: Set<string> | null): boolean {
  if (sf && !sf.has(entry.status)) return false
  if (tf && entry.territory_code && !tf.has(entry.territory_code)) return false
  return true
}

export default function ParcMap({ markers, statusFilter, territoryFilter }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<import('leaflet').Map | null>(null)
  const clusterRef   = useRef<L.MarkerClusterGroup | null>(null)
  const entriesRef   = useRef<MarkerEntry[]>([])
  // Tracks which circles are currently added to the cluster (O(1) lookup)
  const addedRef     = useRef<Set<L.CircleMarker>>(new Set())

  // ── Effect 1 : initialise la carte et les marqueurs une seule fois ───────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    // Capture les filtres initiaux pour l'affichage au premier chargement
    const initSF = statusFilter.length    > 0 ? new Set(statusFilter)    : null
    const initTF = territoryFilter.length > 0 ? new Set(territoryFilter) : null

    async function init() {
      const L = (await import('leaflet')).default
      await import('leaflet.markercluster')
      if (cancelled || !containerRef.current || mapRef.current) return

      type LWithCluster = typeof L & {
        markerClusterGroup(opts?: L.MarkerClusterGroupOptions): L.MarkerClusterGroup
      }
      const cluster = (L as LWithCluster).markerClusterGroup({
        maxClusterRadius: 60,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        chunkedLoading: true,
      })
      clusterRef.current = cluster

      const entries: MarkerEntry[] = []
      const added = new Set<L.CircleMarker>()

      markers.forEach((m) => {
        const color  = STATUS_COLORS[m.status] ?? STATUS_COLORS.inconnu
        const label  = STATUS_LABELS[m.status] ?? m.status
        const expiry = fmtDate(m.next_expiry)

        const circle = L.circleMarker([m.latitude, m.longitude], {
          radius: 7,
          fillColor: color,
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.92,
        })

        // Le libellé de statut reste en encre foncée : la couleur est portée par le point
        circle.bindPopup(`
          <div style="min-width:210px;font-size:12px;line-height:1.5;color:#334155">
            <div style="font-weight:600;font-size:13px;color:#0f172a">${m.site_name ?? 'Site inconnu'}</div>
            <div style="color:#64748b;margin-bottom:8px">${m.client_name ?? '—'}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
              <span style="font-weight:600;color:#0f172a">${label}</span>
              ${m.status_reason ? `<span style="color:#64748b">· ${m.status_reason}</span>` : ''}
            </div>
            ${m.serial_number ? `<div style="color:#64748b;font-size:11px">N° série <span style="color:#334155;font-family:ui-monospace,monospace">${m.serial_number}</span></div>` : ''}
            ${expiry ? `<div style="color:#64748b;font-size:11px">Prochaine échéance <span style="color:#b91c1c;font-weight:500">${expiry}</span></div>` : ''}
            <div style="margin-top:8px;padding-top:6px;border-top:1px solid #e2e8f0">
              <a href="/parc/${m.id}" style="color:#AF2125;font-size:12px;font-weight:600;text-decoration:none">Voir la fiche ›</a>
            </div>
          </div>
        `, { maxWidth: 280, className: 'dae-popup' })

        const entry: MarkerEntry = { circle, status: m.status, territory_code: m.territory_code }
        entries.push(entry)

        if (isVisible(entry, initSF, initTF)) {
          cluster.addLayer(circle)
          added.add(circle)
        }
      })

      entriesRef.current = entries
      addedRef.current   = added

      const map = L.map(containerRef.current, {
        center: [-21.1, 55.5],
        zoom: 10,
        zoomControl: true,
        attributionControl: true,
      })
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      map.addLayer(cluster)

      // Cadrer la carte sur les marqueurs visibles au chargement
      const visibleLatLngs = entries
        .filter((e) => isVisible(e, initSF, initTF))
        .map(({ circle }) => circle.getLatLng())
      if (visibleLatLngs.length > 0) {
        map.fitBounds(L.latLngBounds(visibleLatLngs).pad(0.15))
      }
    }

    init()

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current   = null
        clusterRef.current = null
        entriesRef.current = []
        addedRef.current   = new Set()
      }
    }
  // Dépendance vide : la carte est créée une seule fois au montage.
  // Les changements de filtres sont gérés par l'effect suivant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Effect 2 : toggle les marqueurs sans recréer la carte ─────────────────
  useEffect(() => {
    const cluster = clusterRef.current
    if (!cluster || entriesRef.current.length === 0) return

    const sf = statusFilter.length    > 0 ? new Set(statusFilter)    : null
    const tf = territoryFilter.length > 0 ? new Set(territoryFilter) : null

    entriesRef.current.forEach((entry) => {
      const shouldShow = isVisible(entry, sf, tf)
      const isAdded    = addedRef.current.has(entry.circle)

      if (shouldShow && !isAdded) {
        cluster.addLayer(entry.circle)
        addedRef.current.add(entry.circle)
      } else if (!shouldShow && isAdded) {
        cluster.removeLayer(entry.circle)
        addedRef.current.delete(entry.circle)
      }
    })
  // Jointure en string pour éviter les re-renders sur nouvelles références de tableau
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter.join(','), territoryFilter.join(',')])

  return <div ref={containerRef} className="h-full w-full" />
}
