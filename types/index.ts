export type DAEStatus = 'conforme' | 'vigilance' | 'critique' | 'inconnu'
export type BatteryStatus = 'ok' | 'a_remplacer' | 'expire' | 'inconnu'
export type TerritoryCode = 'REU' | 'MYT' | 'GLP'
export type UserRole = 'dt' | 'technicien' | 'direction'

export interface Territory {
  id: string
  name: string
  code: TerritoryCode
  timezone: string
  created_at: string
}

export interface Client {
  id: string
  synchroteam_id: string | null
  axonaut_id: string | null
  name: string
  address: string | null
  city: string | null
  territory_id: string | null
  territory?: Territory
  contact_email: string | null
  contact_phone: string | null
  tags: string[]
  active: boolean
  synced_at: string | null
  created_at: string
}

export interface Site {
  id: string
  synchroteam_id: string
  client_id: string | null
  client?: Client
  name: string
  address: string | null
  city: string | null
  territory_id: string | null
  territory?: Territory
  latitude: number | null
  longitude: number | null
  active: boolean
  synced_at: string | null
  created_at: string
}

export interface Defibrillator {
  id: string
  synchroteam_id: string
  serial_number: string | null
  model: string | null
  brand: string | null
  client_id: string | null
  client?: Client
  site_id: string | null
  site?: Site
  territory_id: string | null
  territory?: Territory
  status: DAEStatus
  status_reason: string | null
  last_maintenance_date: string | null
  next_maintenance_date: string | null
  battery_expiry: string | null
  electrodes_expiry: string | null
  battery_status: BatteryStatus
  electrodes_status: BatteryStatus
  custom_fields: Record<string, unknown> | null
  contract_type: string | null
  contract_start: string | null
  contract_end: string | null
  notes: string | null
  active: boolean
  synced_at: string | null
  created_at: string
  updated_at: string
}

export interface Intervention {
  id: string
  synchroteam_id: string
  defibrillator_id: string | null
  defibrillator?: Defibrillator
  site_id: string | null
  site?: Site
  client_id: string | null
  client?: Client
  type: 'maintenance' | 'depannage' | 'installation' | 'autre' | null
  status: 'planifie' | 'en_cours' | 'termine' | 'annule' | null
  scheduled_date: string | null
  completed_date: string | null
  technician_name: string | null
  technician_synchroteam_id: string | null
  duration_minutes: number | null
  report: string | null
  custom_fields: Record<string, unknown> | null
  created_at: string
}

export interface Technician {
  id: string
  synchroteam_id: string
  first_name: string | null
  last_name: string | null
  login: string | null
  email: string | null
  territory_id: string | null
  territory?: Territory
  active: boolean
  synced_at: string | null
}

export interface CustomFieldMapping {
  id: string
  synchroteam_field_id: number
  synchroteam_label: string
  internal_field: string
  field_type: 'date' | 'text' | 'number'
  updated_at: string
}

export interface SyncLog {
  id: string
  source: string
  status: 'success' | 'error' | 'running'
  records_synced: number
  error_message: string | null
  started_at: string
  finished_at: string | null
}

// KPIs dashboard
export interface ParkSummary {
  total: number
  conforme: number
  vigilance: number
  critique: number
  inconnu: number
  by_territory: Record<TerritoryCode, { total: number; conforme: number; vigilance: number; critique: number; inconnu: number }>
  next_expirations: Array<{
    id: string
    serial_number: string | null
    model: string | null
    client_name: string | null
    territory_code: TerritoryCode | null
    next_date: string
    reason: string
  }>
  last_sync: string | null
}

// Synchroteam API raw types
export interface SynchroteamPaginatedResponse<T> {
  page: number
  pageSize: number
  records: number
  recordsTotal: number
  data: T[]
}

export interface SynchroteamCustomField {
  id: number
  label: string
  type: 'date' | 'text' | 'number' | 'list' | 'checkbox'
  required?: boolean
  options?: string[]
}
