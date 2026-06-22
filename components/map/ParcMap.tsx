'use client'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useEffect, useRef } from 'react'
// Augments L namespace avec MarkerClusterGroup / markerClusterGroup()
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

const STATUS_COLORS: Record<string, string> = {
  conforme:  '#10b981',
  vigilance: '#f59e0b',
  critique:  '#ef4444',
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

export default function ParcMap({ markers, statusFilter, territoryFilter }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    let leafletMap: import('leaflet').Map | null = null

    async function init() {
      const L = (await import('leaflet')).default
      await import('leaflet.markercluster')

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

      const filtered = markers.filter((m) => {
        if (statusFilter.length > 0 && !statusFilter.includes(m.status)) return false
        if (territoryFilter.length > 0 && m.territory_code && !territoryFilter.includes(m.territory_code)) return false
        return true
      })

      filtered.forEach((m) => {
        const color = STATUS_COLORS[m.status] ?? STATUS_COLORS.inconnu
        const label = STATUS_LABELS[m.status] ?? m.status
        const expiry = fmtDate(m.next_expiry)

        const circle = L.circleMarker([m.latitude, m.longitude], {
          radius: 9,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.88,
        })

        circle.bindPopup(`
          <div style="min-width:200px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.6">
            <div style="font-weight:600;color:#1e293b;margin-bottom:2px">${m.site_name ?? 'Site inconnu'}</div>
            <div style="color:#64748b;font-size:12px;margin-bottom:8px">${m.client_name ?? '—'}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
              <span style="color:${color};font-weight:600">${label}</span>
            </div>
            ${m.status_reason ? `<div style="color:#94a3b8;font-size:11px;margin-bottom:4px">${m.status_reason}</div>` : ''}
            ${m.serial_number ? `<div style="color:#94a3b8;font-size:11px">SN : <span style="color:#475569;font-family:monospace">${m.serial_number}</span></div>` : ''}
            ${expiry ? `<div style="color:#94a3b8;font-size:11px">Prochaine échéance : <span style="color:#ef4444;font-weight:500">${expiry}</span></div>` : ''}
            <div style="margin-top:8px;padding-top:6px;border-top:1px solid #e2e8f0">
              <a href="/parc/${m.id}" style="color:#2563eb;font-size:12px;font-weight:500;text-decoration:none">
                Voir la fiche →
              </a>
            </div>
          </div>
        `, { maxWidth: 280, className: 'dae-popup' })

        cluster.addLayer(circle)
      })

      leafletMap = L.map(el, {
        center: [-21.1, 55.5],
        zoom: 10,
        zoomControl: true,
        attributionControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(leafletMap)

      leafletMap.addLayer(cluster)

      // Zoomer pour englober tous les marqueurs si présents
      if (filtered.length > 0) {
        const coords = filtered.map((m) => L.latLng(m.latitude, m.longitude))
        leafletMap.fitBounds(L.latLngBounds(coords).pad(0.15))
      }
    }

    init()

    return () => {
      leafletMap?.remove()
      leafletMap = null
    }
  // markers est stable (passé depuis server), statusFilter/territoryFilter peuvent changer
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, statusFilter.join(','), territoryFilter.join(',')])

  return <div ref={containerRef} className="h-full w-full" />
}
