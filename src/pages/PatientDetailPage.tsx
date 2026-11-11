import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  FileHeart,
  LoaderCircle,
  Pencil,
  UserRound,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import {
  PatientFilesSection,
  PatientFinanceSection,
  PatientReferralsSection,
  WhatsAppReminderLink,
} from '../components/PatientWorkspaceSections'
import {
  formatPatientDate,
  getPatient,
  isPatientPermissionError,
  type Patient,
} from '../lib/patients'

export function PatientDetailPage({ patientId }: { patientId: string }) {
  const { dentistId, user } = useAuth()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const wasUpdated = searchParams.get('updated') === '1'

  useEffect(() => {
    let active = true
    void getPatient(patientId)
      .then((record) => {
        if (active) setPatient(record)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(
          isPatientPermissionError(caught)
            ? 'Tu cuenta no tiene permisos para consultar esta ficha.'
            : 'No se pudo cargar la ficha del paciente. Intentá nuevamente.',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [patientId])

  return (
    <WorkspaceLayout title="Ficha del paciente">
      <section className="patients-content">
        <Link className="back-link" to="/patients"><ArrowLeft size={16} /> Volver a pacientes</Link>

        {wasUpdated && (
          <div className="patient-notice patient-notice-success" role="status">
            <span className="notice-check">✓</span>
            Información del paciente actualizada correctamente.
          </div>
        )}

        {loading && (
          <div className="patient-state" aria-live="polite">
            <LoaderCircle className="spin" size={22} />
            <span>Cargando ficha del paciente...</span>
          </div>
        )}

        {!loading && error && (
          <div className="patient-state patient-state-error" role="alert">
            <AlertCircle size={21} />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && !patient && (
          <div className="patient-state">
            <UserRound size={24} />
            <strong>No encontramos el paciente solicitado</strong>
            <Link className="button button-secondary" to="/patients">Ir al listado</Link>
          </div>
        )}

        {!loading && !error && patient && (
          <>
            <div className="patient-detail-header">
              <div className="patient-detail-identity">
                <span className="patient-detail-avatar">
                  {`${patient.firstName[0] ?? ''}${patient.lastName[0] ?? ''}`.toUpperCase()}
                </span>
                <div>
                  <p className="eyebrow">FICHA DEL PACIENTE</p>
                  <h1>{patient.firstName} {patient.lastName}</h1>
                  <span className="patient-detail-dni">DNI {patient.dni}</span>
                </div>
              </div>
              <Link className="button button-primary" to={`/patients/${patient.id}/edit`}>
                <Pencil size={16} />
                Editar paciente
              </Link>
            </div>

            <section className="patient-detail-card">
              <div className="patient-form-section-heading">
                <div>
                  <h2>Información personal</h2>
                  <p>Ficha compartida del Centro Odontológico Colón</p>
                </div>
              </div>
              <div className="patient-detail-grid">
                <DetailItem label="Nombre y apellido" value={`${patient.firstName} ${patient.lastName}`} />
                <DetailItem label="DNI" value={patient.dni} />
                <DetailItem label="Fecha de nacimiento" value={formatPatientDate(patient.birthDate)} />
                <DetailItem label="Teléfono" value={patient.phone} />
                <DetailItem label="Correo electrónico" value={patient.email || 'No informado'} />
                <DetailItem label="Dirección" value={patient.address || 'No informada'} />
                <DetailItem label="Fecha de registro" value={formatPatientDate(patient.createdAt)} />
                <div className="patient-detail-item patient-detail-observations">
                  <span>Observaciones generales</span>
                  <strong>{patient.observations || 'Sin observaciones generales.'}</strong>
                </div>
              </div>
            </section>

            <section className="patient-detail-card clinical-patient-entry">
              <div className="patient-form-section-heading">
                <div>
                  <h2>Historia clínica</h2>
                  <p>Consultá y registrá antecedentes, consultas odontológicas y evolución de tratamientos.</p>
                </div>
              </div>
              <div className="clinical-entry-actions">
                <Link className="button button-primary" to={`/clinical-records/${patient.id}`}>
                  <FileHeart size={17} /> Abrir historia clínica
                </Link>
                <Link className="button button-secondary" to="/agenda">
                  <CalendarDays size={17} /> Ver agenda
                </Link>
              </div>
            </section>
            {user && dentistId && (
              <>
                <section className="patient-detail-card">
                  <div className="patient-form-section-heading">
                    <div>
                      <h2>Contacto manual</h2>
                      <p>Prepará un mensaje sin enviar ni registrar el envío desde el sistema.</p>
                    </div>
                  </div>
                  <WhatsAppReminderLink
                    patientName={`${patient.firstName} ${patient.lastName}`}
                    phone={patient.phone}
                  />
                </section>
                <PatientReferralsSection
                  actorDentistId={dentistId}
                  actorUid={user.uid}
                  patientId={patient.id}
                />
                <PatientFinanceSection actorUid={user.uid} patientId={patient.id} />
                <PatientFilesSection actorUid={user.uid} patientId={patient.id} />
              </>
            )}
          </>
        )}
      </section>
    </WorkspaceLayout>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="patient-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
