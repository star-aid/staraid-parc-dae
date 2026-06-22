const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
let _lastRequestMs = 0

// Géocodage Nominatim — max 1 requête/seconde, User-Agent obligatoire
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const wait = 1000 - (Date.now() - _lastRequestMs)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  _lastRequestMs = Date.now()

  const url = new URL(NOMINATIM_URL)
  url.searchParams.set('q', address)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '1')

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'STAR-aid-parc-dae/1.0 (contact: d.sangla@star-aid.fr)' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    if (!data.length) return null
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch {
    return null
  }
}
