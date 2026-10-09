import { FormEvent, useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { LocalPlan, PlanInput } from '../types'

interface PlanSheetProps {
  plan?: LocalPlan
  timezone: string
  onClose: () => void
  onSave: (input: PlanInput) => Promise<void>
}

export function PlanSheet({ plan, timezone, onClose, onSave }: PlanSheetProps) {
  const [form, setForm] = useState<PlanInput>({
    title: '',
    local_date: DateTime.now().setZone(timezone).toISODate()!,
    start_time: '09:00',
    status: 'idea',
    booking_status: 'none',
    travel_minutes: 0,
    buffer_minutes: 0,
    reminder_minutes: 60
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!plan) return
    setForm({
      title: plan.title,
      local_date: plan.local_date,
      start_time: plan.start_time.slice(0, 5),
      end_time: plan.end_time?.slice(0, 5),
      location: plan.location ?? '',
      notes: plan.notes ?? '',
      status: plan.status,
      booking_status: plan.booking_status,
      travel_minutes: plan.travel_minutes,
      buffer_minutes: plan.buffer_minutes,
      reminder_minutes: plan.reminder_minutes
    })
  }, [plan])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave(form)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof PlanInput>(key: K, value: PlanInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <div
      className='sheet-backdrop'
      role='presentation'
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className='sheet'
        role='dialog'
        aria-modal='true'
        aria-labelledby='plan-sheet-title'
      >
        <header className='sheet-header'>
          <div>
            <h2 id='plan-sheet-title'>{plan ? 'Editar plan' : 'Nuevo plan'}</h2>
          </div>
          <button
            className='icon-button'
            type='button'
            onClick={onClose}
            aria-label='Cerrar'
          >
            ×
          </button>
        </header>
        <form className='stack' onSubmit={submit}>
          <label>
            <span>Qué van a hacer</span>
            <input
              value={form.title}
              onChange={(event) => update('title', event.target.value)}
              required
              maxLength={160}
              placeholder='Cena en el centro'
              autoFocus
            />
          </label>
          <div className='form-grid'>
            <label>
              <span>Fecha</span>
              <input
                type='date'
                value={form.local_date}
                onChange={(event) => update('local_date', event.target.value)}
                required
              />
            </label>
            <label>
              <span>Inicio</span>
              <input
                type='time'
                value={form.start_time}
                onChange={(event) => update('start_time', event.target.value)}
                required
              />
            </label>
            <label>
              <span>Fin</span>
              <input
                type='time'
                value={form.end_time ?? ''}
                onChange={(event) => update('end_time', event.target.value)}
              />
            </label>
            <label>
              <span>Estado del plan</span>
              <select
                value={form.status}
                onChange={(event) =>
                  update('status', event.target.value as PlanInput['status'])
                }
              >
                <option value='idea'>Idea</option>
                <option value='confirmed'>Confirmado</option>
                <option value='done'>Hecho</option>
              </select>
            </label>
            <label>
              <span>Reserva</span>
              <select
                value={form.booking_status}
                onChange={(event) =>
                  update(
                    'booking_status',
                    event.target.value as PlanInput['booking_status']
                  )
                }
              >
                <option value='none'>Sin definir</option>
                <option value='not_required'>Sin reserva</option>
                <option value='recommended'>Reserva sugerida</option>
                <option value='required'>Por reservar</option>
                <option value='booked'>Reservado</option>
              </select>
            </label>
          </div>
          <p className='helper'>
            Estado decide si el plan va en el itinerario o ya pasó; Reserva
            indica si falta comprar tickets o ya están gestionados.
          </p>
          <label>
            <span>Lugar</span>
            <input
              value={form.location ?? ''}
              onChange={(event) => update('location', event.target.value)}
              placeholder='Hotel, estación, dirección…'
            />
          </label>
          <details className='details'>
            <summary>Margen y aviso</summary>
            <div className='form-grid details-grid'>
              <label>
                <span>Traslado (min)</span>
                <input
                  type='number'
                  min='0'
                  max='1440'
                  value={form.travel_minutes}
                  onChange={(event) =>
                    update('travel_minutes', Number(event.target.value))
                  }
                />
              </label>
              <label>
                <span>Margen (min)</span>
                <input
                  type='number'
                  min='0'
                  max='1440'
                  value={form.buffer_minutes}
                  onChange={(event) =>
                    update('buffer_minutes', Number(event.target.value))
                  }
                />
              </label>
              <label>
                <span>Avisar antes (min)</span>
                <input
                  type='number'
                  min='1'
                  max='10080'
                  value={form.reminder_minutes}
                  onChange={(event) =>
                    update('reminder_minutes', Number(event.target.value))
                  }
                />
              </label>
            </div>
          </details>
          <label>
            <span>Notas</span>
            <textarea
              value={form.notes ?? ''}
              onChange={(event) => update('notes', event.target.value)}
              rows={3}
              placeholder='Reserva, entrada, qué llevar…'
            />
          </label>
          {error ? (
            <p className='form-error' role='alert'>
              {error}
            </p>
          ) : null}
          <div className='sheet-actions'>
            <button
              className='secondary-button'
              type='button'
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className='primary-button' disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar plan'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
