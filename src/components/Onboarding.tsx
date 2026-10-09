import { FormEvent, useMemo, useState } from 'react'
import { Compass } from '@phosphor-icons/react'
import { TimezoneCombobox } from './TimezoneCombobox'
import {
  timezoneDifferenceLabel,
  timezoneOffsetLabel,
  timezoneOptions
} from '../lib/time'

interface OnboardingProps {
  onCreate: (
    name: string,
    timezone: string,
    displayName?: string
  ) => Promise<void>
  loading: boolean
  error?: string
}

export function Onboarding({ onCreate, loading, error }: OnboardingProps) {
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  )
  const localTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const zones = useMemo(() => timezoneOptions(), [])
  const difference = useMemo(
    () => timezoneDifferenceLabel(timezone),
    [timezone]
  )

  function submit(event: FormEvent) {
    event.preventDefault()
    void onCreate(name, timezone, displayName)
  }

  return (
    <main className='onboarding shell'>
      <section className='hero-card' aria-labelledby='welcome-title'>
        <div className='brand-mark'>
          <Compass size={28} weight='duotone' />
        </div>
        <h1 id='welcome-title'>
          Un itinerario compartido que responde qué sigue.
        </h1>
        <p className='hero-copy'>
          Crea el viaje, importa los planes desde CSV y confirma lo importante.
          Todo queda disponible offline y se sincroniza al recuperar conexión.
        </p>
        <form className='stack' onSubmit={submit}>
          <label>
            <span>Nombre del viaje</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='Japón 2026'
              required
              maxLength={120}
            />
          </label>
          <label>
            <span>Tu nombre visible</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder='Alex'
              maxLength={60}
            />
          </label>
          <label>
            <span>Zona horaria del viaje</span>
            <TimezoneCombobox
              value={timezone}
              zones={zones}
              onChange={setTimezone}
              describedBy='timezone-help'
            />
            <small id='timezone-help'>
              Las horas del CSV se interpretarán en esta zona.
              <br />
              Tu zona local: {localTimezone.replace(/_/g, ' ')} (
              {timezoneOffsetLabel(localTimezone)}).
              <br />
              {difference}
            </small>
          </label>
          {error ? (
            <p className='form-error' role='alert'>
              {error}
            </p>
          ) : null}
          <button className='primary-button' disabled={loading || !name.trim()}>
            {loading ? 'Creando…' : 'Crear viaje'}
          </button>
        </form>
      </section>
    </main>
  )
}
