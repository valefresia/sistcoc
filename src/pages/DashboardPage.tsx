import { CalendarDays, ClipboardPlus, FileHeart, ShieldCheck, UsersRound } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  hasClinicAdministrationAccess,
  isBlasAdministrator,
  useAuth,
  type DentistId,
} from '../auth/auth-context'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import { setProfessionalAccess } from '../lib/role-management'

type ProfessionalDentistId = Exclude<DentistId, 'blas-fresia'>

const dentistNames: Record<DentistId, string> = {
  'blas-fresia': 'Blas Fresia',
  'pamela-moreira': 'Pamela Moreira',
  'marcela-castro': 'Marcela Castro',
}

export function DashboardPage() {
  const { dentistId, role, user } = useAuth()
  const canManageClinic = hasClinicAdministrationAccess(role, dentistId)
  const isAdmin = role === 'admin'
  const displayName = dentistId ? dentistNames[dentistId] : 'Profesional'

  return (
    <WorkspaceLayout title="Resumen">
        <section className="dashboard-content">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">PANEL DE CONTROL</p>
              <h1>Buen día, {displayName.split(' ')[0]}</h1>
              <p className="welcome-subtitle">
                {canManageClinic
                  ? 'Administrá el espacio de trabajo del centro desde un solo lugar.'
                  : 'Este es el espacio de trabajo asignado a tu perfil profesional.'}
              </p>
            </div>
            <span className={`role-badge${isAdmin ? ' role-badge-admin' : ''}`}>
              <ShieldCheck size={15} />
              {isAdmin ? 'Administrador' : 'Odontóloga'}
            </span>
          </div>

          <div className="stage-banner">
            <span className="stage-icon"><ClipboardPlus size={19} /></span>
            <div>
              <strong>Etapa 3 · Agendas y disponibilidad</strong>
              <p>Pacientes, horarios profesionales y disponibilidad del centro en un solo espacio.</p>
            </div>
            <span className="stage-status"><span /> Disponible</span>
          </div>

          <div className="section-heading">
            <div>
              <h2>Tu espacio profesional</h2>
              <p>Las funciones visibles se habilitan de acuerdo con tu rol.</p>
            </div>
          </div>

          <div className="feature-grid">
            <FeatureCard
              icon={<CalendarDays size={20} />}
              label={canManageClinic ? 'Agenda general' : 'Mi agenda'}
              detail={canManageClinic ? 'Disponibilidad, turnos y horarios del centro' : 'Horarios disponibles y turnos asignados'}
              state="Disponible"
              to="/agenda"
              linkText={canManageClinic ? 'Abrir agenda general' : 'Abrir mi agenda'}
            />
            <FeatureCard
              icon={<UsersRound size={20} />}
              label="Pacientes"
              detail="Fichas compartidas y búsqueda de pacientes"
              state="Disponible"
              to="/patients"
              linkText="Abrir pacientes"
            />
            <FeatureCard
              icon={<FileHeart size={20} />}
              label="Historias clínicas"
              detail="Registros cronológicos por paciente"
              state="Etapa 5"
            />
          </div>

          {isBlasAdministrator(role, dentistId) && <RoleAssignmentPanel />}

          <section className="account-summary">
            <div className="section-heading">
              <div>
                <h2>Cuenta y permisos</h2>
                <p>El acceso se valida en Firebase y en las reglas del servidor.</p>
              </div>
            </div>
            <div className="account-details">
              <div>
                <span>Profesional</span>
                <strong>{displayName}</strong>
              </div>
              <div>
                <span>Correo de acceso</span>
                <strong>{user?.email ?? 'No disponible'}</strong>
              </div>
              <div>
                <span>Rol</span>
                <strong>{isAdmin ? 'Administrador' : 'Odontóloga'}</strong>
              </div>
              <div>
                <span>Permisos administrativos</span>
                <strong>{canManageClinic ? 'Habilitados' : 'Restringidos'}</strong>
              </div>
            </div>
          </section>
        </section>
    </WorkspaceLayout>
  )
}

function RoleAssignmentPanel() {
  const [uid, setUid] = useState('')
  const [dentistId, setDentistId] = useState<ProfessionalDentistId>('pamela-moreira')
  const [access, setAccess] = useState<'dentist' | 'disabled'>('dentist')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    setError(null)

    try {
      await setProfessionalAccess(
        uid.trim(),
        access,
        access === 'dentist' ? dentistId : null,
      )
      setMessage(
        access === 'dentist'
          ? 'Acceso profesional asignado. La persona deberá volver a iniciar sesión.'
          : 'Acceso al sistema deshabilitado para esa cuenta.',
      )
      setUid('')
    } catch (caught) {
      const errorMessage =
        typeof caught === 'object' &&
        caught !== null &&
        'message' in caught &&
        typeof caught.message === 'string'
          ? caught.message
          : 'No se pudo actualizar el acceso. Intentá nuevamente.'
      setError(errorMessage)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="role-management">
      <div className="section-heading">
        <div>
          <h2>Acceso del equipo</h2>
          <p>Asigná o deshabilitá el perfil profesional de una cuenta existente.</p>
        </div>
      </div>
      <form className="role-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          UID de Firebase Authentication
          <input
            autoComplete="off"
            onChange={(event) => setUid(event.target.value)}
            placeholder="Pegá el UID de una cuenta existente"
            required
            value={uid}
          />
        </label>
        <label>
          Acción
          <select
            onChange={(event) => {
              if (event.target.value === 'dentist' || event.target.value === 'disabled') {
                setAccess(event.target.value)
              }
            }}
            value={access}
          >
            <option value="dentist">Habilitar como odontóloga</option>
            <option value="disabled">Deshabilitar acceso</option>
          </select>
        </label>
        {access === 'dentist' && (
          <label>
            Profesional
            <select
              onChange={(event) => {
                if (
                  event.target.value === 'pamela-moreira' ||
                  event.target.value === 'marcela-castro'
                ) {
                  setDentistId(event.target.value)
                }
              }}
              value={dentistId}
            >
              <option value="pamela-moreira">Pamela Moreira</option>
              <option value="marcela-castro">Marcela Castro</option>
            </select>
          </label>
        )}
        <button className="button button-primary" disabled={busy || !uid.trim()} type="submit">
          {busy ? 'Actualizando...' : 'Guardar acceso'}
        </button>
      </form>
      {message && <p className="role-result" role="status">{message}</p>}
      {error && <p className="role-error" role="alert">{error}</p>}
      <p className="role-help">
        Las cuentas deben crearse primero en Firebase Authentication. La función del servidor
        valida el rol y no permite promover cuentas a administrador.
      </p>
    </section>
  )
}

function FeatureCard({
  icon,
  label,
  detail,
  state,
  to,
  linkText,
}: {
  icon: ReactNode
  label: string
  detail: string
  state: string
  to?: string
  linkText?: string
}) {
  return (
    <article className="feature-card">
      <span className="feature-icon">{icon}</span>
      <span className="feature-state">{state}</span>
      <h3>{label}</h3>
      <p>{detail}</p>
      {to ? (
        <Link className="feature-link" to={to}>{linkText ?? 'Abrir'}</Link>
      ) : (
        <span className="feature-link">Se habilitará próximamente</span>
      )}
    </article>
  )
}
