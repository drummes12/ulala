import Dexie, { type Table } from 'dexie'
import type {
  LocalPlan,
  MemberRecord,
  PlanInput,
  PlanRecord,
  TripRecord
} from '../types'
import { inputToPlan } from './time'

interface MetaRecord {
  key: string
  value: unknown
}

export class UlalaDatabase extends Dexie {
  trips!: Table<TripRecord, string>
  members!: Table<MemberRecord, string>
  plans!: Table<LocalPlan, string>
  meta!: Table<MetaRecord, string>

  constructor() {
    super('ulala')
    this.version(1).stores({
      trips: 'id',
      members: '[trip_id+user_id], trip_id, user_id',
      plans: 'id, trip_id, start_at, local_date, updated_at, dirty',
      meta: 'key'
    })
  }
}

export const db = new UlalaDatabase()

export function toLocalPlan(plan: PlanRecord): LocalPlan {
  return {
    ...plan,
    booking_status: plan.booking_status ?? 'none',
    base_version: plan.version,
    dirty: false,
    local_updated_at: plan.updated_at,
    conflict_remote: null
  }
}

export async function saveLocalPlan(
  tripId: string,
  input: PlanInput,
  timezone: string,
  existing?: LocalPlan
) {
  const now = new Date().toISOString()
  const values = inputToPlan(input, timezone)
  const plan: LocalPlan = {
    id: existing?.id ?? crypto.randomUUID(),
    trip_id: tripId,
    ...values,
    version: (existing?.base_version ?? 0) + 1,
    base_version: existing?.base_version ?? 0,
    dirty: true,
    pending_delete: false,
    local_updated_at: now,
    created_by: existing?.created_by ?? null,
    updated_by: existing?.updated_by ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: existing?.updated_at ?? now,
    conflict_remote: null
  }
  await db.plans.put(plan)
  return plan
}

export async function deleteLocalPlan(plan: LocalPlan) {
  if (plan.base_version === 0) {
    await db.plans.delete(plan.id)
    return
  }
  await db.plans.put({
    ...plan,
    pending_delete: true,
    dirty: true,
    local_updated_at: new Date().toISOString(),
    conflict_remote: null
  })
}

export async function plansForTrip(tripId: string) {
  return db.plans
    .where('trip_id')
    .equals(tripId)
    .filter((plan) => !plan.pending_delete)
    .sortBy('start_at')
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key)
  return row?.value as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}
