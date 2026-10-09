import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  Bell,
  CheckCircle,
  Circle,
  CloudArrowUp,
  Copy,
  FileCsv,
  FlagCheckered,
  ListBullets,
  MapPin,
  PencilSimple,
  Plus,
  ShareNetwork,
  Ticket,
  Trash,
  Warning
} from '@phosphor-icons/react'
import { CsvImporter } from './components/CsvImporter'
import { JoinScreen } from './components/JoinScreen'
import { Onboarding } from './components/Onboarding'
import { PlanSheet } from './components/PlanSheet'
import {
  deleteLocalPlan,
  getMeta,
  plansForTrip,
  saveLocalPlan,
  setMeta
} from './lib/db'
import { enableNotifications, notificationSupport } from './lib/notifications'
import { bookingStatusLabel, planStatusLabel } from './lib/planLabels'
import { ensureUser } from './lib/convexClient'
import {
  createTrip,
  getInviteToken,
  getStoredTripId,
  joinTrip,
  loadLocalTrip,
  regenerateInvite,
  resolveConflict,
  subscribeToPlans,
  syncTrip,
  updateDisplayName
} from './lib/sync'
import {
  formatDayLabel,
  formatPlanTime,
  leaveAtIso,
  nextRelevantPlan,
  plansOverlap,
  relativeTiming,
  utcToTripTime
} from './lib/time'
import type {
  CsvPlanInput,
  LocalPlan,
  MemberRecord,
  PlanInput,
  PlanStatus,
  SyncState,
  TripRecord
} from './types'

type Mode = 'loading' | 'onboarding' | 'invite' | 'trip'
type MainView = 'itinerary' | 'reservations'

export default function App() {
  const [mode, setMode] = useState<Mode>('loading')
  const [inviteToken, setInviteToken] = useState('')
  const [tripId, setTripId] = useState('')
  const [trip, setTrip] = useState<TripRecord>()
  const [members, setMembers] = useState<MemberRecord[]>([])
  const [plans, setPlans] = useState<LocalPlan[]>([])
  const [userId, setUserId] = useState('')
  const [syncState, setSyncState] = useState<SyncState>('offline')
  const [syncMessage, setSyncMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<LocalPlan | undefined>()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [view, setView] = useState<MainView>('itinerary')
  const [notice, setNotice] = useState('')
  const [tick, setTick] = useState(0)

  const refreshLocal = useCallback(
    async (id = tripId) => {
      if (!id) return
      const local = await loadLocalTrip(id)
      setTrip(local.trip)
      setMembers(local.members)
      setPlans(
        local.plans.filter((plan) => !plan.pending_delete && !plan.deleted_at)
      )
    },
    [tripId]
  )

  const runSync = useCallback(
    async (id = tripId) => {
      if (!id) return
      await syncTrip(id, (state, message) => {
        setSyncState(state)
        setSyncMessage(message ?? '')
      })
      await refreshLocal(id)
    },
    [refreshLocal, tripId]
  )

  useEffect(() => {
    const token = readInviteToken()
    if (token) {
      setInviteToken(token)
      setMode('invite')
      return
    }
    void (async () => {
      const storedTripId = await getStoredTripId()
      if (!storedTripId) {
        setMode('onboarding')
        return
      }
      setTripId(storedTripId)
      const local = await loadLocalTrip(storedTripId)
      setTrip(local.trip)
      setMembers(local.members)
      setPlans(
        local.plans.filter((plan) => !plan.pending_delete && !plan.deleted_at)
      )
      const user = await ensureUser()
      setUserId(user.id)
      setMode('trip')
      void runSync(storedTripId)
    })()
  }, [runSync])

  useEffect(() => {
    const onOnline = () => void runSync()
    window.addEventListener('online', onOnline)
    const interval = window.setInterval(
      () => setTick((value) => value + 1),
      60_000
    )
    return () => {
      window.removeEventListener('online', onOnline)
      window.clearInterval(interval)
    }
  }, [runSync])

  useEffect(() => {
    if (!tripId || mode !== 'trip') return
    const subscription = subscribeToPlans(tripId, () => void runSync(tripId))
    return () => {
      subscription.unsubscribe()
    }
  }, [mode, runSync, tripId])

  async function handleCreate(
    name: string,
    timezone: string,
    displayName?: string
  ) {
    setBusy(true)
    setFormError('')
    try {
      const user = await ensureUser()
      setUserId(user.id)
      const created = await createTrip(name, timezone, displayName)
      setTripId(created.trip_id)
      setMode('trip')
      await runSync(created.trip_id)
      setNotice('Viaje creado. Comparte el enlace desde Ajustes.')
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : 'No se pudo crear el viaje.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleJoin(displayName?: string) {
    setBusy(true)
    setFormError('')
    try {
      const user = await ensureUser()
      setUserId(user.id)
      const joined = await joinTrip(inviteToken, displayName)
      history.replaceState(null, '', '/')
      setTripId(joined.trip_id)
      setMode('trip')
      await runSync(joined.trip_id)
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo abrir la invitación.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(input: PlanInput) {
    if (!trip) throw new Error('No hay viaje activo.')
    await saveLocalPlan(trip.id, input, trip.timezone, editing)
    setEditing(undefined)
    await refreshLocal()
    void runSync()
  }

  async function handleDelete(plan: LocalPlan) {
    if (!window.confirm(`Eliminar “${plan.title}”?`)) return
    await deleteLocalPlan(plan)
    await refreshLocal()
    void runSync()
  }

  async function updatePlanStatus(plan: LocalPlan, status: PlanStatus) {
    if (!trip) return
    await saveLocalPlan(
      trip.id,
      {
        title: plan.title,
        local_date: plan.local_date,
        start_time: plan.start_time,
        end_time: plan.end_time ?? undefined,
        location: plan.location ?? undefined,
        notes: plan.notes ?? undefined,
        status,
        booking_status: plan.booking_status,
        travel_minutes: plan.travel_minutes,
        buffer_minutes: plan.buffer_minutes,
        reminder_minutes: plan.reminder_minutes
      },
      trip.timezone,
      plan
    )
    await refreshLocal()
    void runSync()
  }

  async function handleConflict(plan: LocalPlan, keepLocal: boolean) {
    await resolveConflict(plan, keepLocal)
    await refreshLocal()
    if (keepLocal) void runSync()
  }

  async function importPlans(inputs: CsvPlanInput[]) {
    if (!trip) return
    for (const input of inputs) {
      await saveLocalPlan(trip.id, input, trip.timezone)
    }
    await refreshLocal()
    void runSync()
    setNotice(`${inputs.length} planes importados.`)
  }

  async function copyInvite() {
    if (!trip) return
    const token = await getInviteToken(trip.id)
    if (!token) {
      setNotice(
        'Este dispositivo no conserva el enlace actual. Regenera uno nuevo.'
      )
      return
    }
    const url = `${location.origin}/#join=${token}`
    await navigator.clipboard.writeText(url)
    setNotice('Enlace copiado.')
  }

  async function rotateInvite() {
    if (
      !trip ||
      !window.confirm(
        'El enlace anterior dejará de aceptar nuevos dispositivos. ¿Regenerarlo?'
      )
    )
      return
    const token = await regenerateInvite(trip.id)
    const url = `${location.origin}/#join=${token}`
    await navigator.clipboard.writeText(url)
    setNotice('Nuevo enlace copiado. El anterior quedó revocado.')
  }

  async function subscribeNotifications() {
    try {
      await enableNotifications()
      setNotice('Avisos activados en este dispositivo.')
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : 'No se pudieron activar los avisos.'
      )
    }
  }

  async function saveDisplayName(value: string) {
    if (!trip || !userId || !value.trim()) return
    await updateDisplayName(trip.id, userId, value.trim())
    await refreshLocal()
    void runSync()
  }

  const activePlan = useMemo(
    () => nextRelevantPlan(plans, trip?.timezone ?? 'UTC'),
    [plans, tick, trip?.timezone]
  )
  const grouped = useMemo(() => groupByDay(plans), [plans])
  const overlapIds = useMemo(() => {
    const ids = new Set<string>()
    plans.forEach((plan) => {
      if (
        plans.some((other) =>
          plansOverlap(plan, other, trip?.timezone ?? 'UTC')
        )
      )
        ids.add(plan.id)
    })
    return ids
  }, [plans, trip?.timezone])
  const conflicts = plans.filter((plan) => plan.conflict_remote)
  const pendingCount = plans.filter(
    (plan) => plan.dirty || plan.conflict_remote
  ).length
  const reservationPendingCount = plans.filter(
    (plan) =>
      plan.status !== 'done' &&
      (plan.booking_status === 'required' ||
        plan.booking_status === 'recommended' ||
        plan.booking_status === 'none')
  ).length
  const support = notificationSupport()

  if (mode === 'loading') {
    return (
      <main className='shell loading-shell'>
        <p>Cargando Ulala…</p>
      </main>
    )
  }

  if (mode === 'invite') {
    return <JoinScreen onJoin={handleJoin} loading={busy} error={formError} />
  }

  if (mode === 'onboarding' || !trip) {
    return (
      <Onboarding
        onCreate={handleCreate}
        loading={busy}
        error={formError || syncMessage}
      />
    )
  }

  return (
    <main className='app-shell'>
      <header className='app-header'>
        <div>
          <h1>{trip.name}</h1>
        </div>
        <button
          className={`sync-pill ${syncState}`}
          type='button'
          onClick={() => void runSync()}
          title={syncMessage || 'Sincronizar ahora'}
        >
          <CloudArrowUp
            size={18}
            weight={syncState === 'syncing' ? 'fill' : 'regular'}
          />
          {syncLabel(syncState, pendingCount)}
        </button>
      </header>

      {notice ? (
        <p className='notice' role='status'>
          {notice}
        </p>
      ) : null}
      {syncMessage && syncState === 'error' ? (
        <p className='notice error' role='alert'>
          {syncMessage}
        </p>
      ) : null}

      {view === 'itinerary' ? (
        <section className='next-section' aria-labelledby='next-title'>
          <div className='section-title'>
            <h2 id='next-title'>Lo siguiente</h2>
          </div>
          {activePlan ? (
            <article className={`next-card ${activePlan.status}`}>
              <div className='next-main'>
                <div className='next-meta'>
                  <span>
                    {formatDayLabel(activePlan.local_date, trip.timezone)}
                  </span>
                  <span className='next-flags'>
                    {activePlan.booking_status !== 'none' &&
                    activePlan.booking_status !== 'not_required' ? (
                      <span
                        className={`booking-pill ${activePlan.booking_status}`}
                      >
                        {bookingStatusLabel(activePlan.booking_status)}
                      </span>
                    ) : null}
                    <span className={`next-status ${activePlan.status}`}>
                      {planStatusLabel(activePlan.status)}
                    </span>
                  </span>
                </div>
                <h3>{activePlan.title}</h3>
                <p className='next-time'>
                  {formatPlanTime(activePlan, trip.timezone)}
                </p>
                {activePlan.location ? (
                  <p className='meta-line'>
                    <MapPin size={17} /> {activePlan.location}
                  </p>
                ) : null}
              </div>
              <div className='leave-box'>
                <span>{relativeTiming(activePlan, trip.timezone)}</span>
                <strong>
                  Salir{' '}
                  {utcToTripTime(
                    leaveAtIso(activePlan),
                    trip.timezone
                  ).toFormat('HH:mm')}
                </strong>
                <small>
                  {activePlan.travel_minutes + activePlan.buffer_minutes > 0
                    ? `${activePlan.travel_minutes + activePlan.buffer_minutes} min de traslado + margen`
                    : 'Sin traslado ni margen'}
                </small>
              </div>
              <div className='next-actions'>
                {activePlan.status === 'confirmed' ? (
                  <>
                    <button
                      className='next-action primary'
                      type='button'
                      onClick={() => void updatePlanStatus(activePlan, 'done')}
                    >
                      <FlagCheckered size={17} weight='fill' /> Marcar hecho
                    </button>
                    <button
                      className='next-action'
                      type='button'
                      onClick={() => void updatePlanStatus(activePlan, 'idea')}
                    >
                      <Circle size={17} /> Volver a idea
                    </button>
                  </>
                ) : (
                  <button
                    className='next-action primary'
                    type='button'
                    onClick={() =>
                      void updatePlanStatus(activePlan, 'confirmed')
                    }
                  >
                    <CheckCircle size={17} /> Confirmar
                  </button>
                )}
                <button
                  className='next-action'
                  type='button'
                  onClick={() => {
                    setEditing(activePlan)
                    setSheetOpen(true)
                  }}
                >
                  <PencilSimple size={17} /> Editar
                </button>
              </div>
            </article>
          ) : (
            <div className='empty-state'>
              <h3>Sin planes pendientes</h3>
              <p>Añade el primer plan o importa el itinerario desde Excel.</p>
            </div>
          )}
        </section>
      ) : null}

      <nav className='quick-actions' aria-label='Acciones principales'>
        <button
          className='primary-button'
          onClick={() => {
            setEditing(undefined)
            setSheetOpen(true)
          }}
        >
          <Plus size={19} /> Plan
        </button>
        <button
          className={
            view === 'reservations' ? 'primary-button' : 'secondary-button'
          }
          aria-pressed={view === 'reservations'}
          onClick={() =>
            setView(view === 'reservations' ? 'itinerary' : 'reservations')
          }
        >
          <Ticket size={19} /> Reservas
          {reservationPendingCount > 0 ? ` · ${reservationPendingCount}` : ''}
        </button>
        <button className='secondary-button' onClick={() => setCsvOpen(true)}>
          <FileCsv size={19} /> CSV
        </button>
        <button
          className='secondary-button'
          onClick={() => setSettingsOpen(true)}
        >
          <ShareNetwork size={19} /> Viaje
        </button>
      </nav>

      {conflicts.length ? (
        <section className='conflict-panel' aria-labelledby='conflict-title'>
          <h2 id='conflict-title'>
            <Warning size={19} /> Cambios que coinciden
          </h2>
          {conflicts.map((plan) => (
            <article key={plan.id} className='conflict-card'>
              <div>
                <strong>{plan.title}</strong>
                <p>
                  Otro dispositivo cambió este plan a{' '}
                  {plan.conflict_remote?.start_time?.slice(0, 5)}.
                </p>
              </div>
              <div className='inline-actions'>
                <button
                  className='secondary-button'
                  onClick={() => void handleConflict(plan, false)}
                >
                  Usar remoto
                </button>
                <button
                  className='primary-button'
                  onClick={() => void handleConflict(plan, true)}
                >
                  Conservar mío
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {view === 'reservations' ? (
        <ReservationsView
          plans={plans}
          timezone={trip.timezone}
          onBack={() => setView('itinerary')}
          onEdit={(plan) => {
            setEditing(plan)
            setSheetOpen(true)
          }}
        />
      ) : (
        <section className='timeline' aria-labelledby='timeline-title'>
          <div className='section-title'>
            <h2 id='timeline-title'>Día por día</h2>
          </div>
          {grouped.length ? (
            grouped.map(([date, dayPlans]) => (
              <section
                className='day-group'
                key={date}
                aria-label={formatDayLabel(date, trip.timezone)}
              >
                <h3>{formatDayLabel(date, trip.timezone)}</h3>
                <div className='plan-list'>
                  {dayPlans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      timezone={trip.timezone}
                      overlap={overlapIds.has(plan.id)}
                      onEdit={() => {
                        setEditing(plan)
                        setSheetOpen(true)
                      }}
                      onDelete={() => void handleDelete(plan)}
                      onStatusChange={(status) =>
                        void updatePlanStatus(plan, status)
                      }
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className='empty-state'>
              <h3>Todavía no hay planes</h3>
              <p>Crea uno manualmente o importa filas desde un CSV.</p>
            </div>
          )}
        </section>
      )}

      {sheetOpen ? (
        <PlanSheet
          plan={editing}
          timezone={trip.timezone}
          onClose={() => {
            setSheetOpen(false)
            setEditing(undefined)
          }}
          onSave={handleSave}
        />
      ) : null}
      {csvOpen ? (
        <CsvImporter
          existingPlans={plans}
          onClose={() => setCsvOpen(false)}
          onImport={importPlans}
        />
      ) : null}
      {settingsOpen ? (
        <div
          className='sheet-backdrop'
          role='presentation'
          onMouseDown={(event) =>
            event.target === event.currentTarget && setSettingsOpen(false)
          }
        >
          <section
            className='sheet'
            role='dialog'
            aria-modal='true'
            aria-labelledby='trip-settings-title'
          >
            <header className='sheet-header'>
              <div>
                <h2 id='trip-settings-title'>Compartir y avisos</h2>
              </div>
              <button
                className='icon-button'
                type='button'
                onClick={() => setSettingsOpen(false)}
                aria-label='Cerrar'
              >
                ×
              </button>
            </header>
            <div className='stack'>
              <section className='settings-block'>
                <h3>Enlace secreto</h3>
                <p>
                  Reutilizable para añadir dispositivos. Regenerarlo bloquea
                  nuevas entradas con el enlace anterior.
                </p>
                <div className='inline-actions'>
                  <button
                    className='primary-button'
                    onClick={() => void copyInvite()}
                  >
                    <Copy size={18} /> Copiar enlace
                  </button>
                  <button
                    className='secondary-button'
                    onClick={() => void rotateInvite()}
                  >
                    <ArrowsClockwise size={18} /> Regenerar
                  </button>
                </div>
              </section>
              <section className='settings-block'>
                <h3>Avisos en este dispositivo</h3>
                <p>
                  Solo avisamos de planes confirmados. En iPhone hay que
                  instalar la app en inicio.
                </p>
                {support.isIos && !support.isStandalone ? (
                  <p className='helper'>
                    iPhone: Compartir → “Añadir a pantalla de inicio”, abre
                    Ulala desde el icono y vuelve aquí.
                  </p>
                ) : null}
                <button
                  className='primary-button'
                  onClick={() => void subscribeNotifications()}
                  disabled={!support.supported}
                >
                  <Bell size={18} /> Activar avisos
                </button>
                {!support.supported ? (
                  <p className='helper'>Este navegador no soporta Push API.</p>
                ) : null}
              </section>
              <section className='settings-block'>
                <h3>Personas</h3>
                <ul className='member-list'>
                  {members.map((member) => (
                    <li key={member.user_id}>
                      {member.user_id === userId ? (
                        <label>
                          <span className='sr-only'>Tu nombre</span>
                          <input
                            defaultValue={member.display_name}
                            onBlur={(event) =>
                              void saveDisplayName(event.target.value)
                            }
                          />
                        </label>
                      ) : (
                        member.display_name
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function PlanCard({
  plan,
  timezone,
  overlap,
  onEdit,
  onDelete,
  onStatusChange
}: {
  plan: LocalPlan
  timezone: string
  overlap: boolean
  onEdit: () => void
  onDelete: () => void
  onStatusChange: (status: PlanStatus) => void
}) {
  const done = plan.status === 'done'
  return (
    <article
      className={`plan-card ${plan.status} ${plan.dirty ? 'pending' : ''}`}
    >
      <div className='time-column'>
        <strong>{plan.start_time.slice(0, 5)}</strong>
        {plan.end_time ? <span>{plan.end_time.slice(0, 5)}</span> : null}
      </div>
      <div className='plan-content'>
        <div className='plan-heading'>
          <h4>{plan.title}</h4>
          <span
            className={`dot ${plan.status}`}
            aria-label={planStatusLabel(plan.status)}
          />
        </div>
        <div className='plan-flags'>
          {plan.status === 'idea' ? (
            <span className='flag idea'>Idea</span>
          ) : null}
          {done ? <span className='flag done'>Hecho</span> : null}
          {plan.booking_status !== 'none' &&
          plan.booking_status !== 'not_required' ? (
            <span className={`flag booking ${plan.booking_status}`}>
              {bookingStatusLabel(plan.booking_status)}
            </span>
          ) : null}
        </div>
        <p className='meta-line'>
          {done ? 'Hecho' : relativeTiming(plan, timezone)} ·{' '}
          {formatPlanTime(plan, timezone)}
        </p>
        {plan.location ? (
          <p className='meta-line'>
            <MapPin size={16} /> {plan.location}
          </p>
        ) : null}
        {overlap && !done ? (
          <p className='warning-line'>
            <Warning size={16} /> Coincide con otro plan
          </p>
        ) : null}
        {plan.notes ? (
          <details className='notes'>
            <summary>Notas</summary>
            <p>{plan.notes}</p>
          </details>
        ) : null}
        {plan.dirty ? <p className='helper'>Pendiente de sincronizar</p> : null}
      </div>
      <div className='card-actions'>
        <button
          className='icon-button'
          onClick={() =>
            onStatusChange(
              plan.status === 'idea'
                ? 'confirmed'
                : plan.status === 'confirmed'
                  ? 'done'
                  : 'confirmed'
            )
          }
          aria-label={
            plan.status === 'idea'
              ? 'Confirmar plan'
              : plan.status === 'confirmed'
                ? 'Marcar como hecho'
                : 'Reabrir plan'
          }
        >
          {plan.status === 'idea' ? (
            <Circle size={22} />
          ) : plan.status === 'confirmed' ? (
            <FlagCheckered size={22} />
          ) : (
            <ArrowCounterClockwise size={22} />
          )}
        </button>
        <button
          className='icon-button'
          onClick={onEdit}
          aria-label='Editar plan'
        >
          <PencilSimple size={20} />
        </button>
        <button
          className='icon-button danger'
          onClick={onDelete}
          aria-label='Eliminar plan'
        >
          <Trash size={20} />
        </button>
      </div>
    </article>
  )
}

const RESERVATION_GROUPS: {
  key: string
  title: string
  description: string
  match: (plan: LocalPlan) => boolean
}[] = [
  {
    key: 'required',
    title: 'Por reservar',
    description: 'Obligatorias y todavía sin gestionar.',
    match: (plan) => plan.booking_status === 'required'
  },
  {
    key: 'recommended',
    title: 'Reserva sugerida',
    description: 'Conviene decidir si reservar o no.',
    match: (plan) => plan.booking_status === 'recommended'
  },
  {
    key: 'review',
    title: 'Por revisar',
    description: 'Sin decisión: revisad si hace falta reserva.',
    match: (plan) => plan.booking_status === 'none'
  },
  {
    key: 'booked',
    title: 'Reservado',
    description: 'Ya gestionadas.',
    match: (plan) => plan.booking_status === 'booked'
  }
]

function ReservationsView({
  plans,
  timezone,
  onBack,
  onEdit
}: {
  plans: LocalPlan[]
  timezone: string
  onBack: () => void
  onEdit: (plan: LocalPlan) => void
}) {
  const groups = RESERVATION_GROUPS.map((group) => ({
    ...group,
    items: plans
      .filter((plan) => plan.status !== 'done' && group.match(plan))
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
  }))
  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  const pending =
    groups[0].items.length + groups[1].items.length + groups[2].items.length

  return (
    <section className='reservations' aria-labelledby='reservations-title'>
      <div className='section-title'>
        <h2 id='reservations-title'>Reservas</h2>
        <button className='secondary-button' onClick={onBack}>
          <ListBullets size={18} /> Itinerario
        </button>
      </div>
      <p className='reservation-summary'>
        {pending
          ? `${pending} por gestionar · ${groups[3].items.length} reservada${groups[3].items.length === 1 ? '' : 's'}`
          : `Todo gestionado · ${groups[3].items.length} reservada${groups[3].items.length === 1 ? '' : 's'}`}
      </p>
      {total === 0 ? (
        <div className='empty-state'>
          <h3>Sin reservas en marcha</h3>
          <p>
            Los planes marcados como “Sin reserva” o “Hecho” no aparecen aquí.
          </p>
        </div>
      ) : (
        groups.map(
          (group) =>
            group.items.length > 0 && (
              <section
                className={`reservation-group ${group.key}`}
                key={group.key}
                aria-label={group.title}
              >
                <h3>
                  {group.title}
                  <span className='count'>{group.items.length}</span>
                </h3>
                <p className='helper'>{group.description}</p>
                <div className='plan-list'>
                  {group.items.map((plan) => (
                    <article
                      className={`reservation-card ${group.key} ${plan.dirty ? 'pending' : ''}`}
                      key={plan.id}
                    >
                      <div className='plan-content'>
                        <div className='plan-heading'>
                          <h4>{plan.title}</h4>
                          <span
                            className={`dot ${plan.status}`}
                            aria-label={planStatusLabel(plan.status)}
                          />
                        </div>
                        <div className='plan-flags'>
                          {plan.status === 'idea' ? (
                            <span className='flag idea'>Idea</span>
                          ) : null}
                          <span
                            className={`flag booking ${plan.booking_status}`}
                          >
                            {bookingStatusLabel(plan.booking_status)}
                          </span>
                        </div>
                        <p className='meta-line'>
                          {formatDayLabel(plan.local_date, timezone)} ·{' '}
                          {plan.start_time.slice(0, 5)}
                          {plan.end_time ? `–${plan.end_time.slice(0, 5)}` : ''}
                        </p>
                        {plan.location ? (
                          <p className='meta-line'>
                            <MapPin size={16} /> {plan.location}
                          </p>
                        ) : null}
                        {plan.notes ? (
                          <details className='notes'>
                            <summary>Notas</summary>
                            <p>{plan.notes}</p>
                          </details>
                        ) : null}
                        {plan.dirty ? (
                          <p className='helper'>Pendiente de sincronizar</p>
                        ) : null}
                      </div>
                      <div className='card-actions'>
                        <button
                          className='icon-button'
                          onClick={() => onEdit(plan)}
                          aria-label={`Gestionar ${plan.title}`}
                        >
                          <PencilSimple size={20} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )
        )
      )}
    </section>
  )
}

function groupByDay(plans: LocalPlan[]) {
  const groups = new Map<string, LocalPlan[]>()
  plans.forEach((plan) => {
    const current = groups.get(plan.local_date) ?? []
    current.push(plan)
    groups.set(plan.local_date, current)
  })
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function syncLabel(state: SyncState, pending: number) {
  if (state === 'syncing') return 'Sincronizando'
  if (state === 'offline') return 'Offline'
  if (pending) return `${pending} pendiente${pending === 1 ? '' : 's'}`
  if (state === 'error') return 'Reintentar'
  return 'Al día'
}

function readInviteToken() {
  const hash = window.location.hash
  if (!hash.startsWith('#join=')) return ''
  return decodeURIComponent(hash.slice(6))
}
