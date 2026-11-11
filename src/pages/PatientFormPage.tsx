import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, LoaderCircle, Save, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import { firebaseOperationError } from '../lib/firebase-errors'
import {
  createPatient,
  DuplicatePatientDniError,
  getPatient,
  isPatientPermissionError,
  PatientNotFoundError,
  PatientOperationTimeoutError,
  updatePatient,
} from '../lib/patients'
import {
  preparePatientFields,
  type PatientFieldErrors,
  type PatientFields,
} from '../lib/patient-validation'

const emptyFields: PatientFields = {
  firstName: '',
  lastName: '',
  dni: '',
  birthDate: '',
  phone: '',
  email: '',
  address: '',
  observations: '',
}
const maxBirthDate = new Date().toISOString().slice(0, 10)

export function PatientFormPage({
  mode,
  patientId,
}: {
  mode: 'create' | 'edit'
  patientId?: string
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isEditing = mode === 'edit'
  const [fields, setFields] = useState<PatientFields>(emptyFields)
  const [fieldErrors, setFieldErrors] = useState<PatientFieldErrors>({})
  const [loadingPatient, setLoadingPatient] = useState(isEditing)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!isEditing || !patientId) return
    let active = true
    void getPatient(patientId)
      .then((patient) => {
        if (!active) return
        if (!patient) {
          setFormError('No encontramos el paciente solicitado.')
          return
        }
        setFields({
          firstName: patient.firstName,
          lastName: patient.lastName,
          dni: patient.dni,
          birthDate: patient.birthDate,
          phone: patient.phone,
          email: patient.email,
          address: patient.address,
          observations: patient.observations,
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        setFormError(patientError(error, 'No se pudieron cargar los datos del paciente.'))
      })
      .finally(() => {
        if (active) setLoadingPatient(false)
      })
    return () => {
      active = false
    }
  }, [isEditing, patientId])

  function updateField(field: keyof PatientFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return
    setFormError(null)
    const validation = preparePatientFields(fields)
    setFieldErrors(validation.errors)
    if (!validation.value) return
    if (!user) {
      setFormError('Tu sesión expiró. Iniciá sesión nuevamente.')
      return
    }
    if (isEditing && !patientId) {
      setFormError('No se pudo identificar el paciente que querés editar.')
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const result = isEditing
        ? await updatePatient(patientId!, validation.value, user.uid)
        : await createPatient(validation.value, user.uid)
      if (Object.keys(result.errors).length > 0) {
        setFieldErrors(result.errors)
        return
      }

      if (isEditing) {
        navigate(`/patients/${patientId}?updated=1`)
      } else {
        navigate('/patients?created=1')
      }
    } catch (error) {
      setFormError(patientError(error, 'No se pudo guardar el paciente. Intentá nuevamente.'))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (loadingPatient) {
    return (
      <WorkspaceLayout title={isEditing ? 'Editar paciente' : 'Nuevo paciente'}>
        <main className="patient-state" aria-live="polite">
          <LoaderCircle className="spin" size={22} />
          <span>Cargando datos del paciente...</span>
        </main>
      </WorkspaceLayout>
    )
  }

  return (
    <WorkspaceLayout title={isEditing ? 'Editar paciente' : 'Nuevo paciente'}>
      <section className="patients-content patient-form-page">
        <Link className="back-link" to={isEditing && patientId ? `/patients/${patientId}` : '/patients'}>
          <ArrowLeft size={16} />
          Volver {isEditing ? 'a la ficha' : 'a pacientes'}
        </Link>

        <div className="patients-page-header patient-form-heading">
          <div>
            <p className="eyebrow">{isEditing ? 'ACTUALIZACIÓN DE DATOS' : 'NUEVA FICHA'}</p>
            <h1>{isEditing ? 'Editar paciente' : 'Nuevo paciente'}</h1>
            <p>
              {isEditing
                ? 'Actualizá la información personal del paciente.'
                : 'Completá los datos para crear una ficha compartida del centro.'}
            </p>
          </div>
          <span className="patient-form-icon"><UserRound size={21} /></span>
        </div>

        <form className="patient-form-card" noValidate onSubmit={(event) => void handleSubmit(event)}>
          <div className="patient-form-section-heading">
            <h2>Datos personales</h2>
            <p>Los campos marcados con <span>*</span> son obligatorios.</p>
          </div>

          {formError && (
            <div className="patient-notice patient-notice-error" role="alert">
              <span className="notice-alert">!</span>
              {formError}
            </div>
          )}

          <div className="patient-fields-grid">
            <PatientInput
              error={fieldErrors.firstName}
              label="Nombre"
              name="firstName"
              onChange={(value) => updateField('firstName', value)}
              required
              value={fields.firstName}
            />
            <PatientInput
              error={fieldErrors.lastName}
              label="Apellido"
              name="lastName"
              onChange={(value) => updateField('lastName', value)}
              required
              value={fields.lastName}
            />
            <PatientInput
              autoComplete="off"
              error={fieldErrors.dni}
              help="Se guardará normalizado, sin puntos ni espacios."
              label="DNI"
              name="dni"
              onChange={(value) => updateField('dni', value)}
              required
              value={fields.dni}
            />
            <PatientInput
              error={fieldErrors.birthDate}
              label="Fecha de nacimiento"
              max={maxBirthDate}
              name="birthDate"
              onChange={(value) => updateField('birthDate', value)}
              required
              type="date"
              value={fields.birthDate}
            />
            <PatientInput
              autoComplete="tel"
              error={fieldErrors.phone}
              label="Teléfono"
              name="phone"
              onChange={(value) => updateField('phone', value)}
              required
              type="tel"
              value={fields.phone}
            />
            <PatientInput
              autoComplete="email"
              error={fieldErrors.email}
              label="Correo electrónico"
              name="email"
              onChange={(value) => updateField('email', value)}
              type="email"
              value={fields.email}
            />
            <PatientInput
              error={fieldErrors.address}
              label="Dirección"
              name="address"
              onChange={(value) => updateField('address', value)}
              optional
              value={fields.address}
            />
            <label className="patient-field patient-field-wide">
              <span>Observaciones generales <small>Opcional</small></span>
              <textarea
                aria-describedby={fieldErrors.observations ? 'observations-error' : undefined}
                maxLength={2000}
                onChange={(event) => updateField('observations', event.target.value)}
                rows={4}
                value={fields.observations}
              />
              {fieldErrors.observations && (
                <small className="patient-field-error" id="observations-error">
                  {fieldErrors.observations}
                </small>
              )}
            </label>
          </div>

          <div className="patient-form-actions">
            <Link className="button button-secondary" to={isEditing && patientId ? `/patients/${patientId}` : '/patients'}>
              Cancelar
            </Link>
            <button className="button button-primary" disabled={submitting} type="submit">
              {submitting ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
              {submitting
                ? 'Guardando...'
                : isEditing
                  ? 'Guardar cambios'
                  : 'Guardar paciente'}
            </button>
          </div>
        </form>
      </section>
    </WorkspaceLayout>
  )
}

function PatientInput({
  error,
  help,
  label,
  max,
  name,
  onChange,
  optional,
  required,
  type = 'text',
  value,
  autoComplete,
}: {
  error?: string
  help?: string
  label: string
  max?: string
  name: string
  onChange: (value: string) => void
  optional?: boolean
  required?: boolean
  type?: string
  value: string
  autoComplete?: string
}) {
  const errorId = `${name}-error`
  const helpId = `${name}-help`

  return (
    <label className="patient-field" htmlFor={name}>
      <span>{label} {required && <b>*</b>} {optional && <small>Opcional</small>}</span>
      <input
        aria-describedby={[error ? errorId : '', help ? helpId : ''].filter(Boolean).join(' ') || undefined}
        aria-invalid={Boolean(error)}
        autoComplete={autoComplete}
        id={name}
        max={max}
        maxLength={name === 'dni' ? 12 : undefined}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
      {help && <small className="patient-field-help" id={helpId}>{help}</small>}
      {error && <small className="patient-field-error" id={errorId}>{error}</small>}
    </label>
  )
}

function patientError(error: unknown, fallback: string) {
  if (error instanceof DuplicatePatientDniError) {
    return 'Ya existe un paciente registrado con ese DNI.'
  }
  if (error instanceof PatientNotFoundError) return error.message
  if (error instanceof PatientOperationTimeoutError) {
    return 'Firebase tardó demasiado en responder. Revisá la lista antes de volver a intentar, porque la operación podría haberse completado.'
  }
  if (isPatientPermissionError(error)) {
    return firebaseOperationError(
      error,
      'Guardar paciente. Revisá que el rol y dentistId del perfil coincidan con los claims, que el DNI sea único y válido y que las reglas desplegadas acepten las escrituras atómicas de paciente, índice DNI y auditoría',
    )
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return firebaseOperationError(error, 'Guardar paciente')
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['unavailable', 'network-request-failed', 'deadline-exceeded'].includes(
      error.code.split('/').at(-1) ?? '',
    )
  ) {
    return 'No se pudo conectar con Firebase. Revisá tu conexión e intentá nuevamente.'
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['invalid-argument', 'out-of-range'].includes(error.code.split('/').at(-1) ?? '')
  ) {
    return 'Firebase rechazó los datos. Revisá los campos del formulario e intentá nuevamente.'
  }
  return fallback
}
