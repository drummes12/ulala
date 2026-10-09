import type { RealtimeChannel } from '@supabase/supabase-js'
import { db, getMeta, setMeta, toLocalPlan } from './db'
import { ensureAnonymousSession, supabase } from './supabase'
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
  await ensureAnonymousSession()
  const { data, error } = await supabase.rpc('create_trip', {
    p_name: name,
    p_timezone: timezone,
    p_display_name: displayName ?? null
  })
  if (error) throw error
  const row = data?.[0]
  if (!row?.trip_id || !row.invite_token)
    throw new Error('Trip creation did not return an invite.')
  await setMeta(`invite:${row.trip_id}`, row.invite_token)
  await setMeta('activeTripId', row.trip_id)
  return row as { trip_id: string; invite_token: string }
}

export async function joinTrip(token: string, displayName?: string) {
  await ensureAnonymousSession()
  const { data, error } = await supabase.rpc('join_trip', {
    p_token: token,
    p_display_name: displayName ?? null
  })
  if (error) throw mapRpcError(error)
  const row = data?.[0]
  if (!row?.trip_id) throw new Error('No se pudo unir al viaje.')
  await setMeta(`invite:${row.trip_id}`, token)
  await setMeta('activeTripId', row.trip_id)
  return row as { trip_id: string; trip_name: string }
}

export async function getStoredTripId() {
  return getMeta<string>('activeTripId')
}

export async function getInviteToken(tripId: string) {
  return getMeta<string>(`invite:${tripId}`)
}

export async function regenerateInvite(tripId: string) {
  await ensureAnonymousSession()
  const { data, error } = await supabase.rpc('regenerate_invite', {
    p_trip_id: tripId
  })
  if (error) throw mapRpcError(error)
  await setMeta(`invite:${tripId}`, data)
  return data as string
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
    await ensureAnonymousSession()
    const [
      { data: trip, error: tripError },
      { data: members, error: membersError },
      { data: remotePlans, error: plansError }
    ] = await Promise.all([
      supabase.from('trips').select('*').eq('id', tripId).maybeSingle(),
      supabase.from('trip_members').select('*').eq('trip_id', tripId),
      supabase.from('plans').select('*').eq('trip_id', tripId)
    ])
    if (tripError) throw tripError
    if (membersError) throw membersError
    if (plansError) throw plansError
    if (!trip) throw new Error('Este dispositivo ya no tiene acceso al viaje.')

    await reconcileRemote(
      trip as TripRecord,
      (members ?? []) as MemberRecord[],
      (remotePlans ?? []) as PlanRecord[]
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
  const { data, error } = await supabase.rpc('save_plan', {
    p_plan: {
      id: plan.id,
      trip_id: plan.trip_id,
      base_version: plan.base_version,
      deleted: Boolean(plan.pending_delete),
      title: plan.title,
      local_date: plan.local_date,
      start_time: plan.start_time,
      end_time: plan.end_time,
      start_at: plan.start_at,
      location: plan.location,
      notes: plan.notes,
      status: plan.status,
      booking_status: plan.booking_status,
      travel_minutes: plan.travel_minutes,
      buffer_minutes: plan.buffer_minutes,
      reminder_minutes: plan.reminder_minutes
    }
  })

  if (error) throw mapRpcError(error)
  const status = data?.status
  const remote = data?.plan as PlanRecord | undefined
  if (status === 'conflict' && remote) {
    await db.plans.put({ ...plan, conflict_remote: remote })
    return
  }
  if (status === 'deleted') {
    await db.plans.delete(plan.id)
    return
  }
  if (!remote) throw new Error('La sincronización no devolvió el plan.')

  if (plan.pending_delete || remote.deleted_at) {
    await db.plans.delete(plan.id)
  } else {
    await db.plans.put(toLocalPlan(remote))
  }
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

export function subscribeToPlans(
  tripId: string,
  onChange: () => void
): RealtimeChannel {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, 400)
  }
  return supabase
    .channel(`plans:${tripId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'plans',
        filter: `trip_id=eq.${tripId}`
      },
      debounced
    )
    .subscribe()
}

export async function updateDisplayName(
  tripId: string,
  userId: string,
  displayName: string
) {
  const { error } = await supabase
    .from('trip_members')
    .update({ display_name: displayName })
    .eq('trip_id', tripId)
    .eq('user_id', userId)
  if (error) throw error
}

function mapRpcError(error: { message?: string }) {
  if (error.message?.includes('RATE_LIMITED'))
    return new Error('Demasiados intentos. Espera unos minutos.')
  if (error.message?.includes('INVITE_NOT_FOUND'))
    return new Error('El enlace no es válido o fue regenerado.')
  if (error.message?.includes('NOT_MEMBER'))
    return new Error('Este dispositivo ya no pertenece al viaje.')
  if (error.message?.includes('INVALID_TIMEZONE'))
    return new Error('La zona horaria no es válida.')
  return new Error(error.message || 'Error de Supabase.')
}
