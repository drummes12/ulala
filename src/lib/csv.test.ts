import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('parses required and optional columns', () => {
    const result = parseCsv(
      'fecha,hora_inicio,titulo,lugar,estado,traslado_min\n2026-12-20,09:30,Vuelo,Aeropuerto,confirmed,45'
    )
    expect(result.errors).toEqual([])
    expect(result.plans[0]).toMatchObject({
      local_date: '2026-12-20',
      start_time: '09:30',
      title: 'Vuelo',
      location: 'Aeropuerto',
      status: 'confirmed',
      booking_status: 'booked',
      travel_minutes: 45,
      reminder_minutes: 60
    })
  })

  it('converts DD/MM/YYYY dates to ISO', () => {
    const result = parseCsv(
      'fecha,hora_inicio,titulo\n13/10/2026,17:30,Tren a París'
    )
    expect(result.errors).toEqual([])
    expect(result.plans[0].local_date).toBe('2026-10-13')
  })

  it('splits time ranges from hora_inicio', () => {
    const result = parseCsv(
      'fecha,hora_inicio,titulo\n2026-10-13,17:30-20:30,Cena'
    )
    expect(result.errors).toEqual([])
    expect(result.plans[0]).toMatchObject({
      start_time: '17:30',
      end_time: '20:30'
    })
  })

  it('keeps an explicit hora_fin over the range end', () => {
    const result = parseCsv(
      'fecha,hora_inicio,hora_fin,titulo\n2026-10-13,17:30-20:30,21:00,Cena'
    )
    expect(result.errors).toEqual([])
    expect(result.plans[0].end_time).toBe('21:00')
  })

  it.each([
    ['Confirmado', 'confirmed', 'booked'],
    ['Por reservar', 'confirmed', 'required'],
    ['Reserva recomendada', 'confirmed', 'recommended'],
    ['Sin reserva previa', 'confirmed', 'not_required'],
    ['Plan', 'idea', 'not_required'],
    ['Opcional', 'idea', 'not_required'],
    ['Libre', 'idea', 'not_required'],
    ['Hecho', 'done', 'none'],
    ['idea', 'idea', 'none']
  ])('maps estado "%s" to %s + %s', (estado, status, booking) => {
    const result = parseCsv(
      `fecha,hora_inicio,titulo,estado\n2026-10-13,10:00,Plan,${estado}`
    )
    expect(result.errors).toEqual([])
    expect(result.plans[0]).toMatchObject({
      status,
      booking_status: booking,
      sourceStatus: estado
    })
  })

  it('rejects unknown statuses instead of guessing', () => {
    const result = parseCsv(
      'fecha,hora_inicio,titulo,estado\n2026-10-13,10:00,Plan,Tal vez'
    )
    expect(result.plans).toEqual([])
    expect(result.errors[0].message).toContain('estado no reconocido')
  })

  it('lets reserva column override the booking derived from estado', () => {
    const result = parseCsv(
      'fecha,hora_inicio,titulo,estado,reserva\n2026-10-13,10:00,Museo,Confirmado,por_reservar'
    )
    expect(result.errors).toEqual([])
    expect(result.plans[0]).toMatchObject({
      status: 'confirmed',
      booking_status: 'required'
    })
  })

  it('preserves custom columns and descriptive statuses in notes', () => {
    const result = parseCsv(
      'Fecha,Hora inicio,Título,Estado,Duración Estimada,Costo\n13/10/2026,9:30:00,Barrio libre,Libre,2 h,$0'
    )
    expect(result.errors).toEqual([])
    expect(result.plans[0]).toMatchObject({
      start_time: '09:30',
      status: 'idea',
      booking_status: 'not_required',
      notes: 'duracion estimada: 2 h\ncosto: $0\nEstado original: Libre'
    })
  })

  it('warns when a confirmed plan still sounds unbooked', () => {
    const result = parseCsv(
      'fecha,hora_inicio,titulo,notas,estado\n2026-10-13,10:00,Museo,pendiente de compra,Confirmado'
    )
    expect(result.errors).toEqual([])
    expect(result.plans).toHaveLength(1)
    expect(result.warnings[0].message).toContain('reserva pendiente')
  })

  it('reports row-level validation errors', () => {
    const result = parseCsv('fecha,hora_inicio,titulo\n2026-13-40,09:30,Vuelo')
    expect(result.plans).toEqual([])
    expect(result.errors[0]).toMatchObject({ row: 2 })
  })

  it('requires stable columns', () => {
    const result = parseCsv('date,time,name\n2026-12-20,09:30,Vuelo')
    expect(result.errors.map((error) => error.message)).toContain(
      'Falta la columna fecha'
    )
  })
})
