'use client'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

type Props = {
  latitude: number
  longitude: number
  siteName: string | null
  status: string
}

const STATUS_COLOR: Record<string, string> = {
  conforme:  '#10b981',
  vigilance: '#f59e0b',
  critique:  '#ef4444',
  inconnu:   '#94a3b8',
}

export default function DetailMap({ latitude, longitude, siteName, status }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    let map: import('leaflet').Map | null = null

    async function init() {
      const L = (await import('leaflet')).default
      const color = STATUS_COLOR[status] ?? STATUS_COLOR.inconnu

      map = L.map(el, {
        center: [latitude, longitude],
        zoom: 16,
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      L.circleMarker([latitude, longitude], {
        radius: 12,
        fillColor: color,
        color: '#fff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9,
      })
        .bindPopup(`<b style="font-family:system-ui;font-size:13px">${siteName ?? 'Site DAE'}</b>`)
        .addTo(map)
    }

    init()
    return () => { map?.remove(); map = null }
  }, [latitude, longitude, status, siteName])

  return <div ref={ref} className="h-full w-full rounded-lg overflow-hidden" />
}
