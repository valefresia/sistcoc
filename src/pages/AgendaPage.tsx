import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { hasClinicAdministrationAccess, useAuth } from '../auth/auth-context'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import { WhatsAppReminderLink } from '../components/PatientWorkspaceSections'
import {
  dateKeyFromDate,
  formatDateKey,
  getAvailableSlots,
  isValidTime,
  minutesFromTime,
  shiftDateKey,
  startOfWeek,
  validateClinicIntervals,
  zonedDateTimeToDate,
  defaultSchedule,
  type AgendaAppointment,
  type AgendaBlock,
  type ScheduleConfig,
  type ScheduleException,
  type TimeInterval,
} from '../lib/schedule-logic'
import {
  createScheduleBlock,
  fetchAgendaData,
  fetchProfessionalProfiles,
  OverlappingScheduleBlockError,
  removeScheduleBlock,
  saveSchedule,
  ScheduleBlockAppointmentConflictError,
  type ProfessionalProfile,
} from '../lib/schedules'
import {
  createAppointment,
  getAppointmentDetails,
  transitionAppointment,
  updateAppointment,
  type AppointmentPageData,
} from '../lib/appointments'
import { searchPatients, type Patient } from '../lib/patients'
import { firebaseOperationError } from '../lib/firebase-errors'
import {
  AppointmentBlockOverlapError,
  AppointmentOverlapError,
  AppointmentValidationError,
  InvalidAppointmentStatusError,
  type AppointmentData,
  type AppointmentInput,
} from '../lib/appointment-logic'

type CalendarView = 'day' | 'week' | 'month'
const weekdayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const noSchedules: Record<string, ScheduleConfig> = {}

export function AgendaPage() {
  const { dentistId, role, user } = useAuth()
  const isAdmin = hasClinicAdministrationAccess(role, dentistId)
  const [profiles, setProfiles] = useState<ProfessionalProfile[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [date, setDate] = useState(() => dateKeyFromDate(new Date()))
  const [view, setView] = useState<CalendarView>('week')
  const [agenda, setAgenda] = useState<{
    schedules: Record<string, ScheduleConfig>
    appointments: AgendaAppointment[]
    blocks: AgendaBlock[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [activePanel, setActivePanel] = useState<'schedule' | 'block' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [appointmentForm, setAppointmentForm] = useState<{
    profile: ProfessionalProfile
    appointment?: AppointmentData
  } | null>(null)
  const [appointmentDetails, setAppointmentDetails] = useState<AppointmentPageData | null>(null)
  const [appointmentDetailsLoading, setAppointmentDetailsLoading] = useState(false)
  const [appointmentBusy, setAppointmentBusy] = useState(false)
  const [appointmentError, setAppointmentError] = useState<string | null>(null)

  const range = useMemo(() => getCalendarRange(date, view), [date, view])
  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => selectedIds.includes(profile.dentistId)),
    [profiles, selectedIds],
  )

  const reload = useCallback(() => {
    setLoading(true)
    setAgenda(null)
    setError(null)
    setRefreshKey((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!user || !dentistId || !role) return
    let active = true
    void fetchProfessionalProfiles(isAdmin, dentistId, user.uid)
      .then((loadedProfiles) => {
        if (!active) return
        setProfiles(loadedProfiles)
        setSelectedIds((current) => {
          if (current.length > 0) {
            return current.filter((id) =>
              loadedProfiles.some((profile) => profile.dentistId === id),
            )
          }
          return loadedProfiles.map((profile) => profile.dentistId)
        })
      })
      .catch((caught: unknown) => {
        if (active) setError(agendaError(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [dentistId, isAdmin, role, user, refreshKey])

  useEffect(() => {
    if (visibleProfiles.length === 0) return
    let active = true
    void fetchAgendaData(visibleProfiles, range.start, range.end)
      .then((result) => {
        if (active) setAgenda(result)
      })
      .catch((caught: unknown) => {
        if (active) setError(agendaError(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [visibleProfiles, range.start, range.end, refreshKey])

  function moveDate(direction: number) {
    setAgenda(null)
    setError(null)
    if (view === 'day') setDate((current) => shiftDateKey(current, direction))
    else if (view === 'week') setDate((current) => shiftDateKey(current, direction * 7))
    else {
      setDate((current) => {
        const [year, month] = current.split('-').map(Number)
        const next = new Date(Date.UTC(year, month - 1 + direction, 1, 12))
        return next.toISOString().slice(0, 10)
      })
    }
  }

  function toggleProfessional(id: string) {
    setAgenda(null)
    setError(null)
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    )
    setNotice(null)
  }

  async function handleRemoveBlock(blockId: string) {
    setNotice(null)
    try {
      await removeScheduleBlock(blockId)
      setNotice('Bloqueo eliminado correctamente.')
      reload()
    } catch (caught) {
      setError(agendaError(caught))
    }
  }

  async function openAppointmentDetails(appointmentId: string) {
    setAppointmentError(null)
    setAppointmentDetails(null)
    setAppointmentDetailsLoading(true)
    try {
      const details = await getAppointmentDetails(appointmentId, profiles)
      if (!details) throw new Error('No encontramos el turno solicitado.')
      setAppointmentDetails(details)
    } catch (caught) {
      setAppointmentError(appointmentErrorMessage(caught))
    } finally {
      setAppointmentDetailsLoading(false)
    }
  }

  async function handleAppointmentTransition(status: 'confirmed' | 'cancelled') {
    if (!appointmentDetails || !user) return
    if (status === 'cancelled' && !window.confirm('¿Querés cancelar este turno? Esta acción no se puede deshacer.')) {
      return
    }
    setAppointmentBusy(true)
    setAppointmentError(null)
    try {
      await transitionAppointment(appointmentDetails.appointment.id, status, user.uid)
      await openAppointmentDetails(appointmentDetails.appointment.id)
      setNotice(status === 'confirmed' ? 'El turno quedó confirmado.' : 'El turno fue cancelado.')
      reload()
    } catch (caught) {
      setAppointmentError(appointmentErrorMessage(caught))
    } finally {
      setAppointmentBusy(false)
    }
  }

  return (
    <WorkspaceLayout title="Agenda general">
      <section className="agenda-content">
        <div className="patients-page-header agenda-heading">
          <div>
            <p className="eyebrow">ORGANIZACIÓN DEL CENTRO</p>
            <h1>Agenda general</h1>
            <p>Consultá la disponibilidad y los turnos de los tres profesionales.</p>
          </div>
          {isAdmin && (
            <div className="agenda-admin-actions">
              <button
                className="button button-secondary"
                onClick={() => setActivePanel(activePanel === 'schedule' ? null : 'schedule')}
                type="button"
              >
                <Settings2 size={17} /> Configurar horarios
              </button>
              <button
                className="button button-primary"
                onClick={() => setActivePanel(activePanel === 'block' ? null : 'block')}
                type="button"
              >
                <LockKeyhole size={16} /> Bloquear horario
              </button>
            </div>
          )}
          <button
            className="button button-primary"
            disabled={profiles.length === 0}
            onClick={() => {
              const profile = profiles.find((item) => item.dentistId === dentistId) ?? profiles[0]
              if (profile) {
                setAppointmentError(null)
                setAppointmentForm({ profile })
              }
            }}
            type="button"
          >
            <Plus size={16} /> Nuevo turno
          </button>
        </div>

        {notice && <div className="patient-notice patient-notice-success" role="status">{notice}</div>}
        {error && (
          <div className="patient-notice patient-notice-error" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={reload} type="button">Intentar nuevamente</button>
          </div>
        )}

        {activePanel === 'schedule' && isAdmin && (
          <ScheduleSettings
            profiles={profiles}
            schedules={agenda?.schedules ?? noSchedules}
            updatedBy={user?.uid ?? ''}
            onSaved={() => {
              setActivePanel(null)
              setNotice('La configuración de horarios se guardó correctamente.')
              reload()
            }}
            onCancel={() => setActivePanel(null)}
          />
        )}
        {activePanel === 'block' && isAdmin && (
          <ScheduleBlockForm
            profiles={profiles}
            agenda={agenda}
            createdBy={user?.uid ?? ''}
            onSaved={() => {
              setActivePanel(null)
              setNotice('El bloqueo de agenda se guardó correctamente.')
              reload()
            }}
            onCancel={() => setActivePanel(null)}
          />
        )}

        <section className="agenda-card">
          <div className="agenda-toolbar">
            <div className="agenda-date-controls">
              <button aria-label="Actualizar agenda" className="agenda-icon-button" onClick={reload} type="button">
                <RefreshCw size={15} />
              </button>
              <button aria-label="Período anterior" className="agenda-icon-button" onClick={() => moveDate(-1)} type="button">
                <ArrowLeft size={17} />
              </button>
              <button className="button button-secondary agenda-today" onClick={() => {
                setAgenda(null)
                setError(null)
                setDate(dateKeyFromDate(new Date()))
              }} type="button">
                Hoy
              </button>
              <button aria-label="Período siguiente" className="agenda-icon-button" onClick={() => moveDate(1)} type="button">
                <ArrowRight size={17} />
              </button>
              <strong>{range.label}</strong>
            </div>
            <div aria-label="Vista de calendario" className="agenda-view-switch" role="group">
              {(['day', 'week', 'month'] as const).map((calendarView) => (
                <button
                  aria-pressed={view === calendarView}
                  className={view === calendarView ? 'agenda-view-active' : ''}
                  key={calendarView}
                  onClick={() => {
                    setAgenda(null)
                    setError(null)
                    setView(calendarView)
                  }}
                  type="button"
                >
                  {calendarView === 'day' ? 'Día' : calendarView === 'week' ? 'Semana' : 'Mes'}
                </button>
              ))}
            </div>
          </div>

          <div className="agenda-professional-filters">
              <span>Profesionales</span>
              {profiles.map((profile) => (
                <label className={`agenda-filter agenda-filter-${profile.color}`} key={profile.dentistId}>
                  <input
                    checked={selectedIds.includes(profile.dentistId)}
                    onChange={() => toggleProfessional(profile.dentistId)}
                    type="checkbox"
                  />
                  <span>{profile.name}</span>
                </label>
              ))}
          </div>

          {loading && (
            <div className="patient-state" aria-live="polite">
              <LoaderCircle className="spin" size={22} /> Cargando agenda...
            </div>
          )}
          {!loading && !error && visibleProfiles.length === 0 && (
            <div className="patient-state">
              <CalendarDays size={23} />
              <strong>Seleccioná al menos un profesional</strong>
              <span>La agenda no muestra datos hasta elegir una agenda.</span>
            </div>
          )}
          {!loading && !error && agenda === null && visibleProfiles.length > 0 && (
            <div className="patient-state" aria-live="polite">
              <LoaderCircle className="spin" size={22} /> Cargando agenda...
            </div>
          )}
          {!loading && !error && agenda && visibleProfiles.length > 0 && (
            <>
              {view === 'month' ? (
                <MonthCalendar
                  date={date}
                  profiles={visibleProfiles}
                  agenda={agenda}
                  onChooseDate={(dateKey) => {
                    setAgenda(null)
                    setError(null)
                    setDate(dateKey)
                    setView('day')
                  }}
                />
              ) : view === 'week' ? (
                <WeekCalendar
                  startDate={range.start}
                  profiles={visibleProfiles}
                  agenda={agenda}
                  onChooseDate={(dateKey) => {
                    setAgenda(null)
                    setError(null)
                    setDate(dateKey)
                    setView('day')
                  }}
                />
              ) : (
                <DayAgenda
                  date={date}
                  profiles={visibleProfiles}
                  agenda={agenda}
                  isAdmin={isAdmin}
                  onRemoveBlock={(id) => void handleRemoveBlock(id)}
                  onOpenAppointment={(id) => void openAppointmentDetails(id)}
                />
              )}
            </>
          )}
        </section>

        <div className="agenda-legend">
          <span><i className="agenda-dot agenda-dot-available" /> Disponible</span>
          <span><i className="agenda-dot agenda-dot-appointment" /> Turno ocupado</span>
          <span><i className="agenda-dot agenda-dot-block" /> Bloqueo</span>
          <small>Zona horaria: America/Argentina/Tucuman</small>
        </div>
      </section>
      {appointmentForm && user && (
        <AppointmentForm
          profiles={profiles}
          initialProfile={appointmentForm.profile}
          initialDate={date}
          initialAppointment={appointmentForm.appointment}
          initialPatient={appointmentDetails?.patient ?? null}
          actorUid={user.uid}
          onCancel={() => setAppointmentForm(null)}
          onSaved={() => {
            setAppointmentForm(null)
            setAppointmentDetails(null)
            setNotice(appointmentForm.appointment ? 'El turno se actualizó correctamente.' : 'El turno se creó correctamente.')
            reload()
          }}
        />
      )}
      {(appointmentDetailsLoading || appointmentDetails) && !appointmentForm && (
        <AppointmentDetailsDialog
          details={appointmentDetails}
          loading={appointmentDetailsLoading}
          busy={appointmentBusy}
          error={appointmentError}
          onClose={() => {
            setAppointmentDetails(null)
            setAppointmentError(null)
          }}
          onEdit={() => {
            if (!appointmentDetails) return
            const profile = profiles.find(
              (item) => item.dentistId === appointmentDetails.appointment.dentistId,
            )
            if (profile) setAppointmentForm({ profile, appointment: appointmentDetails.appointment })
          }}
          onConfirm={() => void handleAppointmentTransition('confirmed')}
          onCancelAppointment={() => void handleAppointmentTransition('cancelled')}
        />
      )}
      {appointmentError && !appointmentDetails && !appointmentDetailsLoading && (
        <div className="patient-notice patient-notice-error" role="alert">{appointmentError}</div>
      )}
    </WorkspaceLayout>
  )
}

function AppointmentForm({
  profiles,
  initialProfile,
  initialDate,
  initialAppointment,
  initialPatient,
  actorUid,
  onCancel,
  onSaved,
}: {
  profiles: ProfessionalProfile[]
  initialProfile: ProfessionalProfile
  initialDate: string
  initialAppointment?: AppointmentData
  initialPatient: Patient | null
  actorUid: string
  onCancel: () => void
  onSaved: () => void
}) {
  const [profileId, setProfileId] = useState<string>(initialProfile.dentistId)
  const [date, setDate] = useState(initialAppointment?.date ?? initialDate)
  const [startTime, setStartTime] = useState(initialAppointment?.startTime ?? '')
  const [duration, setDuration] = useState(
    initialAppointment?.durationMinutes ?? 30,
  )
  const [reason, setReason] = useState(initialAppointment?.reason ?? '')
  const [notes, setNotes] = useState(initialAppointment?.notes ?? '')
  const [patientSearch, setPatientSearch] = useState(
    initialPatient ? `${initialPatient.firstName} ${initialPatient.lastName}` : '',
  )
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(initialPatient)
  const [patientMatches, setPatientMatches] = useState<Patient[]>(initialPatient ? [initialPatient] : [])
  const [searchingPatients, setSearchingPatients] = useState(false)
  const [dayData, setDayData] = useState<Awaited<ReturnType<typeof fetchAgendaData>> | null>(null)
  const [loadingDay, setLoadingDay] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const profile = profiles.find((item) => item.dentistId === profileId) ?? initialProfile

  useEffect(() => {
    let active = true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return () => {
        active = false
      }
    }
    void fetchAgendaData([profile], date, shiftDateKey(date, 1))
      .then((data) => {
        if (active) setDayData(data)
      })
      .catch((caught: unknown) => {
        if (active) setError(appointmentErrorMessage(caught))
      })
      .finally(() => {
        if (active) setLoadingDay(false)
      })
    return () => {
      active = false
    }
  }, [date, profile])

  useEffect(() => {
    const term = patientSearch.trim()
    if (selectedPatient && term === `${selectedPatient.firstName} ${selectedPatient.lastName}`) return
    if (term.length < 2) {
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      setSearchingPatients(true)
      void searchPatients(term)
        .then((matches) => {
          if (active) setPatientMatches(matches)
        })
        .catch((caught: unknown) => {
          if (active) setError(firebaseOperationError(caught, 'Buscar pacientes'))
        })
        .finally(() => {
          if (active) setSearchingPatients(false)
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [patientSearch, selectedPatient])

  const schedule = dayData?.schedules[profile.dentistId] ??
    defaultSchedule(profile.dentistId, profile.uid)
  const durationOptions = [...new Set([
    30,
    ...(initialAppointment && initialAppointment.durationMinutes !== 30
      ? [initialAppointment.durationMinutes]
      : []),
  ])].sort((a, b) => a - b)
  const appointments = (dayData?.appointments ?? []).filter(
    (appointment) => appointment.id !== initialAppointment?.id,
  )
  const availableSlots = dayData
    ? getAvailableSlots(
        date,
        { ...schedule, defaultDurationMinutes: duration },
        appointments,
        dayData.blocks,
      ).filter((slot) => slot.available)
    : []

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPatient) {
      setError('Elegí un paciente existente de la lista.')
      return
    }
    const preservingLegacySlot = Boolean(
      initialAppointment &&
        initialAppointment.date === date &&
        initialAppointment.startTime === startTime &&
        initialAppointment.durationMinutes === duration,
    )
    if (
      !startTime ||
      (!availableSlots.some((slot) => slot.start === startTime) && !preservingLegacySlot)
    ) {
      setError('Elegí uno de los horarios disponibles.')
      return
    }
    setBusy(true)
    setError(null)
    const input: AppointmentInput = {
      patientId: selectedPatient.id,
      dentistId: profile.dentistId,
      date,
      startTime,
      durationMinutes: duration,
      reason,
      notes,
    }
    try {
      if (initialAppointment) {
        await updateAppointment(initialAppointment.id, profile, input, actorUid)
      } else {
        await createAppointment(profile, input, actorUid)
      }
      onSaved()
    } catch (caught) {
      setError(appointmentErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="appointment-dialog-backdrop" role="presentation">
      <section aria-labelledby="appointment-form-title" aria-modal="true" className="appointment-dialog" role="dialog">
        <header className="appointment-dialog-header">
          <div>
            <p className="eyebrow">AGENDA</p>
            <h2 id="appointment-form-title">{initialAppointment ? 'Editar turno' : 'Nuevo turno'}</h2>
          </div>
          <button aria-label="Cerrar" className="agenda-icon-button" onClick={onCancel} type="button"><X size={17} /></button>
        </header>
        <form className="appointment-form" onSubmit={(event) => void submit(event)}>
          <label className="appointment-field appointment-field-wide">
            Buscar paciente existente
            <input
              autoComplete="off"
              onChange={(event) => {
                setPatientSearch(event.target.value)
                setSelectedPatient(null)
                if (event.target.value.trim().length < 2) setPatientMatches([])
                setError(null)
              }}
              placeholder="Nombre, apellido o DNI"
              value={patientSearch}
            />
            {searchingPatients && <small>Buscando pacientes…</small>}
            {!selectedPatient && patientSearch.trim().length >= 2 && patientMatches.length > 0 && (
              <span className="appointment-patient-results">
                {patientMatches.slice(0, 6).map((patient) => (
                  <button
                    key={patient.id}
                    onClick={() => {
                      setSelectedPatient(patient)
                      setPatientSearch(`${patient.firstName} ${patient.lastName}`)
                      setPatientMatches([patient])
                    }}
                    type="button"
                  >
                    {patient.firstName} {patient.lastName}
                    {patient.phone ? <small>{patient.phone}</small> : null}
                  </button>
                ))}
              </span>
            )}
            {selectedPatient && (
              <span className="appointment-selected-patient">
                Seleccionado: {selectedPatient.firstName} {selectedPatient.lastName}
                <button onClick={() => {
                  setSelectedPatient(null)
                  setPatientSearch('')
                }} type="button">Cambiar</button>
              </span>
            )}
          </label>
          <label className="appointment-field">
            Profesional
            <select
              onChange={(event) => {
                setProfileId(event.target.value)
                setStartTime('')
                setLoadingDay(true)
                setDayData(null)
              }}
              value={profileId}
            >
              {profiles.map((item) => (
                <option key={item.dentistId} value={item.dentistId}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="appointment-field">
            Fecha
            <input
              onChange={(event) => {
                setDate(event.target.value)
                setStartTime('')
                setLoadingDay(Boolean(event.target.value))
                setDayData(null)
              }}
              required
              type="date"
              value={date}
            />
          </label>
          <label className="appointment-field">
            Duración
            <select
              onChange={(event) => {
                setDuration(Number(event.target.value))
                setStartTime('')
              }}
              value={duration}
            >
              {durationOptions.map((minutes) => (
                <option key={minutes} value={minutes}>{minutes} minutos</option>
              ))}
            </select>
          </label>
          <label className="appointment-field">
            Horario disponible
            <select
              disabled={loadingDay || availableSlots.length === 0}
              onChange={(event) => setStartTime(event.target.value)}
              required
              value={startTime}
            >
              <option value="">{loadingDay ? 'Cargando disponibilidad…' : 'Elegir horario'}</option>
              {availableSlots.map((slot) => (
                <option key={slot.start} value={slot.start}>{slot.start} – {slot.end}</option>
              ))}
            </select>
            {!loadingDay && availableSlots.length === 0 && (
              <small>No hay horarios disponibles para esta fecha y duración.</small>
            )}
          </label>
          <label className="appointment-field appointment-field-wide">
            Motivo
            <input maxLength={160} onChange={(event) => setReason(event.target.value)} required value={reason} />
          </label>
          <label className="appointment-field appointment-field-wide">
            Observaciones internas (opcional)
            <textarea maxLength={1000} onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
          </label>
          {error && <p className="agenda-inline-error appointment-field-wide" role="alert">{error}</p>}
          <div className="agenda-form-actions appointment-field-wide">
            <button className="button button-secondary" disabled={busy} onClick={onCancel} type="button">Cancelar</button>
            <button className="button button-primary" disabled={busy || loadingDay} type="submit">
              {busy ? 'Guardando…' : initialAppointment ? 'Guardar cambios' : 'Crear turno pendiente'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function AppointmentDetailsDialog({
  details,
  loading,
  busy,
  error,
  onClose,
  onEdit,
  onConfirm,
  onCancelAppointment,
}: {
  details: AppointmentPageData | null
  loading: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  onEdit: () => void
  onConfirm: () => void
  onCancelAppointment: () => void
}) {
  const appointment = details?.appointment
  const canManage = Boolean(appointment && appointment.status !== 'cancelled')
  return (
    <div className="appointment-dialog-backdrop" role="presentation">
      <section aria-labelledby="appointment-detail-title" aria-modal="true" className="appointment-dialog" role="dialog">
        <header className="appointment-dialog-header">
          <div>
            <p className="eyebrow">DETALLE DEL TURNO</p>
            <h2 id="appointment-detail-title">Información de la consulta</h2>
          </div>
          <button aria-label="Cerrar" className="agenda-icon-button" onClick={onClose} type="button"><X size={17} /></button>
        </header>
        {loading && <div className="patient-state"><LoaderCircle className="spin" size={20} /> Cargando turno…</div>}
        {!loading && details && appointment && (
          <div className="appointment-detail-content">
            <dl>
              <dt>Paciente</dt>
              <dd>
                {details.patient
                  ? `${details.patient.firstName} ${details.patient.lastName}`
                  : 'Paciente no encontrado'}
                {details.patient && <Link to={`/patients/${details.patient.id}`}>Abrir ficha</Link>}
              </dd>
              <dt>Profesional</dt><dd>{details.professionalName}</dd>
              <dt>Fecha</dt><dd>{formatDateKey(appointment.date, { dateStyle: 'full' })}</dd>
              <dt>Horario</dt><dd>{appointment.startTime} – {appointmentTime(appointment.endAt)} ({appointment.durationMinutes} min)</dd>
              <dt>Estado</dt><dd><span className={`appointment-status appointment-status-${appointment.status}`}>{appointmentStatusLabel(appointment.status)}</span></dd>
              <dt>Motivo</dt><dd>{appointment.reason}</dd>
              <dt>Observaciones</dt><dd>{appointment.notes || 'Sin observaciones'}</dd>
              <dt>Creado</dt><dd>{formatDateTime(appointment.createdAt)}</dd>
              {appointment.updatedAt > appointment.createdAt && (
                <><dt>Última modificación</dt><dd>{formatDateTime(appointment.updatedAt)}</dd></>
              )}
            </dl>
            {details.patient && (
              <>
                <div className="clinical-entry-actions appointment-clinical-link">
                  <Link className="button button-primary" to={`/clinical-records/${details.patient.id}?appointmentId=${appointment.id}`}>
                    Registrar consulta / historia clínica
                  </Link>
                </div>
                <WhatsAppReminderLink
                  appointment={{ date: appointment.date, startTime: appointment.startTime }}
                  patientName={`${details.patient.firstName} ${details.patient.lastName}`}
                  phone={details.patient.phone}
                />
              </>
            )}
          </div>
        )}
        {error && <p className="agenda-inline-error" role="alert">{error}</p>}
        {appointment && (
          <div className="agenda-form-actions appointment-detail-actions">
            {canManage && (
              <>
                <button className="button button-secondary" disabled={busy} onClick={onEdit} type="button">Editar</button>
                {appointment.status === 'pending' && (
                  <button className="button button-primary" disabled={busy} onClick={onConfirm} type="button">Confirmar</button>
                )}
                <button className="button button-danger" disabled={busy} onClick={onCancelAppointment} type="button">Cancelar turno</button>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function getCalendarRange(date: string, view: CalendarView) {
  if (view === 'day') {
    return {
      start: date,
      end: shiftDateKey(date, 1),
      label: formatDateKey(date, { dateStyle: 'full' }),
    }
  }
  if (view === 'week') {
    const start = startOfWeek(date)
    const end = shiftDateKey(start, 7)
    return {
      start,
      end,
      label: `${formatDateKey(start, { day: 'numeric', month: 'short' })} – ${formatDateKey(shiftDateKey(end, -1), { day: 'numeric', month: 'short', year: 'numeric' })}`,
    }
  }
  const [year, month] = date.split('-').map(Number)
  const monthStart = new Date(Date.UTC(year, month - 1, 1, 12)).toISOString().slice(0, 10)
  const monthEnd = shiftDateKey(startOfWeek(monthStart), 42)
  const gridStart = startOfWeek(monthStart)
  return {
    start: gridStart,
    end: monthEnd,
    label: formatDateKey(monthStart, { month: 'long', year: 'numeric' }),
  }
}

function MonthCalendar({
  date,
  profiles,
  agenda,
  onChooseDate,
}: {
  date: string
  profiles: ProfessionalProfile[]
  agenda: NonNullable<AgendaPageData>
  onChooseDate: (date: string) => void
}) {
  const [year, month] = date.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1, 1, 12)).toISOString().slice(0, 10)
  const gridStart = startOfWeek(first)
  const days = Array.from({ length: 42 }, (_, index) => shiftDateKey(gridStart, index))

  return (
    <div className="agenda-month-grid">
      {weekdayNames.map((name) => <div className="agenda-month-weekday" key={name}>{name.slice(0, 3)}</div>)}
      {days.map((day) => {
        const inMonth = day.slice(0, 7) === date.slice(0, 7)
        const appointmentCount = agenda.appointments.filter(
          (item) => dateKeyFromDate(item.startAt) === day,
        ).length
        const availableCount = profiles.reduce((total, profile) => {
          const schedule = agenda.schedules[profile.dentistId]
          return total + (schedule
            ? getAvailableSlots(day, schedule, agenda.appointments, agenda.blocks)
                .filter((slot) => slot.available).length
            : 0)
        }, 0)

        return (
          <button
            className={`agenda-month-day${inMonth ? '' : ' agenda-month-day-muted'}`}
            key={day}
            onClick={() => onChooseDate(day)}
            type="button"
          >
            <strong>{Number(day.slice(-2))}</strong>
            {appointmentCount > 0 && <small>{appointmentCount} {appointmentCount === 1 ? 'turno' : 'turnos'}</small>}
            {availableCount > 0 && <small className="agenda-available-count">{availableCount} horarios libres</small>}
          </button>
        )
      })}
    </div>
  )
}

function WeekCalendar({
  startDate,
  profiles,
  agenda,
  onChooseDate,
}: {
  startDate: string
  profiles: ProfessionalProfile[]
  agenda: NonNullable<AgendaPageData>
  onChooseDate: (date: string) => void
}) {
  return (
    <div className="agenda-week-list">
      {Array.from({ length: 7 }, (_, index) => shiftDateKey(startDate, index)).map((day) => (
        <button className="agenda-week-day" key={day} onClick={() => onChooseDate(day)} type="button">
          <span className="agenda-week-date">
            <small>{formatDateKey(day, { weekday: 'short' })}</small>
            <strong>{formatDateKey(day, { day: 'numeric', month: 'short' })}</strong>
          </span>
          <span className="agenda-week-professionals">
            {profiles.map((profile) => {
              const appointments = agenda.appointments.filter(
                (item) =>
                  item.dentistId === profile.dentistId &&
                  dateKeyFromDate(item.startAt) === day,
              )
              const schedule = agenda.schedules[profile.dentistId]
              const available = schedule
                ? getAvailableSlots(day, schedule, agenda.appointments, agenda.blocks)
                    .filter((slot) => slot.available).length
                : 0
              return (
                <span className={`agenda-week-professional agenda-color-${profile.color}`} key={profile.dentistId}>
                  <b>{profile.name}</b>
                  {appointments.length} turnos · {available} disponibles
                </span>
              )
            })}
          </span>
          <ArrowRight size={16} />
        </button>
      ))}
    </div>
  )
}

function DayAgenda({
  date,
  profiles,
  agenda,
  isAdmin,
  onRemoveBlock,
  onOpenAppointment,
}: {
  date: string
  profiles: ProfessionalProfile[]
  agenda: NonNullable<AgendaPageData>
  isAdmin: boolean
  onRemoveBlock: (id: string) => void
  onOpenAppointment: (id: string) => void
}) {
  return (
    <div className="agenda-day-grid">
      {profiles.map((profile) => {
        const schedule = agenda.schedules[profile.dentistId]
        const appointments = agenda.appointments.filter(
          (item) =>
            item.dentistId === profile.dentistId &&
            dateKeyFromDate(item.startAt) === date,
        )
        const blocks = agenda.blocks.filter(
          (item) => item.dentistId === profile.dentistId && item.date === date,
        )
        const slots = schedule
          ? getAvailableSlots(date, schedule, agenda.appointments, agenda.blocks)
          : []

        return (
          <article className={`agenda-professional-card agenda-color-${profile.color}`} key={profile.dentistId}>
            <header>
              <span className="agenda-professional-mark"><UserRound size={17} /></span>
              <div><h2>{profile.name}</h2><p>{appointments.length} turnos · {slots.filter((slot) => slot.available).length} horarios disponibles</p></div>
            </header>
            {!schedule || slots.length === 0 ? (
              <p className="agenda-no-hours">Sin horarios de atención configurados para este día.</p>
            ) : (
              <div className="agenda-slot-list">
                {slots.map((slot) => (
                  <div className={`agenda-slot${slot.available ? ' agenda-slot-free' : slot.reason === 'block' ? ' agenda-slot-blocked' : ' agenda-slot-busy'}`} key={`${profile.dentistId}-${slot.start}`}>
                    <Clock3 size={14} />
                    <strong>{slot.start} – {slot.end}</strong>
                    <span>{slot.available ? 'Disponible' : slot.reason === 'block' ? 'Bloqueado' : 'Ocupado'}</span>
                  </div>
                ))}
              </div>
            )}
            {appointments.map((appointment) => (
              <AppointmentCard
                appointment={appointment}
                key={appointment.id}
                onOpen={() => onOpenAppointment(appointment.id)}
              />
            ))}
            {blocks.map((block) => (
              <div className="agenda-event agenda-event-block" key={block.id}>
                <span>{block.startTime} – {block.endTime}</span>
                <strong>{block.reason || 'Horario bloqueado'}</strong>
                {isAdmin && (
                  <button aria-label="Eliminar bloqueo" onClick={() => onRemoveBlock(block.id)} type="button">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </article>
        )
      })}
    </div>
  )
}

function AppointmentCard({
  appointment,
  onOpen,
}: {
  appointment: AgendaAppointment
  onOpen: () => void
}) {
  const start = dateKeyFromDate(appointment.startAt)
  const startTime = appointmentTime(appointment.startAt)
  const endTime = appointmentTime(appointment.endAt)
  return (
    <div className="agenda-event agenda-event-appointment">
      <span>{startTime} – {endTime}</span>
      <strong className={`appointment-status appointment-status-${appointment.status}`}>
        {appointmentStatusLabel(appointment.status)}
      </strong>
      {appointment.patientId
        ? <Link to={`/patients/${appointment.patientId}`}>Ver ficha del paciente · {formatDateKey(start, { day: 'numeric', month: 'short' })}</Link>
        : <small>Ficha de paciente no vinculada</small>}
      <button className="text-button" onClick={onOpen} type="button">Ver detalle y gestionar</button>
    </div>
  )
}

function ScheduleSettings({
  profiles,
  schedules,
  updatedBy,
  onSaved,
  onCancel,
}: {
  profiles: ProfessionalProfile[]
  schedules: Record<string, ScheduleConfig>
  updatedBy: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [profileId, setProfileId] = useState<string>(profiles[0]?.dentistId ?? '')
  const profile = profiles.find((item) => item.dentistId === profileId)
  const [drafts, setDrafts] = useState<Record<string, ScheduleConfig>>({})
  const schedule = drafts[profileId] ?? (profile ? schedules[profileId] : undefined) ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setSchedule(next: ScheduleConfig) {
    setDrafts((current) => ({ ...current, [profileId]: next }))
  }

  function updateInterval(day: string, index: number, patch: Partial<TimeInterval>) {
    if (!schedule) return
    const intervals = [...(schedule.weeklyAvailability[day] ?? [])]
    intervals[index] = { ...intervals[index], ...patch }
    setSchedule({
      ...schedule,
      weeklyAvailability: { ...schedule.weeklyAvailability, [day]: intervals },
    })
  }

  function addInterval(day: string) {
    if (!schedule) return
    setSchedule({
      ...schedule,
      weeklyAvailability: {
        ...schedule.weeklyAvailability,
        [day]: [...(schedule.weeklyAvailability[day] ?? []), { start: '09:00', end: '21:00' }],
      },
    })
  }

  function removeInterval(day: string, index: number) {
    if (!schedule) return
    setSchedule({
      ...schedule,
      weeklyAvailability: {
        ...schedule.weeklyAvailability,
        [day]: schedule.weeklyAvailability[day].filter((_, itemIndex) => itemIndex !== index),
      },
    })
  }

  async function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!schedule) return
    for (const [day, intervals] of Object.entries(schedule.weeklyAvailability)) {
      if (!validateClinicIntervals(intervals)) {
        setError(`Revisá los intervalos de ${weekdayNames[Number(day) - 1]}: deben estar entre 09:00 y 21:00, en intervalos de 30 minutos y sin superposiciones.`)
        return
      }
    }
    if (schedule.exceptions.some((exception) => !validateClinicIntervals(exception.intervals))) {
      setError('Las excepciones deben respetar el horario de 09:00 a 21:00 y los intervalos de 30 minutos.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveSchedule({
        ...schedule,
        defaultDurationMinutes: 30,
        durationOptions: [30],
      }, updatedBy)
      onSaved()
    } catch (caught) {
      setError(agendaError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="agenda-config-panel">
      <div className="agenda-panel-heading">
        <div><p className="eyebrow">ADMINISTRACIÓN</p><h2>Configuración de horarios</h2></div>
        <button className="text-button" onClick={onCancel} type="button">Cerrar</button>
      </div>
      <label className="agenda-professional-select">
        Profesional
        <select
          onChange={(event) => {
            setProfileId(event.target.value)
          }}
          value={profileId}
        >
          {profiles.map((item) => <option key={item.dentistId} value={item.dentistId}>{item.name}</option>)}
        </select>
      </label>
      {!schedule ? (
        <p className="agenda-muted">Cargando configuración…</p>
      ) : (
        <form onSubmit={(event) => void submitSchedule(event)}>
          <p className="agenda-reference-note">La disponibilidad nueva es de lunes a viernes, de 09:00 a 21:00, con turnos de 30 minutos. Las excepciones existentes se conservan.</p>
          <button
            className="text-button"
            onClick={() => {
              const weeklyAvailability = Object.fromEntries(
                weekdayNames.map((_, index) => [
                  String(index + 1),
                  index < 5 ? [{ start: '09:00', end: '21:00' }] : [],
                ]),
              )
              setSchedule({
                ...schedule,
                weeklyAvailability,
                defaultDurationMinutes: 30,
                durationOptions: [30],
              })
            }}
            type="button"
          >
            Aplicar horario de 09:00 a 21:00
          </button>
          <div className="schedule-week-editor">
            {weekdayNames.map((name, index) => {
              const day = String(index + 1)
              const intervals = schedule.weeklyAvailability[day] ?? []
              return (
                <div className="schedule-day-editor" key={day}>
                  <strong>{name}</strong>
                  <div className="schedule-interval-list">
                    {intervals.map((interval, intervalIndex) => (
                      <div className="schedule-interval-inputs" key={`${day}-${intervalIndex}`}>
                        <input aria-label={`${name} inicio ${intervalIndex + 1}`} onChange={(event) => updateInterval(day, intervalIndex, { start: event.target.value })} type="time" value={interval.start} />
                        <span>a</span>
                        <input aria-label={`${name} fin ${intervalIndex + 1}`} onChange={(event) => updateInterval(day, intervalIndex, { end: event.target.value })} type="time" value={interval.end} />
                        <button aria-label={`Eliminar horario ${name}`} className="agenda-icon-button" onClick={() => removeInterval(day, intervalIndex)} type="button"><Trash2 size={14} /></button>
                      </div>
                    ))}
                    {intervals.length === 0 && <small className="agenda-muted">Día de descanso</small>}
                    <button className="text-button" onClick={() => addInterval(day)} type="button"><Plus size={14} /> Agregar horario</button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="agenda-reference-note">Duración de los turnos: 30 minutos.</p>
          <ScheduleExceptionEditor schedule={schedule} onChange={setSchedule} />
          {error && <p className="agenda-inline-error" role="alert">{error}</p>}
          <div className="agenda-form-actions">
            <button className="button button-secondary" onClick={onCancel} type="button">Cancelar</button>
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              {busy ? 'Guardando…' : 'Guardar horarios'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function ScheduleExceptionEditor({
  schedule,
  onChange,
}: {
  schedule: ScheduleConfig
  onChange: (schedule: ScheduleConfig) => void
}) {
  const [date, setDate] = useState('')
  const [closed, setClosed] = useState(true)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('21:00')
  const [error, setError] = useState<string | null>(null)

  function addException() {
    if (!date) {
      setError('Seleccioná una fecha para la excepción.')
      return
    }
    if (!closed && !validateClinicIntervals([{ start, end }])) {
      setError('El horario excepcional debe estar entre 09:00 y 21:00, en intervalos de 30 minutos.')
      return
    }
    const exception: ScheduleException = {
      date,
      intervals: closed ? [] : [{ start, end }],
      label: closed ? 'Día no laborable' : 'Horario excepcional',
    }
    onChange({
      ...schedule,
      exceptions: [
        ...schedule.exceptions.filter((item) => item.date !== date),
        exception,
      ].sort((left, right) => left.date.localeCompare(right.date)),
    })
    setError(null)
    setDate('')
  }

  return (
    <div className="schedule-exceptions">
      <h3>Excepciones por fecha</h3>
      <p>Un día marcado como no laborable reemplaza los horarios semanales de esa fecha.</p>
      <div className="schedule-exception-form">
        <input aria-label="Fecha de excepción" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
        <label><input checked={closed} onChange={(event) => setClosed(event.target.checked)} type="checkbox" /> Día no laborable</label>
        {!closed && <>
          <input aria-label="Inicio de excepción" onChange={(event) => setStart(event.target.value)} type="time" value={start} />
          <input aria-label="Fin de excepción" onChange={(event) => setEnd(event.target.value)} type="time" value={end} />
        </>}
        <button className="button button-secondary" disabled={!date} onClick={addException} type="button">Agregar excepción</button>
      </div>
      {error && <p className="agenda-inline-error" role="alert">{error}</p>}
      <div className="schedule-exception-list">
        {schedule.exceptions.map((item) => (
          <div key={item.date}>
            <span>{formatDateKey(item.date, { dateStyle: 'medium' })}</span>
            <strong>{item.intervals.length ? item.intervals.map((interval) => `${interval.start}–${interval.end}`).join(', ') : item.label}</strong>
            <button aria-label="Eliminar excepción" className="agenda-icon-button" onClick={() => onChange({ ...schedule, exceptions: schedule.exceptions.filter((entry) => entry.date !== item.date) })} type="button"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScheduleBlockForm({
  profiles,
  agenda,
  createdBy,
  onSaved,
  onCancel,
}: {
  profiles: ProfessionalProfile[]
  agenda: AgendaPageData | null
  createdBy: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [profileId, setProfileId] = useState<string>(profiles[0]?.dentistId ?? '')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [reason, setReason] = useState('')
  const [allowConflict, setAllowConflict] = useState(false)
  const [serverFoundConflict, setServerFoundConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const profile = profiles.find((item) => item.dentistId === profileId)
  const validBlockRange =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    isValidTime(startTime) &&
    isValidTime(endTime) &&
    startTime < endTime
  const blockStart = validBlockRange ? zonedDateTimeToDate(date, startTime) : null
  const blockEnd = validBlockRange ? zonedDateTimeToDate(date, endTime) : null
  const conflicts = Boolean(profile && agenda && blockStart && blockEnd &&
    agenda.appointments.some((appointment) =>
      appointment.dentistId === profile.dentistId &&
      dateKeyFromDate(appointment.startAt) === date &&
      appointment.startAt < blockEnd &&
      appointment.endAt > blockStart,
    ))

  async function submitBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || !isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime || !reason.trim()) {
      setError('Completá una fecha, un rango horario válido y el motivo del bloqueo.')
      return
    }
    if (minutesFromTime(startTime) % 15 !== 0 || minutesFromTime(endTime) % 15 !== 0) {
      setError('Los bloqueos deben comenzar y finalizar en intervalos de 15 minutos.')
      return
    }
    if (conflicts && !allowConflict) {
      setError('Hay turnos existentes en ese horario. Marcá la confirmación para guardar el bloqueo igualmente.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createScheduleBlock(
        profile,
        date,
        { start: startTime, end: endTime },
        reason,
        createdBy,
        allowConflict,
      )
      onSaved()
    } catch (caught) {
      if (caught instanceof ScheduleBlockAppointmentConflictError) {
        setServerFoundConflict(true)
        setError('Se encontraron turnos en ese horario al validar en Firebase. Revisá la agenda y confirmá si querés bloquearlo igualmente.')
      } else {
        setError(agendaError(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="agenda-config-panel agenda-block-panel">
      <div className="agenda-panel-heading">
        <div><p className="eyebrow">ADMINISTRACIÓN</p><h2>Bloquear horario</h2></div>
        <button className="text-button" onClick={onCancel} type="button">Cerrar</button>
      </div>
      <form className="agenda-block-form" onSubmit={(event) => void submitBlock(event)}>
        <label>Profesional<select onChange={(event) => { setProfileId(event.target.value); setAllowConflict(false); setServerFoundConflict(false) }} value={profileId}>{profiles.map((item) => <option key={item.dentistId} value={item.dentistId}>{item.name}</option>)}</select></label>
        <label>Fecha<input onChange={(event) => { setDate(event.target.value); setAllowConflict(false); setServerFoundConflict(false) }} required type="date" value={date} /></label>
        <label>Desde<input onChange={(event) => { setStartTime(event.target.value); setAllowConflict(false); setServerFoundConflict(false) }} required type="time" value={startTime} /></label>
        <label>Hasta<input onChange={(event) => { setEndTime(event.target.value); setAllowConflict(false); setServerFoundConflict(false) }} required type="time" value={endTime} /></label>
        <label className="agenda-block-reason">Motivo<input maxLength={120} onChange={(event) => setReason(event.target.value)} placeholder="Reunión, vacaciones, ausencia…" required value={reason} /></label>
        {(conflicts || serverFoundConflict) && (
          <label className="agenda-conflict-warning">
            <input checked={allowConflict} onChange={(event) => setAllowConflict(event.target.checked)} type="checkbox" />
            <span>Hay turnos en el rango elegido. Confirmo que quiero bloquearlo igualmente.</span>
          </label>
        )}
        {error && <p className="agenda-inline-error" role="alert">{error}</p>}
        <div className="agenda-form-actions">
          <button className="button button-secondary" onClick={onCancel} type="button">Cancelar</button>
          <button className="button button-primary" disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar bloqueo'}</button>
        </div>
      </form>
    </section>
  )
}

type AgendaPageData = {
  schedules: Record<string, ScheduleConfig>
  appointments: AgendaAppointment[]
  blocks: AgendaBlock[]
} | null

function appointmentTime(date: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Tucuman',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Tucuman',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function appointmentStatusLabel(status: string) {
  if (status === 'confirmed') return 'Confirmado'
  if (status === 'cancelled') return 'Cancelado'
  return 'Pendiente'
}

function appointmentErrorMessage(error: unknown) {
  if (error instanceof AppointmentValidationError) return error.message
  if (error instanceof AppointmentBlockOverlapError) return error.message
  if (error instanceof AppointmentOverlapError) return error.message
  if (error instanceof InvalidAppointmentStatusError) return error.message
  return firebaseOperationError(error, 'Turnos')
}

function agendaError(error: unknown) {
  if (error instanceof OverlappingScheduleBlockError) return error.message
  if (error instanceof ScheduleBlockAppointmentConflictError) {
    return 'El horario contiene turnos. Actualizá la agenda y confirmá el bloqueo si corresponde.'
  }
  return firebaseOperationError(error, 'Agenda')
}
