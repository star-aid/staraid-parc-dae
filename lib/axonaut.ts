const BASE_URL = process.env.AXONAUT_BASE_URL ?? 'https://axonaut.com/api/v2'

const headers = {
  userApiKey: process.env.AXONAUT_API_KEY!,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

async function apiFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await fetch(url.toString(), { headers })

  if (!res.ok) {
    throw new Error(`Axonaut API ${res.status}: ${endpoint}`)
  }

  return res.json() as Promise<T>
}

export async function fetchAxonautCompanies() {
  return apiFetch<Record<string, unknown>[]>('/companies')
}

export async function fetchAxonautCompany(id: string) {
  return apiFetch<Record<string, unknown>>(`/companies/${id}`)
}
