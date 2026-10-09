import { db, getMeta, setMeta, toLocalPlan } from './db'
import { api, convex, ensureUser } from './convexClient'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import type {
  LocalPlan,
  MemberRecord,
  PlanRecord,
  SyncState,
  TripRecord
} from '../types'

export type SyncListener = (state: SyncState, message?: string) => void

const activeSyncs = new Map<string, Promise<void>>()

export function syncTrip(tripId: string, onStatus?: SyncListener) {
  const active = activeSyncs.get(tripId)
  if (active) return active
  const pending = performSyncTrip(tripId, onStatus).finally(() => {
    activeSyncs.delete(tripId)
  })
  activeSyncs.set(tripId, pending)
  return pending
}

export async function createTrip(
  name: string,
  timezone: string,
  displayName?: string
) {
  const user = await ensureUser()
  const result = await convex.mutation(api.trips.createTrip, {
    userId: user.id,
    name,
    timezone,
    displayName: displayName ?? ''
  })
  await setMeta(`invite:${result.tripId}`, result.inviteToken)
  await setMeta('activeTripId', result.tripId)
  return { trip_id: result.tripId, invite_token: result.inviteToken }
}

export async function joinTrip(token: string, displayName?: string) {
  const user = await ensureUser()
  const result = await convex.mutation(api.trips.joinTrip, {
    userId: user.id,
    inviteToken: token,
    displayName: displayName ?? ''
  })
  await setMeta(`invite:${result.tripId}`, token)
  await setMeta('activeTripId', result.tripId)
  return { trip_id: result.tripId, trip_name: result.tripName }
}

export async function getStoredTripId() {
  return getMeta<string>('activeTripId')
}

export async function getInviteToken(tripId: string) {
  return getMeta<string>(`invite:${tripId}`)
}

export async function regenerateInvite(tripId: string) {
  const user = await ensureUser()
  const { inviteToken } = await convex.mutation(api.trips.regenerateInvite, {
    userId: user.id,
    tripId: tripId as Id<'trips'>
  })
  await setMeta(`invite:${tripId}`, inviteToken)
  return inviteToken
}

export async function loadLocalTrip(tripId: string) {
  const [trip, members, plans] = await Promise.all([
    db.trips.get(tripId),
    db.members.where('trip_id').equals(tripId).toArray(),
    db.plans.where('trip_id').equals(tripId).sortBy('start_at')
  ])
  return { trip, members, plans }
}

async function performSyncTrip(tripId: string, onStatus?: SyncListener) {
  if (!navigator.onLine) {
    onStatus?.('offline')
    return
  }
  onStatus?.('syncing')
  try {
    const user = await ensureUser()
    const snapshot = await convex.query(api.plans.snapshot, {
      userId: user.id,
      tripId: tripId as Id<'trips'>
    })
    if (!snapshot.trip) {
      throw new Error('Este dispositivo ya no tiene acceso al viaje.')
    }
    await reconcileRemote(
      docToTrip(snapshot.trip),
      snapshot.members.map(docToMember),
      snapshot.plans.map(docToPlan)
    )

    const pending = await db.plans
      .where('trip_id')
      .equals(tripId)
      .filter((plan) => plan.dirty && !plan.conflict_remote)
      .toArray()
    await Promise.all(pending.map((plan) => pushLocalPlan(plan)))

    const remaining = await db.plans
      .where('trip_id')
      .equals(tripId)
      .filter((plan) => Boolean(plan.dirty || plan.conflict_remote))
      .count()
    await setMeta(`lastSync:${tripId}`, new Date().toISOString())
    onStatus?.(remaining ? 'pending' : 'synced')
  } catch (error) {
    onStatus?.(
      navigator.onLine ? 'error' : 'offline',
      error instanceof Error ? error.message : 'Error de sincronización'
    )
  }
}

async function reconcileRemote(
  trip: TripRecord,
  members: MemberRecord[],
  remotePlans: PlanRecord[]
) {
  await db.trips.put(trip)
  await db.members.where('trip_id').equals(trip.id).delete()
  await db.members.bulkPut(members)

  const localPlans = await db.plans.where('trip_id').equals(trip.id).toArray()
  const remoteById = new Map(remotePlans.map((plan) => [plan.id, plan]))

  for (const local of localPlans) {
    const remote = remoteById.get(local.id)
    if (!remote) {
      if (!local.dirty && local.base_version > 0)
        await db.plans.delete(local.id)
      continue
    }
    if (local.dirty) {
      if (remote.version !== local.base_version) {
        await db.plans.put({ ...local, conflict_remote: remote })
      }
      continue
    }
    if (remote.deleted_at) {
      await db.plans.delete(local.id)
    } else {
      await db.plans.put(toLocalPlan(remote))
    }
  }

  for (const remote of remotePlans) {
    if (remote.deleted_at) continue
    const exists = localPlans.some((plan) => plan.id === remote.id)
    if (!exists) await db.plans.put(toLocalPlan(remote))
  }
}

async function pushLocalPlan(plan: LocalPlan) {
  const user = await ensureUser()
  const result = await convex.mutation(api.plans.save, {
    userId: user.id,
    tripId: plan.trip_id as Id<'trips'>,
    planId: plan.id,
    baseVersion: plan.base_version,
    deleted: Boolean(plan.pending_delete),
    title: plan.title,
    localDate: plan.local_date,
    startTime: plan.start_time,
    endTime: plan.end_time,
    startAtMs: Date.parse(plan.start_at),
    location: plan.location ?? '',
    notes: plan.notes ?? '',
    status: plan.status,
    bookingStatus: plan.booking_status,
    travelMinutes: plan.travel_minutes,
    bufferMinutes: plan.buffer_minutes,
    reminderMinutes: plan.reminder_minutes
  })

  if (result.status === 'conflict' && result.plan) {
    await db.plans.put({ ...plan, conflict_remote: docToPlan(result.plan) })
    return
  }
  if (result.plan?.deletedAt || plan.pending_delete) {
    await db.plans.delete(plan.id)
    return
  }
  if (!result.plan) throw new Error('La sincronización no devolvió el plan.')
  await db.plans.put(toLocalPlan(docToPlan(result.plan)))
}

export async function resolveConflict(plan: LocalPlan, keepLocal: boolean) {
  if (!plan.conflict_remote) return
  if (keepLocal) {
    await db.plans.put({
      ...plan,
      base_version: plan.conflict_remote.version,
      dirty: true,
      conflict_remote: null
    })
  } else if (plan.conflict_remote.deleted_at) {
    await db.plans.delete(plan.id)
  } else {
    await db.plans.put(toLocalPlan(plan.conflict_remote))
  }
}

export function subscribeToPlans(tripId: string, onChange: () => void) {
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  void ensureUser().then((user) => {
    unsubscribe = convex.onUpdate(
      api.plans.snapshot,
      { userId: user.id, tripId: tripId as Id<'trips'> },
      () => {
        clearTimeout(timer)
        timer = setTimeout(onChange, 400)
      }
    )
  })

  return {
    unsubscribe: () => {
      clearTimeout(timer)
      unsubscribe?.()
    }
  }
}

export async function updateDisplayName(
  tripId: string,
  userId: string,
  displayName: string
) {
  await convex.mutation(api.members.updateDisplayName, {
    userId,
    tripId: tripId as Id<'trips'>,
    displayName
  })
}

const toIso = (ms: number) => new Date(ms).toISOString()

function docToTrip(doc: Doc<'trips'>): TripRecord {
  return {
    id: doc._id,
    name: doc.name,
    timezone: doc.timezone,
    invite_created_at: toIso(doc.inviteCreatedAt),
    created_by: doc.createdBy,
    created_at: toIso(doc.createdAt),
    updated_at: toIso(doc.updatedAt)
  }
}

function docToMember(doc: Doc<'tripMembers'>): MemberRecord {
  return {
    trip_id: doc.tripId,
    user_id: doc.userId,
    display_name: doc.displayName ?? '',
    joined_at: toIso(doc.joinedAt)
  }
}

function docToPlan(doc: Doc<'plans'>): PlanRecord {
  return {
    id: doc.planId,
    trip_id: doc.tripId,
    title: doc.title,
    local_date: doc.localDate,
    start_time: doc.startTime,
    end_time: doc.endTime,
    start_at: toIso(doc.startAtMs),
    location: doc.location || null,
    notes: doc.notes || null,
    status: doc.status,
    booking_status: doc.bookingStatus ?? 'none',
    travel_minutes: doc.travelMinutes,
    buffer_minutes: doc.bufferMinutes,
    reminder_minutes: doc.reminderMinutes,
    version: doc.version,
    deleted_at: doc.deletedAt ? toIso(doc.deletedAt) : null,
    created_by: doc.createdBy,
    updated_by: doc.updatedBy,
    created_at: toIso(doc.createdAt),
    updated_at: toIso(doc.updatedAt)
  }
}
