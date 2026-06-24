import type { SynchroteamPaginatedResponse, SynchroteamCustomField, CustomFieldMapping } from '@/types'

export interface SynchroteamClient {
  fetchCustomFields(): Promise<SynchroteamCustomField[]>
  fetchAllPages<T>(endpoint: string, params?: Record<string, string | number>): Promise<T[]>
  fetchCustomers(): Promise<Record<string, unknown>[]>
  fetchSites(): Promise<Record<string, unknown>[]>
  fetchEquipments(): Promise<Record<string, unknown>[]>
  fetchEquipmentDetails(id: string): Promise<Record<string, unknown>>
  fetchContracts(): Promise<Record<string, unknown>[]>
  fetchJobs(params?: Record<string, string | number>): Promise<Record<string, unknown>[]>
  fetchUsers(): Promise<Record<string, unknown>[]>
}

export function createSynchroteamClient(domain: string, apiKey: string): SynchroteamClient {
  const credentials = Buffer.from(`${domain}:${apiKey}`).toString('base64')
  const headers = {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
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
      throw new Error(`Synchroteam API ${res.status} GET ${endpoint} (domain: ${domain})`)
    }

    return res.json() as Promise<T>
  }

  async function fetchAllPages<T>(
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

  return {
    async fetchCustomFields() {
      const data = await apiFetch<SynchroteamPaginatedResponse<SynchroteamCustomField>>(
        '/Api/v3/customfield/list',
        { type: 'equipment' }
      )
      return data.data
    },
    fetchAllPages,
    fetchCustomers: () => fetchAllPages<Record<string, unknown>>('/Api/v3/customer/list'),
    fetchSites: () => fetchAllPages<Record<string, unknown>>('/Api/v3/site/list'),
    fetchEquipments: () => fetchAllPages<Record<string, unknown>>('/Api/v3/equipment/list'),
    fetchEquipmentDetails: (id: string) =>
      apiFetch<Record<string, unknown>>('/Api/v3/equipment/details', { id }),
    fetchContracts: () => fetchAllPages<Record<string, unknown>>('/Api/v3/contract/list'),
    fetchJobs: (params = {}) => fetchAllPages<Record<string, unknown>>('/Api/v3/job/list', params),
    fetchUsers: () => fetchAllPages<Record<string, unknown>>('/Api/v3/user/list'),
  }
}

/**
 * Client par défaut — compte La Réunion (variables d'environnement REU)
 */
function getDefaultClient(): SynchroteamClient {
  const domain = process.env.SYNCHROTEAM_DOMAIN ?? ''
  const apiKey = process.env.SYNCHROTEAM_API_KEY ?? ''
  return createSynchroteamClient(domain, apiKey)
}

// Exports de compatibilité ascendante (utilisés par /admin/field-mapping/discover)
const defaultClient = getDefaultClient()

export const fetchCustomFields = () => defaultClient.fetchCustomFields()
export const fetchAllPages = <T>(endpoint: string, params?: Record<string, string | number>) =>
  defaultClient.fetchAllPages<T>(endpoint, params)
export const fetchCustomers = () => defaultClient.fetchCustomers()
export const fetchSites = () => defaultClient.fetchSites()
export const fetchEquipments = () => defaultClient.fetchEquipments()
export const fetchEquipmentDetails = (id: string) => defaultClient.fetchEquipmentDetails(id)
export const fetchContracts = () => defaultClient.fetchContracts()
export const fetchJobs = (params?: Record<string, string | number>) => defaultClient.fetchJobs(params)
export const fetchUsers = () => defaultClient.fetchUsers()

/**
 * Extrait les custom fields d'un équipement brut Synchroteam
 * en utilisant le mapping stocké en base (id → champ interne).
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
