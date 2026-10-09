import { DateTime } from 'luxon'
import type { LocalPlan, PlanInput, PlanRecord } from '../types'

const fallbackTimezones = [
  'UTC',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'Europe/Madrid',
  'Europe/London',
  'Asia/Tokyo'
]

export function localToUtcIso(
  date: string,
  time: string,
  timezone: string
): string {
  const parsed = DateTime.fromISO(`${date}T${time}`, { zone: timezone })
  if (!parsed.isValid)
    throw new Error(`INVALID_TIME:${parsed.invalidReason ?? 'unknown'}`)
  return parsed.toUTC().toISO()!
}

export function utcToTripTime(iso: string, timezone: string): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone)
}

export function leaveAtIso(
  plan: Pick<PlanRecord, 'start_at' | 'travel_minutes' | 'buffer_minutes'>
): string {
  return DateTime.fromISO(plan.start_at)
    .minus({ minutes: plan.travel_minutes + plan.buffer_minutes })
    .toISO()!
}

export function reminderAtIso(
  plan: Pick<PlanRecord, 'start_at' | 'reminder_minutes'>
): string {
  return DateTime.fromISO(plan.start_at)
    .minus({ minutes: plan.reminder_minutes })
    .toISO()!
}

export function formatPlanTime(plan: PlanRecord, timezone: string): string {
  const start = utcToTripTime(plan.start_at, timezone)
  const startLabel = start.toFormat('HH:mm')
  if (!plan.end_time) return startLabel
  const [hour, minute] = plan.end_time.split(':').map(Number)
  const end = start.set({ hour, minute })
  return `${startLabel}–${end.toFormat('HH:mm')}`
}

export function formatDayLabel(
  date: string,
  timezone: string,
  now = DateTime.now()
): string {
  const day = DateTime.fromISO(date, { zone: timezone }).startOf('day')
  const today = now.setZone(timezone).startOf('day')
  const diff = Math.round(day.diff(today, 'days').days)
  const raw = day.setLocale('es').toFormat("cccc d 'de' LLLL")
  const formatted = raw.charAt(0).toUpperCase() + raw.slice(1)
  if (diff === 0) return `Hoy · ${formatted}`
  if (diff === 1) return `Mañana · ${formatted}`
  return formatted
}

export function relativeTiming(
  plan: PlanRecord,
  timezone: string,
  nowIso = DateTime.utc().toISO()!
): string {
  const now = DateTime.fromISO(nowIso)
  const start = DateTime.fromISO(plan.start_at)
  const leaveAt = DateTime.fromISO(leaveAtIso(plan))
  const end = endAt(plan, timezone) ?? start.plus({ hours: 2 })

  if (now > end) return 'Ya pasó'
  if (now >= start) return 'En curso'
  if (plan.travel_minutes + plan.buffer_minutes > 0) {
    if (now >= leaveAt) return 'Sal ya'
    const minutesToLeave = leaveAt.diff(now, 'minutes').minutes
    if (minutesToLeave <= 15)
      return `Sal en ${Math.max(1, Math.floor(minutesToLeave))} min`
  }
  const minutes = Math.floor(start.diff(now, 'minutes').minutes)
  if (minutes < 60) return `En ${Math.max(minutes, 1)} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `En ${hours} h`
  return `En ${Math.floor(hours / 24)} d`
}

export function nextRelevantPlan(
  plans: LocalPlan[],
  timezone: string
): LocalPlan | undefined {
  const now = DateTime.utc()
  const relevant = plans
    .filter(
      (plan) =>
        !plan.pending_delete && !plan.deleted_at && plan.status !== 'done'
    )
    .filter((plan) => {
      const start = DateTime.fromISO(plan.start_at)
      return now <= (endAt(plan, timezone) ?? start.plus({ hours: 2 }))
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
  return relevant.find((plan) => plan.status === 'confirmed') ?? relevant[0]
}

export function plansOverlap(
  a: PlanRecord,
  b: PlanRecord,
  timezone: string
): boolean {
  if (a.id === b.id || a.deleted_at || b.deleted_at) return false
  const aStart = DateTime.fromISO(a.start_at)
  const aEnd = endAt(a, timezone) ?? aStart.plus({ hours: 1 })
  const bStart = DateTime.fromISO(b.start_at)
  const bEnd = endAt(b, timezone) ?? bStart.plus({ hours: 1 })
  return aStart < bEnd && bStart < aEnd
}

function endAt(plan: PlanRecord, timezone: string): DateTime | null {
  if (!plan.end_time) return null
  const start = utcToTripTime(plan.start_at, timezone)
  const [hour, minute] = plan.end_time.split(':').map(Number)
  let end = start.set({ hour, minute })
  if (end <= start) end = end.plus({ days: 1 })
  return end.toUTC()
}

export function timezoneOptions(): string[] {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const supported =
    'supportedValuesOf' in Intl
      ? Intl.supportedValuesOf('timeZone')
      : fallbackTimezones
  return [...new Set(['UTC', detected, ...supported])].sort((a, b) =>
    a.localeCompare(b)
  )
}

export function timezoneOffsetLabel(
  timezone: string,
  now: DateTime<boolean> = DateTime.now()
): string {
  const offset = now.setZone(timezone).offset
  const sign = offset < 0 ? '-' : '+'
  const absolute = Math.abs(offset)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`
}

export function timezoneDifferenceLabel(
  timezone: string,
  now: DateTime<boolean> = DateTime.now(),
  localZone = DateTime.now().zoneName || 'UTC'
): string {
  const tripNow = now.setZone(timezone)
  const localNow = now.setZone(localZone)

  if (!tripNow.isValid) return 'Zona horaria no reconocida.'
  const difference = tripNow.offset - localNow.offset
  if (difference === 0)
    return `Coincide con tu hora local (${timezoneOffsetLabel(timezone, now)}).`

  const direction = difference > 0 ? 'adelante' : 'atrás'
  return `Ahora son las ${tripNow.toFormat('HH:mm')} allá y las ${localNow.toFormat('HH:mm')} aquí · ${formatMinuteDelta(Math.abs(difference))} ${direction}.`
}

function formatMinuteDelta(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} min`
  if (!rest) return `${hours} h`
  return `${hours} h ${rest} min`
}

export function inputToPlan(
  input: PlanInput,
  timezone: string
): Omit<
  PlanRecord,
  | 'id'
  | 'trip_id'
  | 'version'
  | 'created_by'
  | 'updated_by'
  | 'created_at'
  | 'updated_at'
> {
  return {
    title: input.title.trim(),
    local_date: input.local_date,
    start_time: input.start_time,
    end_time: input.end_time || null,
    start_at: localToUtcIso(input.local_date, input.start_time, timezone),
    location: input.location?.trim() || null,
    notes: input.notes?.trim() || null,
    status: input.status,
    booking_status: input.booking_status,
    travel_minutes: Math.max(0, input.travel_minutes),
    buffer_minutes: Math.max(0, input.buffer_minutes),
    reminder_minutes: Math.max(1, input.reminder_minutes),
    deleted_at: null
  }
}
