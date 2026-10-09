import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { DateTime } from 'luxon'
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
  Link,
  MapPin,
  PencilSimple,
  Plus,
  ShareNetwork,
  Ticket,
  Trash,
  Warning
} from '@phosphor-icons/react'
import { JoinScreen } from './components/JoinScreen'
import { Onboarding } from './components/Onboarding'
import { PlanSheet } from './components/PlanSheet'
import { deleteLocalPlan, getMeta, saveLocalPlan, setMeta } from './lib/db'
import { enableNotifications, notificationSupport } from './lib/notifications'
import { bookingStatusLabel, planStatusLabel } from './lib/planLabels'
import { ensureUser } from './lib/convexClient'
import { useDialogFocus } from './lib/useDialogFocus'
import {
  createTrip,
  fetchInviteCode,
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

const CsvImporter = lazy(() =>
  import('./components/CsvImporter').then(({ CsvImporter }) => ({
    default: CsvImporter
  }))
)

type Mode = 'loading' | 'onboarding' | 'invite' | 'trip'
type MainView = 'itinerary' | 'reservations'
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

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
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent>()
  const [tick, setTick] = useState(0)
  const [openDays, setOpenDays] = useState<ReadonlySet<string>>(new Set())
  const [pastOpen, setPastOpen] = useState(false)
  const [focusDay, setFocusDay] = useState('')
  const [updateReady, setUpdateReady] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const settingsDialogRef = useDialogFocus<HTMLElement>(settingsOpen)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [view])

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
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const onAppInstalled = () => setInstallPrompt(undefined)
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

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
    if (!('serviceWorker' in navigator)) return
    if (!navigator.serviceWorker.controller) return
    const onControllerChange = () => setUpdateReady(true)
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange
    )
    const checkUpdate = () =>
      void navigator.serviceWorker.ready.then((reg) => reg.update())
    void checkUpdate()
    const interval = window.setInterval(checkUpdate, 30 * 60_000)
    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange
      )
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!tripId || mode !== 'trip') return
    const subscription = subscribeToPlans(tripId, () => void runSync(tripId))
    return () => {
      subscription.unsubscribe()
    }
  }, [mode, runSync, tripId])

  useEffect(() => {
    if (!settingsOpen || !trip) return
    fetchInviteCode(trip.id)
      .then(setInviteCode)
      .catch(() => setInviteCode(''))
  }, [settingsOpen, trip])

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

  function handleJoinByCode(value: string) {
    const token = extractInviteToken(value)
    if (!token) {
      setFormError('Pega un enlace o código de invitación válido.')
      return
    }
    setFormError('')
    setInviteToken(token)
    setMode('invite')
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

  async function updatePlanFields(
    plan: LocalPlan,
    changes: Partial<Pick<PlanInput, 'status' | 'booking_status'>>
  ) {
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
        status: plan.status,
        booking_status: plan.booking_status,
        travel_minutes: plan.travel_minutes,
        buffer_minutes: plan.buffer_minutes,
        reminder_minutes: plan.reminder_minutes,
        ...changes
      },
      trip.timezone,
      plan
    )
    await refreshLocal()
    void runSync()
  }

  async function updatePlanStatus(plan: LocalPlan, status: PlanStatus) {
    await updatePlanFields(plan, { status })
  }

  async function updateBookingStatus(
    plan: LocalPlan,
    booking_status: PlanInput['booking_status']
  ) {
    await updatePlanFields(plan, { booking_status })
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

  async function copyInviteCode() {
    if (!inviteCode) return
    await navigator.clipboard.writeText(formatInviteCode(inviteCode))
    setNotice('Código copiado.')
  }

  async function rotateInvite() {
    if (
      !trip ||
      !window.confirm(
        'El enlace y código anteriores dejarán de aceptar nuevos dispositivos. ¿Regenerarlos?'
      )
    )
      return
    const result = await regenerateInvite(trip.id)
    setInviteCode(result.inviteCode)
    const url = `${location.origin}/#join=${result.inviteToken}`
    await navigator.clipboard.writeText(url)
    setNotice('Nuevo enlace y código. Los anteriores quedaron revocados.')
  }

  async function installApp() {
    if (!installPrompt) return
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      setInstallPrompt(undefined)
      if (choice.outcome === 'accepted') setNotice('Ulala quedó instalada.')
    } catch {
      setNotice(
        'No se pudo abrir la instalación. Prueba desde el menú del navegador.'
      )
    }
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
  const today = DateTime.now()
    .setZone(trip?.timezone ?? 'UTC')
    .toISODate()!
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
  const activeDate = activePlan?.local_date
  const pastDays = grouped.filter(([date]) => date < today)
  const upcomingDays = grouped.filter(([date]) => date >= today)

  useEffect(() => {
    if (!focusDay) return
    document
      .getElementById(`day-${focusDay}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focusDay, openDays, pastOpen])

  function revealDay(date: string) {
    if (date < today) {
      setPastOpen(true)
    } else if (date !== today && date !== activeDate) {
      setOpenDays((current) => new Set(current).add(date))
    }
    setFocusDay(date)
  }

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
        onJoinInvite={handleJoinByCode}
        loading={busy}
        error={formError || syncMessage}
      />
    )
  }

  const renderDayPlans = (dayPlans: LocalPlan[]) => (
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
          onStatusChange={(status) => void updatePlanStatus(plan, status)}
        />
      ))}
    </div>
  )

  const renderQuickActions = (className: string) => (
    <nav className={className} aria-label='Acciones principales'>
      <button
        className='primary-button'
        type='button'
        onClick={() => {
          setEditing(undefined)
          setSheetOpen(true)
        }}
      >
        <span className='quick-action-label'>
          <Plus size={19} /> Plan
        </span>
      </button>
      <button
        className={
          view === 'reservations' ? 'primary-button' : 'secondary-button'
        }
        type='button'
        aria-label={`Reservas${reservationPendingCount ? `, ${reservationPendingCount} pendientes` : ''}`}
        aria-pressed={view === 'reservations'}
        onClick={() =>
          setView(view === 'reservations' ? 'itinerary' : 'reservations')
        }
      >
        <span className='quick-action-label'>
          <Ticket size={19} /> Reservas
        </span>
        {reservationPendingCount > 0 ? (
          <span className='quick-action-count' aria-hidden='true'>
            {reservationPendingCount}
          </span>
        ) : null}
      </button>
      <button
        className='secondary-button'
        type='button'
        onClick={() => setSettingsOpen(true)}
      >
        <span className='quick-action-label'>
          <ShareNetwork size={19} /> Viaje
        </span>
      </button>
    </nav>
  )

  return (
    <main className='app-shell'>
      <a
        className='skip-link'
        href={
          view === 'reservations' ? '#reservations-title' : '#timeline-title'
        }
      >
        Saltar al contenido
      </a>
      <header className='app-header'>
        <div>
          <h1>{trip.name}</h1>
        </div>
        <button
          className={`sync-pill ${syncState}`}
          type='button'
          onClick={() => void runSync()}
          title={syncMessage || 'Sincronizar ahora'}
          aria-label={`Sincronización: ${syncLabel(syncState, pendingCount)}. Toca para sincronizar.`}
        >
          <CloudArrowUp
            size={18}
            weight={syncState === 'syncing' ? 'fill' : 'regular'}
          />
          {syncLabel(syncState, pendingCount)}
        </button>
      </header>

      <div className='app-scroll' ref={scrollRef}>
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
              <h2 id='next-title'>
                {activePlan?.status === 'idea'
                  ? 'Siguiente opción · aún sin confirmar'
                  : 'Próximo compromiso'}
              </h2>
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
                    <a
                      className='meta-line location-link'
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activePlan.location)}`}
                      target='_blank'
                      rel='noreferrer'
                    >
                      <MapPin size={17} /> {activePlan.location}
                    </a>
                  ) : null}
                  {activePlan.notes ? (
                    <details className='notes next-notes'>
                      <summary>Notas y detalles</summary>
                      <p>{activePlan.notes}</p>
                    </details>
                  ) : null}
                </div>
                <div className='leave-box'>
                  <span>{relativeTiming(activePlan, trip.timezone)}</span>
                  {activePlan.travel_minutes + activePlan.buffer_minutes > 0 ? (
                    <>
                      <strong>
                        {relativeTiming(activePlan, trip.timezone) === 'Sal ya'
                          ? 'Salir ahora'
                          : `Salir ${utcToTripTime(
                              leaveAtIso(activePlan),
                              trip.timezone
                            ).toFormat('HH:mm')}`}
                      </strong>
                      <small>
                        {activePlan.travel_minutes > 0
                          ? `${activePlan.travel_minutes} min de traslado`
                          : ''}
                        {activePlan.travel_minutes > 0 &&
                        activePlan.buffer_minutes > 0
                          ? ' + '
                          : ''}
                        {activePlan.buffer_minutes > 0
                          ? `${activePlan.buffer_minutes} min de margen`
                          : ''}
                      </small>
                    </>
                  ) : (
                    <strong>
                      {formatPlanTime(activePlan, trip.timezone)} · hora del
                      plan
                    </strong>
                  )}
                </div>
                <div className='next-actions'>
                  {activePlan.status === 'confirmed' ? (
                    <button
                      className='next-action primary'
                      type='button'
                      title='Marcar como realizado'
                      onClick={() => void updatePlanStatus(activePlan, 'done')}
                    >
                      <FlagCheckered size={17} weight='fill' /> Marcar hecho
                    </button>
                  ) : (
                    <button
                      className='next-action primary'
                      type='button'
                      title='Convertir la idea en un compromiso del viaje'
                      onClick={() =>
                        void updatePlanStatus(activePlan, 'confirmed')
                      }
                    >
                      <CheckCircle size={17} /> Confirmar plan
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
                  {activePlan.status === 'confirmed' ? (
                    <button
                      className='next-action quiet'
                      type='button'
                      title='Quita la confirmación: el plan vuelve a ser una propuesta opcional'
                      onClick={() => void updatePlanStatus(activePlan, 'idea')}
                    >
                      <Circle size={17} /> Volver a idea
                    </button>
                  ) : null}
                </div>
              </article>
            ) : (
              <div className='empty-state'>
                <h3>Sin planes pendientes</h3>
                <p>Añade un plan o importa el itinerario desde CSV.</p>
                <div className='inline-actions empty-actions'>
                  <button
                    className='primary-button'
                    type='button'
                    onClick={() => {
                      setEditing(undefined)
                      setSheetOpen(true)
                    }}
                  >
                    <Plus size={18} /> Añadir plan
                  </button>
                  <button
                    className='secondary-button'
                    type='button'
                    onClick={() => setCsvOpen(true)}
                  >
                    <FileCsv size={18} /> Importar CSV
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {renderQuickActions('quick-actions inline-nav')}

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
            onBookingChange={updateBookingStatus}
            onEdit={(plan) => {
              setEditing(plan)
              setSheetOpen(true)
            }}
          />
        ) : (
          <section className='timeline' aria-labelledby='timeline-title'>
            <div className='section-title'>
              <h2 id='timeline-title' tabIndex={-1}>
                Día por día
              </h2>
            </div>
            {grouped.length ? (
              <>
                <DayNav
                  days={grouped}
                  today={today}
                  activeDate={activeDate}
                  timezone={trip.timezone}
                  onSelect={revealDay}
                />
                {pastDays.length ? (
                  <details
                    className='past-days'
                    open={pastOpen}
                    onToggle={(event) => setPastOpen(event.currentTarget.open)}
                  >
                    <summary>
                      <span>Días anteriores</span>
                      <small>
                        {pastDays.length}{' '}
                        {pastDays.length === 1 ? 'día' : 'días'}
                      </small>
                    </summary>
                    {pastDays.map(([date, dayPlans]) => (
                      <section
                        className='day-group past'
                        id={`day-${date}`}
                        key={date}
                      >
                        <h3>{formatDayLabel(date, trip.timezone)}</h3>
                        {renderDayPlans(dayPlans)}
                      </section>
                    ))}
                  </details>
                ) : null}
                {upcomingDays.map(([date, dayPlans]) => {
                  const title = formatDayLabel(date, trip.timezone)
                  const expanded = date === today || date === activeDate
                  const count = `${dayPlans.length} ${dayPlans.length === 1 ? 'plan' : 'planes'}`
                  return expanded ? (
                    <section
                      className='day-group'
                      id={`day-${date}`}
                      key={date}
                    >
                      <h3>{title}</h3>
                      {renderDayPlans(dayPlans)}
                    </section>
                  ) : (
                    <details
                      className='day-group collapsed-day'
                      id={`day-${date}`}
                      key={date}
                      open={openDays.has(date)}
                      onToggle={(event) => {
                        const open = event.currentTarget.open
                        setOpenDays((current) => {
                          const next = new Set(current)
                          if (open) next.add(date)
                          else next.delete(date)
                          return next
                        })
                      }}
                    >
                      <summary>
                        <span>{title}</span>
                        <small>{count}</small>
                      </summary>
                      {renderDayPlans(dayPlans)}
                    </details>
                  )
                })}
              </>
            ) : (
              <div className='empty-state'>
                <h3>Todavía no hay planes</h3>
                <p>Crea uno manualmente o importa filas desde un CSV.</p>
                <button
                  className='secondary-button'
                  type='button'
                  onClick={() => setCsvOpen(true)}
                >
                  <FileCsv size={18} /> Importar CSV
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {renderQuickActions('quick-actions tab-nav')}

      {updateReady ? (
        <div className='update-toast' role='status'>
          <span>Nueva versión lista</span>
          <button
            className='primary-button'
            type='button'
            onClick={() => window.location.reload()}
          >
            Actualizar
          </button>
        </div>
      ) : null}

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
        <Suspense
          fallback={
            <p className='notice' role='status'>
              Abriendo importador…
            </p>
          }
        >
          <CsvImporter
            existingPlans={plans}
            onClose={() => setCsvOpen(false)}
            onImport={importPlans}
          />
        </Suspense>
      ) : null}
      {settingsOpen ? (
        <div
          className='sheet-backdrop'
          role='presentation'
          onMouseDown={(event) =>
            event.target === event.currentTarget && setSettingsOpen(false)
          }
          onKeyDown={(event) =>
            event.key === 'Escape' && setSettingsOpen(false)
          }
        >
          <section
            ref={settingsDialogRef}
            className='sheet'
            role='dialog'
            aria-modal='true'
            aria-labelledby='trip-settings-title'
          >
            <header className='sheet-header'>
              <div>
                <h2 id='trip-settings-title'>Ajustes del viaje</h2>
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
            <div className='stack sheet-body'>
              <section className='settings-block'>
                <h3>Instalar Ulala</h3>
                {installPrompt ? (
                  <button
                    className='secondary-button'
                    type='button'
                    onClick={() => void installApp()}
                  >
                    Instalar app
                  </button>
                ) : support.isIos && !support.isStandalone ? (
                  <p>
                    En iPhone o iPad: Compartir → “Añadir a pantalla de inicio”.
                  </p>
                ) : support.isStandalone ? (
                  <p className='helper'>
                    Ulala está abierta como app instalada.
                  </p>
                ) : (
                  <p>
                    Si el navegador lo permite, instala Ulala desde su menú para
                    abrirla como app.
                  </p>
                )}
              </section>
              <section className='settings-block'>
                <h3>Importar itinerario</h3>
                <p>Añade o actualiza planes desde una hoja de cálculo CSV.</p>
                <button
                  className='secondary-button'
                  type='button'
                  onClick={() => {
                    setSettingsOpen(false)
                    setCsvOpen(true)
                  }}
                >
                  <FileCsv size={18} /> Importar CSV
                </button>
              </section>
              <section className='settings-block'>
                <h3>Invitar a este viaje</h3>
                <p>
                  Comparte el código corto para entrar desde la app, o el enlace
                  para quien no la tenga instalada. Regenerar bloquea ambos.
                </p>
                {inviteCode ? (
                  <p className='invite-code'>
                    Código: <strong>{formatInviteCode(inviteCode)}</strong>
                  </p>
                ) : null}
                <div className='inline-actions'>
                  <button
                    className='primary-button'
                    onClick={() => void copyInviteCode()}
                    disabled={!inviteCode}
                  >
                    <Copy size={18} /> Copiar código
                  </button>
                  <button
                    className='secondary-button'
                    onClick={() => void copyInvite()}
                  >
                    <Link size={18} /> Copiar enlace
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
                <h3>Unirse a otro viaje</h3>
                <p>
                  Escribe el código corto o pega el enlace de invitación. El
                  viaje actual queda guardado; para volver necesitarás su
                  enlace.
                </p>
                <div className='join-inline'>
                  <label>
                    <span className='sr-only'>
                      Código o enlace de invitación
                    </span>
                    <input
                      value={joinCode}
                      onChange={(event) => setJoinCode(event.target.value)}
                      placeholder='Código o enlace'
                      autoComplete='off'
                    />
                  </label>
                  <button
                    className='secondary-button'
                    type='button'
                    disabled={!joinCode.trim()}
                    onClick={() => {
                      setSettingsOpen(false)
                      setJoinCode('')
                      handleJoinByCode(joinCode)
                    }}
                  >
                    Unirme
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
          <span className={`dot ${plan.status}`} aria-hidden='true' />
        </div>
        <div className='plan-flags'>
          {plan.status === 'idea' ? (
            <span className='flag idea'>Idea</span>
          ) : null}
          {plan.status === 'confirmed' ? (
            <span className='flag confirmed'>Confirmado</span>
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
          <a
            className='meta-line location-link'
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(plan.location)}`}
            target='_blank'
            rel='noreferrer'
          >
            <MapPin size={16} /> {plan.location}
          </a>
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
  onBookingChange,
  onEdit
}: {
  plans: LocalPlan[]
  timezone: string
  onBookingChange: (
    plan: LocalPlan,
    status: PlanInput['booking_status']
  ) => void
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
  const initialOpenGroup = groups.find((group) => group.items.length > 0)?.key
  const [expandedGroup, setExpandedGroup] = useState<
    string | null | undefined
  >()
  const openGroupKey =
    expandedGroup === undefined ? initialOpenGroup : expandedGroup

  function changeBookingStatus(
    plan: LocalPlan,
    status: PlanInput['booking_status']
  ) {
    const group = RESERVATION_GROUPS.find((candidate) =>
      candidate.match({ ...plan, booking_status: status })
    )
    setExpandedGroup(group?.key ?? null)
    void onBookingChange(plan, status)
  }

  return (
    <section className='reservations' aria-labelledby='reservations-title'>
      <div className='section-title'>
        <h2 id='reservations-title' tabIndex={-1}>
          Reservas
        </h2>
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
              <details
                className={`reservation-group ${group.key}`}
                key={group.key}
                open={openGroupKey === group.key}
                onToggle={(event) => {
                  if (event.currentTarget.open) setExpandedGroup(group.key)
                  else if (openGroupKey === group.key) setExpandedGroup(null)
                }}
              >
                <summary>
                  {group.title}
                  <span className='count'>{group.items.length}</span>
                </summary>
                <div className='reservation-items'>
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
                              aria-hidden='true'
                            />
                          </div>
                          <div className='plan-flags'>
                            {plan.status === 'idea' ? (
                              <span className='flag idea'>Idea</span>
                            ) : null}
                            {plan.status === 'confirmed' ? (
                              <span className='flag confirmed'>Confirmado</span>
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
                            {plan.end_time
                              ? `–${plan.end_time.slice(0, 5)}`
                              : ''}
                          </p>
                          {plan.location ? (
                            <a
                              className='meta-line location-link'
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(plan.location)}`}
                              target='_blank'
                              rel='noreferrer'
                            >
                              <MapPin size={16} /> {plan.location}
                            </a>
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
                        <div className='reservation-actions'>
                          <label className='booking-control'>
                            <span className='sr-only'>
                              Estado de reserva para {plan.title}
                            </span>
                            <select
                              value={plan.booking_status}
                              onChange={(event) =>
                                changeBookingStatus(
                                  plan,
                                  event.target
                                    .value as PlanInput['booking_status']
                                )
                              }
                            >
                              <option value='none'>Por decidir</option>
                              <option value='not_required'>
                                No hace falta
                              </option>
                              <option value='recommended'>Recomendada</option>
                              <option value='required'>Por reservar</option>
                              <option value='booked'>Reservada</option>
                            </select>
                          </label>
                          <button
                            className='icon-button'
                            onClick={() => onEdit(plan)}
                            aria-label={`Editar ${plan.title}`}
                          >
                            <PencilSimple size={20} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </details>
            )
        )
      )}
    </section>
  )
}

function DayNav({
  days,
  today,
  activeDate,
  timezone,
  onSelect
}: {
  days: [string, LocalPlan[]][]
  today: string
  activeDate?: string
  timezone: string
  onSelect: (date: string) => void
}) {
  const currentRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [])
  const dates = new Set(days.map(([date]) => date))
  const focusDate = dates.has(today)
    ? today
    : activeDate && dates.has(activeDate)
      ? activeDate
      : undefined
  return (
    <div className='day-nav' role='group' aria-label='Días del viaje'>
      {days.map(([date, dayPlans]) => {
        const day = DateTime.fromISO(date, { zone: timezone }).setLocale('es')
        const isToday = date === today
        return (
          <button
            key={date}
            ref={date === focusDate ? currentRef : undefined}
            type='button'
            className={`day-chip${date < today ? ' past' : ''}${isToday ? ' today' : ''}${date === activeDate ? ' next' : ''}`}
            aria-label={formatDayLabel(date, timezone)}
            aria-current={isToday ? 'date' : undefined}
            onClick={() => onSelect(date)}
          >
            <span className='day-chip-dow'>{day.weekdayShort}</span>
            <span className='day-chip-num'>{day.toFormat('d')}</span>
            {dayPlans.some((plan) => plan.status === 'confirmed') ? (
              <span className='day-chip-dot' aria-hidden='true' />
            ) : null}
          </button>
        )
      })}
    </div>
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
  if (pending) return `${pending} sin sincronizar`
  if (state === 'offline') return 'Sin conexión'
  if (state === 'error') return 'Reintentar'
  return 'Al día'
}

function readInviteToken() {
  const hash = window.location.hash
  if (!hash.startsWith('#join=')) return ''
  return decodeURIComponent(hash.slice(6))
}

function extractInviteToken(value: string) {
  const match = value.match(/join=([^\s&#]+)/)
  return decodeURIComponent(match?.[1] ?? value.trim())
}

function formatInviteCode(code: string) {
  return code.replace(/(.{4})(?=.)/g, '$1-')
}
