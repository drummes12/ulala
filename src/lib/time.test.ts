import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import {
  inputToPlan,
  leaveAtIso,
  localToUtcIso,
  nextRelevantPlan,
  plansOverlap,
  timezoneDifferenceLabel,
  timezoneOffsetLabel,
  timezoneOptions,
  utcToTripTime
} from './time'
import type { LocalPlan, PlanRecord } from '../types'

const basePlan: PlanRecord = {
  id: 'a',
  trip_id: 'trip',
  title: 'Plan',
  local_date: '2026-12-20',
  start_time: '10:00',
  end_time: '11:00',
  start_at: '2026-12-20T16:00:00.000Z',
  location: null,
  notes: null,
  status: 'confirmed',
  booking_status: 'booked',
  travel_minutes: 30,
  buffer_minutes: 10,
  reminder_minutes: 60,
  version: 1,
  deleted_at: null,
  created_by: null,
  updated_by: null,
  created_at: '',
  updated_at: ''
}

const localPlan: LocalPlan = {
  ...basePlan,
  base_version: 1,
  dirty: false,
  local_updated_at: '',
  conflict_remote: null
}

describe('time utilities', () => {
  it('converts trip-local time to UTC', () => {
    expect(localToUtcIso('2026-12-20', '10:00', 'America/Mexico_City')).toBe(
      '2026-12-20T16:00:00.000Z'
    )
  })

  it('computes leave time from travel and buffer', () => {
    expect(
      utcToTripTime(leaveAtIso(basePlan), 'America/Mexico_City').toFormat(
        'HH:mm'
      )
    ).toBe('09:20')
  })

  it('detects overlapping plans', () => {
    const other = {
      ...basePlan,
      id: 'b',
      start_at: '2026-12-20T16:30:00.000Z',
      start_time: '10:30'
    }
    expect(plansOverlap(basePlan, other, 'America/Mexico_City')).toBe(true)
  })

  it('lists supported timezones including the detected zone', () => {
    const zones = timezoneOptions()
    expect(zones).toContain('UTC')
    expect(zones).toContain('America/Mexico_City')
  })

  it('explains the difference from the local timezone', () => {
    const now = DateTime.fromISO('2026-10-05T12:00:00Z')
    expect(
      timezoneDifferenceLabel('America/Mexico_City', now, 'America/Bogota')
    ).toBe('Ahora son las 06:00 allá y las 07:00 aquí · 1 h atrás.')
    expect(
      timezoneDifferenceLabel('America/Bogota', now, 'America/Bogota')
    ).toBe('Coincide con tu hora local (UTC-5).')
    expect(timezoneOffsetLabel('Europe/Madrid', now)).toBe('UTC+2')
  })

  it('skips done plans when picking the next relevant plan', () => {
    const soon = DateTime.utc().plus({ hours: 1 }).toISO()!
    const later = DateTime.utc().plus({ hours: 5 }).toISO()!
    const done = {
      ...localPlan,
      id: 'done',
      status: 'done' as const,
      start_at: soon,
      end_time: null
    }
    const next = {
      ...localPlan,
      id: 'next',
      start_at: later,
      end_time: null
    }
    expect(nextRelevantPlan([done, next], 'UTC')?.id).toBe('next')
  })

  it('keeps booking_status through inputToPlan', () => {
    const plan = inputToPlan(
      {
        title: 'Museo',
        local_date: '2026-12-20',
        start_time: '10:00',
        status: 'confirmed',
        booking_status: 'required',
        travel_minutes: 0,
        buffer_minutes: 0,
        reminder_minutes: 60
      },
      'UTC'
    )
    expect(plan.booking_status).toBe('required')
    expect(plan.status).toBe('confirmed')
  })
})
