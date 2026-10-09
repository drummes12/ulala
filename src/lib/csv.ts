import Papa from 'papaparse'
import { DateTime } from 'luxon'
import type {
  BookingStatus,
  CsvPlanInput,
  PlanInput,
  PlanStatus
} from '../types'

export interface CsvIssue {
  row: number
  message: string
}

export interface CsvParseResult {
  plans: CsvPlanInput[]
  errors: CsvIssue[]
  warnings: CsvIssue[]
}

interface StatusMapping {
  status: PlanStatus
  bookingStatus: BookingStatus
  preserveOriginal: boolean
}

const required = ['fecha', 'hora_inicio', 'titulo']
const aliases: Record<string, keyof PlanInput> = {
  fecha: 'local_date',
  dia: 'local_date',
  hora_inicio: 'start_time',
  hora_de_inicio: 'start_time',
  inicio: 'start_time',
  horario: 'start_time',
  titulo: 'title',
  nombre: 'title',
  plan: 'title',
  actividad: 'title',
  hora_fin: 'end_time',
  hora_de_fin: 'end_time',
  fin: 'end_time',
  lugar: 'location',
  ubicacion: 'location',
  direccion: 'location',
  notas: 'notes',
  estado: 'status',
  reserva: 'booking_status',
  estado_reserva: 'booking_status',
  booking_status: 'booking_status',
  traslado_min: 'travel_minutes',
  traslado: 'travel_minutes',
  transporte_min: 'travel_minutes',
  margen_min: 'buffer_minutes',
  margen: 'buffer_minutes',
  recordatorio_min: 'reminder_minutes',
  aviso_min: 'reminder_minutes'
}

const statusMap: Record<string, StatusMapping> = {
  idea: { status: 'idea', bookingStatus: 'none', preserveOriginal: false },
  pendiente: {
    status: 'idea',
    bookingStatus: 'none',
    preserveOriginal: true
  },
  por_confirmar: {
    status: 'idea',
    bookingStatus: 'none',
    preserveOriginal: true
  },
  plan: {
    status: 'idea',
    bookingStatus: 'not_required',
    preserveOriginal: true
  },
  libre: {
    status: 'idea',
    bookingStatus: 'not_required',
    preserveOriginal: true
  },
  opcional: {
    status: 'idea',
    bookingStatus: 'not_required',
    preserveOriginal: true
  },
  confirmed: {
    status: 'confirmed',
    bookingStatus: 'booked',
    preserveOriginal: false
  },
  confirmado: {
    status: 'confirmed',
    bookingStatus: 'booked',
    preserveOriginal: false
  },
  confirmada: {
    status: 'confirmed',
    bookingStatus: 'booked',
    preserveOriginal: false
  },
  reservado: {
    status: 'confirmed',
    bookingStatus: 'booked',
    preserveOriginal: false
  },
  reservada: {
    status: 'confirmed',
    bookingStatus: 'booked',
    preserveOriginal: false
  },
  booked: {
    status: 'confirmed',
    bookingStatus: 'booked',
    preserveOriginal: false
  },
  por_reservar: {
    status: 'confirmed',
    bookingStatus: 'required',
    preserveOriginal: false
  },
  pendiente_de_reserva: {
    status: 'confirmed',
    bookingStatus: 'required',
    preserveOriginal: true
  },
  reserva_recomendada: {
    status: 'confirmed',
    bookingStatus: 'recommended',
    preserveOriginal: false
  },
  reserva_sugerida: {
    status: 'confirmed',
    bookingStatus: 'recommended',
    preserveOriginal: false
  },
  sin_reserva: {
    status: 'confirmed',
    bookingStatus: 'not_required',
    preserveOriginal: false
  },
  sin_reserva_previa: {
    status: 'confirmed',
    bookingStatus: 'not_required',
    preserveOriginal: false
  },
  no_requiere_reserva: {
    status: 'confirmed',
    bookingStatus: 'not_required',
    preserveOriginal: false
  },
  hecho: {
    status: 'done',
    bookingStatus: 'none',
    preserveOriginal: false
  },
  realizado: {
    status: 'done',
    bookingStatus: 'none',
    preserveOriginal: false
  },
  realizada: {
    status: 'done',
    bookingStatus: 'none',
    preserveOriginal: false
  },
  done: {
    status: 'done',
    bookingStatus: 'none',
    preserveOriginal: false
  }
}

export function csvTemplate(): string {
  return [
    'fecha,hora_inicio,hora_fin,titulo,lugar,notas,estado,reserva,traslado_min,margen_min,recordatorio_min',
    '2026-12-20,09:30,12:05,Vuelo a Ciudad de México,Aeropuerto,Confirmar maletas,confirmado,reservado,45,20,60'
  ].join('\n')
}

export function parseCsv(text: string): CsvParseResult {
  const result = Papa.parse<Record<string, string>>(
    text.replace(/^\uFEFF/, ''),
    {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normalizeHeader
    }
  )

  const warnings: CsvIssue[] = result.errors.map((error) => ({
    row: typeof error.row === 'number' ? error.row + 2 : 0,
    message: `CSV mal formado: ${error.message}`
  }))
  const headers = result.meta.fields ?? []
  const missing = required.filter(
    (field) => !headers.some((header) => aliases[header] === aliases[field])
  )
  const errors = missing.map((field) => ({
    row: 0,
    message: `Falta la columna ${field}`
  }))
  const plans: CsvPlanInput[] = []

  if (missing.length) return { plans, errors, warnings }

  const extraHeaders = headers.filter(
    (header) => header && !aliases[header] && header !== '__parsed_extra'
  )

  result.data.forEach((row, index) => {
    const rowNumber = index + 2
    const normalized: Record<string, string> = {}
    Object.entries(aliases).forEach(([csvKey, planKey]) => {
      const value = sanitizeCell(row[csvKey] ?? '')
      if (value && !normalized[planKey]) normalized[planKey] = value
    })

    const rowErrors = validateRow(normalized)
    if (rowErrors.length) {
      rowErrors.forEach((message) => errors.push({ row: rowNumber, message }))
      return
    }

    const status = normalized.status
      ? statusMap[normalizeHeader(normalized.status)]
      : {
          status: 'idea' as const,
          bookingStatus: 'none' as const,
          preserveOriginal: false
        }
    const bookingStatus = normalized.booking_status
      ? normalizeBookingStatus(normalized.booking_status)
      : status.bookingStatus

    const pendingHint = `${normalized.title} ${normalized.notes ?? ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    if (
      status.bookingStatus === 'booked' &&
      /\b(pendiente|por reservar|reservar|comprar|liberar|esperar)\b/.test(
        pendingHint
      )
    ) {
      warnings.push({
        row: rowNumber,
        message: 'Dice Confirmado, pero la nota sugiere una reserva pendiente'
      })
    }

    if (normalized.location && /^[a-záéíóúñü]/.test(normalized.location)) {
      warnings.push({
        row: rowNumber,
        message:
          'El lugar empieza en minúscula; puede haber una coma sin comillas en el título'
      })
    }

    const extraNotes = extraHeaders
      .map((header) => {
        const value = sanitizeCell(row[header] ?? '')
        if (!value || /^[—–\-]+$|^n\/a$/i.test(value)) return ''
        return `${header.replace(/_/g, ' ')}: ${value}`
      })
      .filter(Boolean)
    const notes = [
      normalized.notes,
      ...extraNotes,
      status.preserveOriginal && normalized.status
        ? `Estado original: ${normalized.status}`
        : ''
    ]
      .filter(Boolean)
      .join('\n')

    plans.push({
      sourceRow: rowNumber,
      sourceStatus: normalized.status || undefined,
      title: normalized.title,
      local_date: normalized.local_date,
      start_time: normalized.start_time,
      end_time: normalized.end_time || undefined,
      location: normalized.location || undefined,
      notes: notes || undefined,
      status: status.status,
      booking_status: bookingStatus ?? 'none',
      travel_minutes: numberValue(normalized.travel_minutes),
      buffer_minutes: numberValue(normalized.buffer_minutes),
      reminder_minutes: numberValue(normalized.reminder_minutes) || 60
    })
  })

  return { plans, errors, warnings }
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')
}

function normalizeBookingStatus(value: string): BookingStatus | null {
  const normalized = normalizeHeader(value)
  if (!normalized || ['none', 'sin_definir', 'na', 'n_a'].includes(normalized))
    return 'none'
  if (
    [
      'sin_reserva',
      'sin_reserva_previa',
      'no_requiere_reserva',
      'no_requiere'
    ].includes(normalized)
  )
    return 'not_required'
  if (['reserva_recomendada', 'reserva_sugerida'].includes(normalized))
    return 'recommended'
  if (['por_reservar', 'pendiente_de_reserva'].includes(normalized))
    return 'required'
  if (['reservado', 'reservada', 'booked'].includes(normalized)) return 'booked'
  return null
}

function normalizeDate(value: string): string | null {
  if (!value) return null
  const formats = [
    'yyyy-MM-dd',
    'dd/MM/yyyy',
    'd/M/yyyy',
    'dd-MM-yyyy',
    'd-M-yyyy'
  ]
  for (const format of formats) {
    const parsed = DateTime.fromFormat(value, format)
    if (parsed.isValid) return parsed.toISODate()
  }
  return null
}

function normalizeTime(value: string): string | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function splitTimeRange(value: string): [string, string] | null {
  if (!value) return null
  const match = /^(.+?)\s*[-–—]\s*(.+)$/.exec(value)
  if (!match) return null
  const start = normalizeTime(match[1].trim())
  const end = normalizeTime(match[2].trim())
  return start && end ? [start, end] : null
}

function sanitizeCell(value: string): string {
  const trimmed = value.trim()
  if (/^[=+\-@]/.test(trimmed)) return `'${trimmed}`
  return trimmed
}

function numberValue(value: string): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : -1
}

function validateRow(row: Record<string, string>): string[] {
  const errors: string[] = []
  const date = normalizeDate(row.local_date)
  const timeRange = splitTimeRange(row.start_time)
  const startTime = timeRange?.[0] ?? normalizeTime(row.start_time)
  const endTime = row.end_time
    ? normalizeTime(row.end_time)
    : (timeRange?.[1] ?? '')

  if (!date) errors.push('fecha debe ser YYYY-MM-DD o DD/MM/YYYY')
  else row.local_date = date
  if (!startTime) errors.push('hora_inicio debe ser HH:mm o HH:mm-HH:mm')
  else row.start_time = startTime
  if (row.end_time && !endTime) errors.push('hora_fin debe ser HH:mm')
  else if (endTime) row.end_time = endTime
  if (!row.title) errors.push('titulo es obligatorio')
  if (row.status && !statusMap[normalizeHeader(row.status)])
    errors.push('estado no reconocido')
  if (row.booking_status && !normalizeBookingStatus(row.booking_status))
    errors.push(
      'reserva debe ser sin_definir, sin_reserva, reserva_sugerida, por_reservar o reservado'
    )
  for (const field of [
    'travel_minutes',
    'buffer_minutes',
    'reminder_minutes'
  ]) {
    if (row[field] && numberValue(row[field]) < 0)
      errors.push(`${field} debe ser un número positivo`)
  }
  return errors
}
