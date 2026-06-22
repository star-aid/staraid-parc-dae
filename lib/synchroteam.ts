import type { SynchroteamPaginatedResponse, SynchroteamCustomField, CustomFieldMapping } from '@/types'

const credentials = Buffer.from(
  `${process.env.SYNCHROTEAM_DOMAIN}:${process.env.SYNCHROTEAM_API_KEY}`
).toString('base64')

const headers = {
  Authorization: `Basic ${credentials}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

// Capital A obligatoire — /api/v3/ retourne 404
const BASE_URL = process.env.SYNCHROTEAM_BASE_URL ?? 'https://ws.synchroteam.com'

async function apiFetch<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  const res = await fetch(url.toString(), { headers })

  if (res.status === 429) {
    const resetTs = res.headers.get('X-RateLimit-Reset')
    const waitMs = resetTs ? Number(resetTs) * 1000 - Date.now() : 60_000
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 1000)))
    return apiFetch(endpoint, params)
  }

  if (!res.ok) {
    throw new Error(`Synchroteam API ${res.status} GET ${endpoint}`)
  }

  return res.json() as Promise<T>
}

export async function fetchAllPages<T>(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<T[]> {
  const results: T[] = []
  let page = 1

  while (true) {
    const data = await apiFetch<SynchroteamPaginatedResponse<T>>(endpoint, {
      ...params,
      page,
      pageSize: 100,
    })

    results.push(...data.data)

    if (results.length >= data.recordsTotal) break
    page++
  }

  return results
}

export async function fetchCustomFields(): Promise<SynchroteamCustomField[]> {
  const data = await apiFetch<SynchroteamPaginatedResponse<SynchroteamCustomField>>(
    '/Api/v3/customfield/list',
    { type: 'equipment' }
  )
  return data.data
}

export async function fetchCustomers() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/customer/list')
}

export async function fetchSites() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/site/list')
}

export async function fetchEquipments() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/equipment/list')
}

export async function fetchEquipmentDetails(id: string) {
  return apiFetch<Record<string, unknown>>('/Api/v3/equipment/details', { id })
}

export async function fetchContracts() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/contract/list')
}

export async function fetchJobs(params: Record<string, string | number> = {}) {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/job/list', params)
}

export async function fetchUsers() {
  return fetchAllPages<Record<string, unknown>>('/Api/v3/user/list')
}

/**
 * Extrait les custom fields d'un équipement brut Synchroteam
 * en utilisant le mapping stocké en base (id → champ interne).
 * Supporte les deux formats : tableau [{id, value}] ou objet {"id": value}.
 */
export function extractCustomFields(
  rawEquipment: Record<string, unknown>,
  mappings: CustomFieldMapping[]
): Record<string, string | null> {
  const result: Record<string, string | null> = {}

  const rawFields =
    rawEquipment.customFieldValues ??
    rawEquipment.customFields ??
    rawEquipment.custom_fields ??
    rawEquipment.customfields

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
