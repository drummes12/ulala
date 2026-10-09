import type { BookingStatus, PlanStatus } from '../types'

export function planStatusLabel(status: PlanStatus): string {
  if (status === 'confirmed') return 'Confirmado'
  if (status === 'done') return 'Hecho'
  return 'Idea'
}

export function bookingStatusLabel(status: BookingStatus): string {
  if (status === 'booked') return 'Reservado'
  if (status === 'required') return 'Por reservar'
  if (status === 'recommended') return 'Reserva sugerida'
  if (status === 'not_required') return 'Sin reserva'
  return 'Sin definir'
}
