import type { SynchroteamPaginatedResponse, SynchroteamCustomField } from '@/types'

const credentials = Buffer.from(
  `${process.env.SYNCHROTEAM_DOMAIN}:${process.env.SYNCHROTEAM_API_KEY}`
).toString('base64')

const headers = {
  Authorization: `Basic ${credentials}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

const BASE_URL = process.env.SYNCHROTEAM_BASE_URL ?? 'https://ws.synchroteam.com'

async function apiFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await fetch(url.toString(), { headers })

  if (res.status === 429) {
    const resetTs = res.headers.get('X-RateLimit-Reset')
    const waitMs = resetTs ? Number(resetTs) * 1000 - Date.now() : 60_000
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 1000)))
    return apiFetch(endpoint, params)
  }

  if (!res.ok) {
    throw new Error(`Synchroteam API ${res.status}: ${endpoint}`)
  }

  return res.json() as Promise<T>
}

export async function fetchAllPages<T>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const results: T[] = []
  let page = 1

  while (true) {
    const data = await apiFetch<SynchroteamPaginatedResponse<T>>(endpoint, {
      ...params,
      page: String(page),
      pageSize: '100',
    })

    results.push(...data.data)

    if (results.length >= data.recordsTotal) break
    page++
  }

  return results
}

export async function fetchCustomFields(): Promise<SynchroteamCustomField[]> {
  const data = await apiFetch<SynchroteamPaginatedResponse<SynchroteamCustomField>>(
    '/api/v3/customfield/list',
    { type: 'equipment' }
  )
  return data.data
}

export async function fetchCustomers() {
  return fetchAllPages<Record<string, unknown>>('/api/v3/customer/list')
}

export async function fetchSites() {
  return fetchAllPages<Record<string, unknown>>('/api/v3/site/list')
}

export async function fetchEquipments() {
  return fetchAllPages<Record<string, unknown>>('/api/v3/equipment/list')
}

export async function fetchEquipmentDetails(id: string) {
  return apiFetch<Record<string, unknown>>('/api/v3/equipment/details', { id })
}

export async function fetchContracts() {
  return fetchAllPages<Record<string, unknown>>('/api/v3/contract/list')
}

export async function fetchJobs(params: Record<string, string> = {}) {
  return fetchAllPages<Record<string, unknown>>('/api/v3/job/list', params)
}

export async function fetchUsers() {
  return fetchAllPages<Record<string, unknown>>('/api/v3/user/list')
}
