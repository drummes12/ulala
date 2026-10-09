export type PlanStatus = 'idea' | 'confirmed' | 'done'
export type BookingStatus =
  | 'none'
  | 'not_required'
  | 'recommended'
  | 'required'
  | 'booked'
export type SyncState = 'offline' | 'synced' | 'syncing' | 'pending' | 'error'

export interface TripRecord {
  id: string
  name: string
  timezone: string
  invite_created_at: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MemberRecord {
  trip_id: string
  user_id: string
  display_name: string
  joined_at: string
}

export interface PlanRecord {
  id: string
  trip_id: string
  title: string
  local_date: string
  start_time: string
  end_time: string | null
  start_at: string
  location: string | null
  notes: string | null
  status: PlanStatus
  booking_status: BookingStatus
  travel_minutes: number
  buffer_minutes: number
  reminder_minutes: number
  version: number
  deleted_at: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface LocalPlan extends PlanRecord {
  base_version: number
  dirty: boolean
  local_updated_at: string
  pending_delete?: boolean
  conflict_remote?: PlanRecord | null
  sync_error?: string
}

export interface PlanInput {
  title: string
  local_date: string
  start_time: string
  end_time?: string
  location?: string
  notes?: string
  status: PlanStatus
  booking_status: BookingStatus
  travel_minutes: number
  buffer_minutes: number
  reminder_minutes: number
}

export interface CsvPlanInput extends PlanInput {
  sourceRow: number
  sourceStatus?: string
  duplicateOf?: string
}
