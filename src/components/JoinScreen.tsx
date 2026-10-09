import { FormEvent, useState } from 'react'
import { LinkSimple } from '@phosphor-icons/react'

interface JoinScreenProps {
  onJoin: (displayName?: string) => Promise<void>
  loading: boolean
  error?: string
}

export function JoinScreen({ onJoin, loading, error }: JoinScreenProps) {
  const [displayName, setDisplayName] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    void onJoin(displayName)
  }

  return (
    <main className='onboarding shell'>
      <section className='hero-card' aria-labelledby='join-title'>
        <div className='brand-mark'>
          <LinkSimple size={28} weight='duotone' />
        </div>
        <h1 id='join-title'>Únete al itinerario compartido.</h1>
        <p className='hero-copy'>
          Este enlace conecta este dispositivo con el viaje. Después podrás ver
          y editar planes incluso sin conexión.
        </p>
        <form className='stack' onSubmit={submit}>
          <label>
            <span>Tu nombre visible</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder='Sam'
              maxLength={60}
            />
          </label>
          {error ? (
            <p className='form-error' role='alert'>
              {error}
            </p>
          ) : null}
          <button className='primary-button' disabled={loading}>
            {loading ? 'Uniendo…' : 'Entrar al viaje'}
          </button>
        </form>
      </section>
    </main>
  )
}
