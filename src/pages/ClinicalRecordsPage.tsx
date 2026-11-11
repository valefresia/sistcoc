import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  FileHeart,
  LoaderCircle,
  Plus,
  Search,
  Save,
  Stethoscope,
} from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import {
  canAccessClinicalRecords,
  emptyMedicalHistory,
  MEDICAL_HISTORY_FIELDS,
  type ConsultationInput,
  type MedicalHistory,
  type MedicalHistoryField,
  type MedicalHistoryStatus,
  type TreatmentEvolutionInput,
  type TreatmentInput,
  type TreatmentStatus,
} from '../lib/clinical-record-logic'
import {
  addTreatmentEvolution,
  ClinicalPatientNotFoundError,
  ClinicalProfessionalNotFoundError,
  ClinicalRecordNotFoundError,
  createConsultation,
  createMedicalRecord,
  createTreatment,
  DuplicateAppointmentConsultationError,
  getClinicalRecordDetails,
  hasMedicalRecord,
  updateConsultation,
  updateTreatmentPlan,
  type ClinicalConsultation,
  type ClinicalConsultationRevision,
  type MedicalHistoryRevision,
  type ClinicalRecordDetails,
  type ClinicalTreatment,
  type ClinicalTreatmentRevision,
  type TreatmentEvolution,
  updateMedicalHistory,
} from '../lib/clinical-records'
import { firebaseErrorCode, firebaseOperationError } from '../lib/firebase-errors'
import { getAppointmentDetails } from '../lib/appointments'
import { fetchProfessionalProfiles, type ProfessionalProfile } from '../lib/schedules'
import {
  formatPatientDate,
  getPatient,
  isPatientPermissionError,
  searchPatients,
  type Patient,
} from '../lib/patients'
import { dateKeyFromDate, formatDateKey } from '../lib/schedule-logic'

const historyLabels: Record<MedicalHistoryField, string> = {
  diseases: 'Enfermedades o patologías relevantes',
  allergies: 'Alergias',
  medication: 'Medicación actual',
  medicalBackground: 'Antecedentes médicos',
  dentalBackground: 'Antecedentes odontológicos',
  generalNotes: 'Observaciones generales',
}

const treatmentStatusLabels: Record<TreatmentStatus, string> = {
  planned: 'Planificado',
  in_progress: 'En curso',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
}

const initialConsultation: ConsultationInput = {
  appointmentId: null,
  consultationDate: dateKeyFromDate(new Date()),
  reason: '',
  diagnosis: '',
  clinicalNotes: '',
  treatmentIndicated: '',
  treatmentPerformed: '',
  recommendations: '',
  nextControl: null,
}

export function ClinicalRecordsPage() {
  const { patientId } = useParams()
  return patientId
    ? <ClinicalRecordPage key={patientId} patientId={patientId} />
    : <ClinicalPatientSearchPage />
}

function ClinicalPatientSearchPage() {
  const [term, setTerm] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [recordStatus, setRecordStatus] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (term.trim().length < 2) {
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      void searchPatients(term)
        .then(async (matches) => {
          if (!active) return
          const visibleMatches = matches.slice(0, 10)
          setPatients(visibleMatches)
          const statuses = await Promise.all(
            visibleMatches.map(async (patient) => {
              return [patient.id, await hasMedicalRecord(patient.id)] as const
            }),
          )
          if (active) setRecordStatus(Object.fromEntries(statuses))
        })
        .catch((caught: unknown) => {
          setError(firebaseOperationError(caught, 'Buscar historias clínicas'))
          if (active) setError(clinicalError(caught))
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [term])

  return (
    <WorkspaceLayout title="Historias clínicas">
      <section className="patients-content clinical-content">
        <div className="patients-page-header">
          <div>
            <p className="eyebrow">ATENCIÓN ODONTOLÓGICA</p>
            <h1>Historias clínicas</h1>
            <p>Buscá un paciente existente para consultar o iniciar su historia clínica.</p>
          </div>
        </div>
        <section className="patient-list-card clinical-search-card">
          <label className="patient-search clinical-search">
            <Search size={17} />
            <input
              aria-label="Buscar paciente por nombre, apellido o DNI"
              onChange={(event) => {
                setTerm(event.target.value)
                if (event.target.value.trim().length < 2) {
                  setPatients([])
                  setRecordStatus({})
                  setError(null)
                  setLoading(false)
                } else {
                  setLoading(true)
                  setError(null)
                }
              }}
              placeholder="Buscar por nombre, apellido o DNI"
              type="search"
              value={term}
            />
            {loading && <LoaderCircle aria-label="Buscando" className="spin" size={16} />}
          </label>
          {error && <p className="clinical-error" role="alert">{error}</p>}
          {term.trim().length < 2 && (
            <div className="patient-state">
              <Search size={22} />
              <strong>Buscá un paciente</strong>
              <span>Ingresá al menos dos caracteres de nombre, apellido o DNI.</span>
            </div>
          )}
          {term.trim().length >= 2 && !loading && !error && patients.length === 0 && (
            <div className="patient-state">
              <strong>No encontramos pacientes con esa búsqueda</strong>
              <span>Los pacientes se registran desde el módulo Pacientes.</span>
            </div>
          )}
          {patients.length > 0 && (
            <div className="clinical-patient-results">
              {patients.map((patient) => (
                <Link
                  className="clinical-patient-result"
                  key={patient.id}
                  to={`/clinical-records/${patient.id}`}
                >
                  <span className="clinical-record-icon"><FileHeart size={19} /></span>
                  <span>
                    <strong>{patient.firstName} {patient.lastName}</strong>
                    <small>DNI {patient.dni}</small>
                  </span>
                  <span className={`clinical-record-indicator${recordStatus[patient.id] ? ' clinical-record-exists' : ''}`}>
                    {recordStatus[patient.id] ? 'Historia iniciada' : 'Sin historia'}
                  </span>
                </Link>
              ))}
            </div>
          )}
          {patients.length === 10 && (
            <p className="clinical-inline-note">Se muestran hasta 10 coincidencias. Afiná la búsqueda para encontrar otro paciente.</p>
          )}
        </section>
      </section>
    </WorkspaceLayout>
  )
}

function ClinicalRecordPage({ patientId }: { patientId: string }) {
  const { dentistId, role, user } = useAuth()
  const [searchParams] = useSearchParams()
  const appointmentId = searchParams.get('appointmentId')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [details, setDetails] = useState<ClinicalRecordDetails | null>(null)
  const [appointment, setAppointment] = useState<Awaited<ReturnType<typeof getAppointmentDetails>>>(null)
  const [profiles, setProfiles] = useState<ProfessionalProfile[]>([])
  const [historyDraft, setHistoryDraft] = useState<MedicalHistory>(emptyMedicalHistory())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const loadGeneration = useRef(0)
  const [editingHistory, setEditingHistory] = useState(false)
  const [showConsultationForm, setShowConsultationForm] = useState(false)
  const [consultationDraft, setConsultationDraft] = useState<ConsultationInput>(initialConsultation)
  const [editingConsultationId, setEditingConsultationId] = useState<string | null>(null)
  const [associateAppointment, setAssociateAppointment] = useState(Boolean(appointmentId))
  const [showTreatmentForm, setShowTreatmentForm] = useState(false)
  const [editingTreatmentId, setEditingTreatmentId] = useState<string | null>(null)
  const [treatmentDraft, setTreatmentDraft] = useState<TreatmentInput>({ name: '', planDescription: '' })
  const [activeTreatment, setActiveTreatment] = useState<string | null>(null)
  const [treatmentEvolution, setTreatmentEvolution] = useState<TreatmentEvolutionInput>(
    emptyTreatmentEvolution(),
  )
  const canAccess = canAccessClinicalRecords(user?.uid ?? '', role, dentistId)
  const hasConsultationForAppointment = Boolean(
    appointmentId &&
      details?.consultations.some((item) => item.appointmentId === appointmentId),
  )
  const professionalName = (uid: string) =>
    profiles.find((profile) => profile.uid === uid)?.name ?? uid

  async function reload() {
    const [loadedPatient, loadedDetails] = await Promise.all([
      getPatient(patientId),
      getClinicalRecordDetails(patientId),
    ])
    setPatient(loadedPatient)
    setDetails(loadedDetails)
    if (loadedDetails.record) setHistoryDraft(loadedDetails.record.medicalHistory)
  }

  useEffect(() => {
    if (!user || !dentistId || !role) return
    const generation = ++loadGeneration.current
    void (async () => {
      const [loadedPatient, loadedDetails] = await Promise.all([
        getPatient(patientId),
        getClinicalRecordDetails(patientId),
      ])
      if (!loadedPatient) throw new ClinicalPatientNotFoundError()
      if (generation !== loadGeneration.current) return
      setPatient(loadedPatient)
      setDetails(loadedDetails)
      if (loadedDetails.record) setHistoryDraft(loadedDetails.record.medicalHistory)

      const loadedProfiles = await fetchProfessionalProfiles(role === 'admin', dentistId, user.uid)
      if (generation !== loadGeneration.current) return
      setProfiles(loadedProfiles)
      if (appointmentId) {
        const loadedAppointment = await getAppointmentDetails(appointmentId, loadedProfiles)
        if (!loadedAppointment || loadedAppointment.appointment.patientId !== patientId) {
          throw new Error('El turno no corresponde al paciente seleccionado.')
        }
        if (generation === loadGeneration.current) {
          setAppointment(loadedAppointment)
          setConsultationDraft((current) => ({
            ...current,
            appointmentId,
            consultationDate: loadedAppointment.appointment.date,
          }))
        }
      } else {
        setAppointment(null)
      }
    })()
      .catch((caught: unknown) => {
        if (generation === loadGeneration.current) setError(clinicalError(caught))
      })
      .finally(() => {
        if (generation === loadGeneration.current) setLoading(false)
      })
    return () => {
      loadGeneration.current += 1
    }
  }, [appointmentId, dentistId, patientId, role, user])

  async function handleCreateRecord() {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await createMedicalRecord(patientId, user.uid)
      await reload()
      setNotice('Se inició la historia clínica. Los antecedentes quedaron pendientes de completar.')
    } catch (caught) {
      setError(clinicalError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await updateMedicalHistory(patientId, historyDraft, user.uid)
      await reload()
      setEditingHistory(false)
      setNotice('Los antecedentes se actualizaron y quedó guardada su versión anterior.')
    } catch (caught) {
      setError(clinicalError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const input = {
        ...consultationDraft,
        appointmentId: editingConsultationId
          ? consultationDraft.appointmentId
          : associateAppointment ? appointmentId : null,
      }
      if (editingConsultationId) {
        await updateConsultation(patientId, editingConsultationId, input, user.uid)
      } else {
        await createConsultation(patientId, input, user.uid)
      }
      await reload()
      setShowConsultationForm(false)
      setEditingConsultationId(null)
      setConsultationDraft(initialConsultation)
      setNotice(editingConsultationId
        ? 'La consulta se actualizó y quedó conservada su versión anterior.'
        : 'La consulta odontológica quedó registrada.')
    } catch (caught) {
      setError(clinicalError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateTreatment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      if (editingTreatmentId) {
        await updateTreatmentPlan(patientId, editingTreatmentId, treatmentDraft, user.uid)
      } else {
        await createTreatment(patientId, treatmentDraft, user.uid)
      }
      await reload()
      setShowTreatmentForm(false)
      setEditingTreatmentId(null)
      setTreatmentDraft({ name: '', planDescription: '' })
      setNotice(editingTreatmentId
        ? 'El plan se actualizó y quedó conservada su versión anterior.'
        : 'El tratamiento planificado quedó registrado.')
    } catch (caught) {
      setError(clinicalError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleAddEvolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !activeTreatment) return
    setBusy(true)
    setError(null)
    try {
      await addTreatmentEvolution(patientId, activeTreatment, treatmentEvolution, user.uid)
      await reload()
      setActiveTreatment(null)
      setTreatmentEvolution(emptyTreatmentEvolution())
      setNotice('La evolución se agregó al historial del tratamiento.')
    } catch (caught) {
      setError(clinicalError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <WorkspaceLayout title="Historia clínica">
      <section className="patients-content clinical-content">
        <Link className="back-link" to="/clinical-records"><ArrowLeft size={16} /> Volver a historias clínicas</Link>
        {loading && <div className="patient-state"><LoaderCircle className="spin" size={22} /> Cargando historia clínica...</div>}
        {!loading && error && <p className="clinical-error" role="alert">{error}</p>}
        {!loading && !error && patient && (
          <>
            <div className="clinical-page-heading">
              <div>
                <p className="eyebrow">HISTORIA CLÍNICA</p>
                <h1>{patient.firstName} {patient.lastName}</h1>
                <p>DNI {patient.dni} · Fecha de nacimiento {formatPatientDate(patient.birthDate)}</p>
              </div>
              <Link className="button button-secondary" to={`/patients/${patient.id}`}>Ficha del paciente</Link>
            </div>
            {notice && <div className="patient-notice patient-notice-success" role="status">{notice}</div>}
            {error && <p className="clinical-error" role="alert">{error}</p>}

            {appointment && (
              <div className="clinical-appointment-banner">
                <CalendarMark />
                <span>
                  Consulta desde el turno de {formatDateKey(appointment.appointment.date, { dateStyle: 'medium' })},
                  {' '}{appointment.appointment.startTime} · {appointment.professionalName}
                </span>
              </div>
            )}

            <section className="patient-detail-card clinical-section">
              <div className="patient-form-section-heading">
                <div><h2>Datos generales</h2><p>Información tomada de la ficha vigente del paciente.</p></div>
              </div>
              <div className="patient-detail-grid">
                <ClinicalDetail label="Nombre y apellido" value={`${patient.firstName} ${patient.lastName}`} />
                <ClinicalDetail label="DNI" value={patient.dni} />
                <ClinicalDetail label="Fecha de nacimiento" value={formatPatientDate(patient.birthDate)} />
                <ClinicalDetail label="Teléfono" value={patient.phone} />
                <ClinicalDetail label="Email" value={patient.email || 'No informado'} />
              </div>
            </section>

            {!details?.record ? (
              <section className="patient-detail-card clinical-empty-record">
                <FileHeart size={25} />
                <h2>Historia clínica no iniciada</h2>
                <p>La información médica se completa por apartados. Los campos quedan como pendientes hasta que se indique lo contrario.</p>
                <button className="button button-primary" disabled={busy || !canAccess} onClick={() => void handleCreateRecord()} type="button">
                  <Plus size={16} /> Iniciar historia clínica
                </button>
              </section>
            ) : (
              <>
                <section className="patient-detail-card clinical-section">
                  <div className="patient-form-section-heading">
                    <div><h2>Antecedentes médicos</h2><p>Se distingue la información pendiente de la declarada y de los antecedentes registrados.</p></div>
                    {!editingHistory && <button className="button button-secondary" onClick={() => setEditingHistory(true)} type="button">Editar antecedentes</button>}
                  </div>
                  {editingHistory ? (
                    <form className="clinical-history-form" onSubmit={(event) => void handleSaveHistory(event)}>
                      {MEDICAL_HISTORY_FIELDS.map((field) => (
                        <label className="clinical-history-field" key={field}>
                          <strong>{historyLabels[field]}</strong>
                          <select
                            onChange={(event) => setHistoryDraft((current) => ({
                              ...current,
                              [field]: {
                                status: event.target.value as MedicalHistoryStatus,
                                details: event.target.value === 'recorded' ? current[field].details : '',
                              },
                            }))}
                            value={historyDraft[field].status}
                          >
                            <option value="pending">Pendiente de completar</option>
                            <option value="none_declared">Sin antecedentes declarados</option>
                            <option value="recorded">Antecedentes registrados</option>
                          </select>
                          {historyDraft[field].status === 'recorded' && (
                            <textarea
                              maxLength={2000}
                              onChange={(event) => setHistoryDraft((current) => ({
                                ...current,
                                [field]: { ...current[field], details: event.target.value },
                              }))}
                              required
                              rows={3}
                              value={historyDraft[field].details}
                            />
                          )}
                        </label>
                      ))}
                      <div className="agenda-form-actions clinical-form-actions">
                        <button className="button button-secondary" disabled={busy} onClick={() => {
                          setHistoryDraft(details.record?.medicalHistory ?? emptyMedicalHistory())
                          setEditingHistory(false)
                        }} type="button">Cancelar</button>
                        <button className="button button-primary" disabled={busy} type="submit"><Save size={16} /> Guardar antecedentes</button>
                      </div>
                    </form>
                  ) : (
                    <div className="clinical-history-list">
                      {MEDICAL_HISTORY_FIELDS.map((field) => (
                        <div className="clinical-history-item" key={field}>
                          <strong>{historyLabels[field]}</strong>
                          <span className={`clinical-history-status clinical-history-status-${details.record?.medicalHistory[field].status}`}>
                            {medicalHistoryStatusLabel(details.record?.medicalHistory[field].status ?? 'pending')}
                          </span>
                          <p>{details.record?.medicalHistory[field].status === 'recorded'
                            ? details.record.medicalHistory[field].details
                            : details.record?.medicalHistory[field].status === 'none_declared'
                              ? 'El paciente declara no presentar antecedentes en este apartado.'
                              : 'Información pendiente de completar.'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {details.record && (
                    <small className="clinical-audit-note">
                      Actualizado {formatDateTime(details.record.updatedAt)} · versión anterior conservada
                    </small>
                  )}
                  {details.historyRevisions.length > 0 && (
                    <details className="clinical-revision-list">
                      <summary>Versiones anteriores de antecedentes ({details.historyRevisions.length})</summary>
                      {details.historyRevisions.map((revision) => (
                        <HistoryRevisionCard key={revision.id} revision={revision} />
                      ))}
                    </details>
                  )}
                </section>

                <section className="patient-detail-card clinical-section">
                  <div className="patient-form-section-heading">
                    <div><h2>Consultas odontológicas</h2><p>{details.consultations.length} registros · ordenados de más reciente a más antiguo.</p></div>
                    <button className="button button-primary" disabled={busy || !canAccess || hasConsultationForAppointment} onClick={() => {
                      setError(null)
                      setConsultationDraft({
                        ...initialConsultation,
                        consultationDate: appointment?.appointment.date ?? dateKeyFromDate(new Date()),
                        appointmentId: appointmentId,
                      })
                      setEditingConsultationId(null)
                      setAssociateAppointment(Boolean(appointmentId))
                      setShowConsultationForm((open) => !open)
                    }} type="button">
                      <Plus size={16} /> Nueva consulta
                    </button>
                  </div>
                  {hasConsultationForAppointment && <p className="clinical-inline-note">Este turno ya tiene una consulta asociada.</p>}
                  {showConsultationForm && (
                    <form className="clinical-form-grid" onSubmit={(event) => void handleCreateConsultation(event)}>
                      {appointmentId && (
                        <label className="clinical-checkbox clinical-field-wide">
                          <input checked={associateAppointment} onChange={(event) => setAssociateAppointment(event.target.checked)} type="checkbox" />
                          Asociar esta consulta al turno seleccionado
                        </label>
                      )}
                      <label>Fecha de atención<input onChange={(event) => setConsultationDraft({ ...consultationDraft, consultationDate: event.target.value })} required type="date" value={consultationDraft.consultationDate} /></label>
                      <label>Próximo control (opcional)<input onChange={(event) => setConsultationDraft({ ...consultationDraft, nextControl: event.target.value || null })} type="date" value={consultationDraft.nextControl ?? ''} /></label>
                      <ClinicalTextarea label="Motivo de consulta" required value={consultationDraft.reason} onChange={(value) => setConsultationDraft({ ...consultationDraft, reason: value })} />
                      <ClinicalTextarea label="Diagnóstico" required value={consultationDraft.diagnosis} onChange={(value) => setConsultationDraft({ ...consultationDraft, diagnosis: value })} />
                      <ClinicalTextarea label="Observaciones clínicas" value={consultationDraft.clinicalNotes} onChange={(value) => setConsultationDraft({ ...consultationDraft, clinicalNotes: value })} />
                      <ClinicalTextarea label="Tratamiento indicado" value={consultationDraft.treatmentIndicated} onChange={(value) => setConsultationDraft({ ...consultationDraft, treatmentIndicated: value })} />
                      <ClinicalTextarea label="Tratamiento realizado" value={consultationDraft.treatmentPerformed} onChange={(value) => setConsultationDraft({ ...consultationDraft, treatmentPerformed: value })} />
                      <ClinicalTextarea label="Indicaciones posteriores" value={consultationDraft.recommendations} onChange={(value) => setConsultationDraft({ ...consultationDraft, recommendations: value })} />
                      <div className="agenda-form-actions clinical-field-wide">
                        <button className="button button-secondary" disabled={busy} onClick={() => {
                          setShowConsultationForm(false)
                          setEditingConsultationId(null)
                        }} type="button">Cerrar</button>
                        <button className="button button-primary" disabled={busy} type="submit">{busy ? 'Guardando…' : editingConsultationId ? 'Guardar cambios' : 'Registrar consulta'}</button>
                      </div>
                    </form>
                  )}
                  {details.consultations.length === 0
                    ? <p className="clinical-inline-note">Todavía no hay consultas registradas.</p>
                    : <div className="clinical-timeline">{details.consultations.map((consultation) => (
                      <ConsultationCard
                        consultation={consultation}
                        key={consultation.id}
                        revisions={details.consultationRevisions[consultation.id] ?? []}
                        professionalName={professionalName(consultation.professionalUid)}
                        onEdit={() => {
                          setEditingConsultationId(consultation.id)
                          setConsultationDraft({
                            appointmentId: consultation.appointmentId,
                            consultationDate: consultation.consultationDate,
                            reason: consultation.reason,
                            diagnosis: consultation.diagnosis,
                            clinicalNotes: consultation.clinicalNotes,
                            treatmentIndicated: consultation.treatmentIndicated,
                            treatmentPerformed: consultation.treatmentPerformed,
                            recommendations: consultation.recommendations,
                            nextControl: consultation.nextControl,
                          })
                          setAssociateAppointment(Boolean(consultation.appointmentId))
                          setShowConsultationForm(true)
                          setError(null)
                        }}
                      />
                    ))}</div>}
                </section>

                <section className="patient-detail-card clinical-section">
                  <div className="patient-form-section-heading">
                    <div><h2>Tratamientos y evolución</h2><p>Las evoluciones se agregan como entradas nuevas y no reemplazan las anteriores.</p></div>
                    <button className="button button-primary" disabled={busy || !canAccess} onClick={() => {
                      setEditingTreatmentId(null)
                      setTreatmentDraft({ name: '', planDescription: '' })
                      setShowTreatmentForm((open) => !open)
                    }} type="button"><Plus size={16} /> Planificar tratamiento</button>
                  </div>
                  {showTreatmentForm && (
                    <form className="clinical-form-grid" onSubmit={(event) => void handleCreateTreatment(event)}>
                      <label>Tratamiento<input maxLength={160} onChange={(event) => setTreatmentDraft({ ...treatmentDraft, name: event.target.value })} required value={treatmentDraft.name} /></label>
                      <label className="clinical-field-wide">Plan indicado<textarea maxLength={4000} onChange={(event) => setTreatmentDraft({ ...treatmentDraft, planDescription: event.target.value })} required rows={3} value={treatmentDraft.planDescription} /></label>
                      <div className="agenda-form-actions clinical-field-wide">
                        <button className="button button-secondary" disabled={busy} onClick={() => {
                          setShowTreatmentForm(false)
                          setEditingTreatmentId(null)
                        }} type="button">Cerrar</button>
                        <button className="button button-primary" disabled={busy} type="submit">{editingTreatmentId ? 'Guardar cambios' : 'Guardar tratamiento'}</button>
                      </div>
                    </form>
                  )}
                  {details.treatments.length === 0
                    ? <p className="clinical-inline-note">Todavía no hay tratamientos registrados.</p>
                    : <div className="clinical-treatment-list">{details.treatments.map((treatment) => (
                      <TreatmentCard
                        key={treatment.id}
                        treatment={treatment}
                        revisions={details.treatmentRevisions[treatment.id] ?? []}
                        professionalName={professionalName(treatment.professionalUid)}
                        evolutionProfessionalName={(uid) => professionalName(uid)}
                        onAddEvolution={() => {
                          setActiveTreatment(treatment.id)
                          setTreatmentEvolution(emptyTreatmentEvolution())
                        }}
                        onEdit={() => {
                          setEditingTreatmentId(treatment.id)
                          setTreatmentDraft({ name: treatment.name, planDescription: treatment.planDescription })
                          setShowTreatmentForm(true)
                        }}
                      />
                    ))}</div>}
                  {activeTreatment && (
                    <form className="clinical-form-grid clinical-evolution-form" onSubmit={(event) => void handleAddEvolution(event)}>
                      <h3 className="clinical-field-wide">Nueva evolución</h3>
                      <label>Fecha<input onChange={(event) => setTreatmentEvolution({ ...treatmentEvolution, date: event.target.value })} required type="date" value={treatmentEvolution.date} /></label>
                      <label>Estado<select onChange={(event) => setTreatmentEvolution({ ...treatmentEvolution, status: event.target.value as TreatmentStatus })} value={treatmentEvolution.status}>
                        {Object.entries(treatmentStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                      </select></label>
                      <label className="clinical-field-wide">Procedimiento realizado<input maxLength={2000} onChange={(event) => setTreatmentEvolution({ ...treatmentEvolution, procedureDescription: event.target.value })} required value={treatmentEvolution.procedureDescription} /></label>
                      <ClinicalTextarea label="Evolución" required value={treatmentEvolution.evolution} onChange={(value) => setTreatmentEvolution({ ...treatmentEvolution, evolution: value })} />
                      <ClinicalTextarea label="Observaciones" value={treatmentEvolution.notes} onChange={(value) => setTreatmentEvolution({ ...treatmentEvolution, notes: value })} />
                      <div className="agenda-form-actions clinical-field-wide">
                        <button className="button button-secondary" disabled={busy} onClick={() => setActiveTreatment(null)} type="button">Cerrar</button>
                        <button className="button button-primary" disabled={busy} type="submit">Guardar evolución</button>
                      </div>
                    </form>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </section>
    </WorkspaceLayout>
  )
}

function ClinicalDetail({ label, value }: { label: string; value: string }) {
  return <div className="patient-detail-item"><span>{label}</span><strong>{value}</strong></div>
}

function HistoryRevisionCard({ revision }: { revision: MedicalHistoryRevision }) {
  return (
    <section className="clinical-revision-item">
      <strong>Versión guardada {formatDateTime(revision.createdAt)}</strong>
      {MEDICAL_HISTORY_FIELDS.map((field) => (
        <p key={field}>
          <strong>{historyLabels[field]}:</strong>{' '}
          {medicalHistoryStatusLabel(revision.medicalHistory[field].status)}
          {revision.medicalHistory[field].details
            ? ` — ${revision.medicalHistory[field].details}`
            : ''}
        </p>
      ))}
      <small>Responsable UID: {revision.createdBy}</small>
    </section>
  )
}

function ClinicalTextarea({
  label,
  required = false,
  value,
  onChange,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="clinical-field-wide">
      {label}
      <textarea maxLength={4000} onChange={(event) => onChange(event.target.value)} required={required} rows={3} value={value} />
    </label>
  )
}

function ConsultationCard({
  consultation,
  revisions,
  professionalName,
  onEdit,
}: {
  consultation: ClinicalConsultation
  revisions: ClinicalConsultationRevision[]
  professionalName: string
  onEdit: () => void
}) {
  return (
    <details className="clinical-timeline-item">
      <summary>
        <span className="clinical-record-icon"><Stethoscope size={17} /></span>
        <span><strong>{formatDateKey(consultation.consultationDate, { dateStyle: 'medium' })}</strong><small>{consultation.reason}</small></span>
        <span className="clinical-type-label">Consulta</span>
      </summary>
      <dl className="clinical-detail-grid">
        <dt>Diagnóstico</dt><dd>{consultation.diagnosis}</dd>
        <dt>Observaciones clínicas</dt><dd>{consultation.clinicalNotes || 'Sin observaciones'}</dd>
        <dt>Tratamiento indicado</dt><dd>{consultation.treatmentIndicated || 'No informado'}</dd>
        <dt>Tratamiento realizado</dt><dd>{consultation.treatmentPerformed || 'No informado'}</dd>
        <dt>Indicaciones posteriores</dt><dd>{consultation.recommendations || 'No informadas'}</dd>
        <dt>Próximo control</dt><dd>{consultation.nextControl ? formatDateKey(consultation.nextControl, { dateStyle: 'medium' }) : 'No indicado'}</dd>
        <dt>Profesional</dt><dd>{professionalName}</dd>
        {consultation.appointmentId && <><dt>Turno asociado</dt><dd><Link to={`/agenda`}>Consultar turno</Link></dd></>}
        <dt>Última modificación</dt><dd>{formatDateTime(consultation.updatedAt)}</dd>
      </dl>
      <button className="button button-secondary" onClick={onEdit} type="button">Editar consulta</button>
      {revisions.length > 0 && (
        <details className="clinical-revision-list">
          <summary>Versiones anteriores ({revisions.length})</summary>
          {revisions.map((revision) => (
            <section className="clinical-revision-item" key={revision.id}>
              <strong>Versión guardada {formatDateTime(revision.createdAt)}</strong>
              <p>Motivo: {revision.consultation.reason}</p>
              <p>Diagnóstico: {revision.consultation.diagnosis}</p>
              <small>Responsable UID: {revision.createdBy}</small>
            </section>
          ))}
        </details>
      )}
    </details>
  )
}

function TreatmentCard({
  treatment,
  revisions,
  professionalName,
  evolutionProfessionalName,
  onAddEvolution,
  onEdit,
}: {
  treatment: ClinicalTreatment
  revisions: ClinicalTreatmentRevision[]
  professionalName: string
  evolutionProfessionalName: (uid: string) => string
  onAddEvolution: () => void
  onEdit: () => void
}) {
  return (
    <article className="clinical-treatment-card">
      <header>
        <div><h3>{treatment.name}</h3><span className={`clinical-treatment-status clinical-treatment-status-${treatment.status}`}>{treatmentStatusLabels[treatment.status]}</span></div>
        <button className="button button-secondary" onClick={onEdit} type="button">Editar plan</button>
        <button className="button button-secondary" onClick={onAddEvolution} type="button">Agregar evolución</button>
      </header>
      <p>{treatment.planDescription}</p>
      <small>Responsable: {professionalName} · Actualizado {formatDateTime(treatment.updatedAt)}</small>
      {revisions.length > 0 && (
        <details className="clinical-revision-list">
          <summary>Versiones anteriores del plan ({revisions.length})</summary>
          {revisions.map((revision) => (
            <section className="clinical-revision-item" key={revision.id}>
              <strong>Versión guardada {formatDateTime(revision.createdAt)}</strong>
              <p>{revision.treatment.name}</p>
              <p>{revision.treatment.planDescription}</p>
              <small>Responsable UID: {revision.createdBy}</small>
            </section>
          ))}
        </details>
      )}
      <div className="clinical-evolution-list">
        {treatment.evolutions.map((item) => (
          <EvolutionCard
            evolution={item}
            key={item.id}
            professionalName={evolutionProfessionalName(item.professionalUid)}
          />
        ))}
      </div>
    </article>
  )
}

function EvolutionCard({
  evolution,
  professionalName,
}: {
  evolution: TreatmentEvolution
  professionalName: string
}) {
  return (
    <div className="clinical-evolution-item">
      <div><strong>{formatDateKey(dateKeyFromDate(evolution.date), { dateStyle: 'medium' })}</strong><span className={`clinical-treatment-status clinical-treatment-status-${evolution.status}`}>{treatmentStatusLabels[evolution.status]}</span></div>
      <strong>{evolution.procedureDescription}</strong>
      <p>{evolution.evolution}</p>
      {evolution.notes && <small>{evolution.notes}</small>}
      <small>Profesional: {professionalName}</small>
    </div>
  )
}

function emptyTreatmentEvolution(): TreatmentEvolutionInput {
  return {
    date: dateKeyFromDate(new Date()),
    procedureDescription: '',
    evolution: '',
    notes: '',
    status: 'in_progress',
  }
}

function medicalHistoryStatusLabel(status: MedicalHistoryStatus) {
  if (status === 'recorded') return 'Registrado'
  if (status === 'none_declared') return 'Sin antecedentes declarados'
  return 'Pendiente'
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Tucuman',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function CalendarMark() {
  return <span className="clinical-record-icon"><Stethoscope size={17} /></span>
}

function clinicalError(error: unknown) {
  if (error instanceof ClinicalPatientNotFoundError) return error.message
  if (error instanceof ClinicalRecordNotFoundError) return error.message
  if (error instanceof ClinicalProfessionalNotFoundError) return error.message
  if (error instanceof DuplicateAppointmentConsultationError) return error.message
  if (error instanceof Error && error.name === 'ClinicalRecordValidationError') return error.message
  if (isPatientPermissionError(error)) return 'Tu cuenta no tiene permisos para consultar pacientes.'
  if (firebaseErrorCode(error)) {
    return firebaseOperationError(error, 'Historia clínica')
  }
  return firebaseOperationError(error, 'Historia clínica')
}
