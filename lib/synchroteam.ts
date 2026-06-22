import type { SynchroteamPaginatedResponse, SynchroteamCustomField, CustomFieldMapping } from '@/types'

const credentials = Buffer.from(
  `${process.env.SYNCHROTEAM_DOMAIN}:${process.env.SYNCHROTEAM_API_KEY}`
).toString('base64')

const headers = {
  Authorization: `Basic ${credentials}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

const BASE_URL = process.env.SYNCHROTEAM_BASE_URL ?? 'https://ws.synchroteam.com'

type FetchOpts = {
  method?: 'GET' | 'POST'
  params?: Record<string, string | number>
}

async function apiFetch<T>(endpoint: string, opts: FetchOpts = {}): Promise<T> {
  const { method = 'GET', params = {} } = opts
  let url = `${BASE_URL}${endpoint}`
  let body: string | undefined

  if (method === 'POST') {
    // Synchroteam list endpoints qui utilisent POST attendent les filtres dans le body JSON
    body = JSON.stringify(params)
  } else {
    const u = new URL(url)
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)))
    url = u.toString()
  }

  const res = await fetch(url, { method, headers, body })

  if (res.status === 429) {
    const resetTs = res.headers.get('X-RateLimit-Reset')
    const waitMs = resetTs ? Number(resetTs) * 1000 - Date.now() : 60_000
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 1000)))
    return apiFetch(endpoint, opts)
  }

  if (!res.ok) {
    throw new Error(`Synchroteam API ${res.status} (${method} ${endpoint})`)
  }

  return res.json() as Promise<T>
}

export async function fetchAllPages<T>(
  endpoint: string,
  opts: FetchOpts = {}
): Promise<T[]> {
  const results: T[] = []
  let page = 1

  while (true) {
    const data = await apiFetch<SynchroteamPaginatedResponse<T>>(endpoint, {
      ...opts,
      params: { ...opts.params, page, pageSize: 100 },
    })

    results.push(...data.data)

    if (results.length >= data.recordsTotal) break
    page++
  }

  return results
}

// customfield/list répond 405 sur GET — utilise POST
export async function fetchCustomFields(): Promise<SynchroteamCustomField[]> {
  const data = await apiFetch<SynchroteamPaginatedResponse<SynchroteamCustomField>>(
    '/Api/v3/customfield/list',
    { method: 'POST', params: { type: 'equipment', pageSize: 100 } }
  )
  return data.data
}

export async function fetchCustomers() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/customer/list', { method: 'POST' })
}

export async function fetchSites() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/site/list', { method: 'POST' })
}

export async function fetchEquipments() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/equipment/list', { method: 'POST' })
}

export async function fetchEquipmentDetails(id: string) {
  return apiFetch<Record<string, unknown>>('/Api/v3/equipment/details', { method: 'GET', params: { id } })
}

export async function fetchContracts() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/contract/list', { method: 'POST' })
}

export async function fetchJobs(params: Record<string, string> = {}) {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/job/list', { method: 'POST', params })
}

export async function fetchUsers() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/user/list', { method: 'POST' })
}

/**
 * Extrait les custom fields d'un équipement brut Synchroteam
 * en utilisant le mapping stocké en base (label → champ interne).
 *
 * Retourne un objet plat avec les champs internes comme clés.
 * Les champs non mappés sont ignorés (conservés dans custom_fields JSONB brut).
 */
export function extractCustomFields(
  rawEquipment: Record<string, unknown>,
  mappings: CustomFieldMapping[]
): Record<string, string | null> {
  const result: Record<string, string | null> = {}

  // Synchroteam expose les custom fields sous différentes formes selon la version API :
  //   - tableau : equipment.customFields = [{ id: 101, value: '2025-06-01' }, ...]
  //   - objet   : equipment.customFields = { "101": "2025-06-01", ... }
  const rawFields = rawEquipment.customFields ?? rawEquipment.custom_fields ?? rawEquipment.customfields

  if (!rawFields) return result

  const mappingById = new Map(mappings.map((m) => [m.synchroteam_field_id, m]))

  if (Array.isArray(rawFields)) {
    for (const entry of rawFields as Array<{ id?: number; fieldId?: number; value?: unknown }>) {
      const fieldId = entry.id ?? entry.fieldId
      if (fieldId == null) continue
      const mapping = mappingById.get(Number(fieldId))
      if (mapping) {
        result[mapping.internal_field] = entry.value != null ? String(entry.value) : null
      }
    }
  } else if (typeof rawFields === 'object') {
    for (const [key, value] of Object.entries(rawFields as Record<string, unknown>)) {
      const mapping = mappingById.get(Number(key))
      if (mapping) {
        result[mapping.internal_field] = value != null ? String(value) : null
      }
    }
  }

  return result
}
