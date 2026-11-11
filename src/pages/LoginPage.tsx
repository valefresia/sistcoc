import { useState, type FormEvent } from 'react'
import { ArrowRight, LockKeyhole, ShieldCheck, Stethoscope } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'

function readableAuthError(code: string) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'El correo o la contraseña no son correctos.'
    case 'auth/too-many-requests':
      return 'Se realizaron demasiados intentos. Esperá unos minutos y volvé a probar.'
    case 'auth/network-request-failed':
      return 'No se pudo conectar con Firebase. Revisá tu conexión e intentá nuevamente.'
    case 'auth/invalid-email':
      return 'Ingresá un correo electrónico válido.'
    default:
      return 'No se pudo iniciar sesión. Revisá los datos e intentá nuevamente.'
  }
}

export function LoginPage() {
  const { configured, error: profileError, loading, role, signIn, signOut, user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (configured && !loading && user && role) return <Navigate to="/dashboard" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    if (!email.trim() || !password) {
      setFormError('Completá el correo y la contraseña.')
      return
    }

    setSubmitting(true)
    try {
      await signIn(email, password)
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : ''
      setFormError(readableAuthError(code))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-layout">
      <section className="login-intro" aria-label="Centro Odontológico Colón">
        <div className="intro-content">
          <div className="brand-lockup brand-lockup-light">
            <span className="brand-mark"><Stethoscope size={22} strokeWidth={2} /></span>
            <span>
              <strong>Centro Odontológico</strong>
              <small>Colón</small>
            </span>
          </div>
          <div className="intro-copy">
            <span className="intro-tag"><span /> Atención coordinada, en un solo lugar</span>
            <h1>Una sonrisa saludable empieza con una buena organización.</h1>
            <p>
              Acceso profesional a las agendas y a la información clínica compartida
              del centro.
            </p>
          </div>
          <div className="intro-footer">
            <span><ShieldCheck size={16} /> Acceso seguro para el equipo</span>
            <span>Gestión odontológica</span>
          </div>
        </div>
        <div className="decorative-orb decorative-orb-one" />
        <div className="decorative-orb decorative-orb-two" />
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="brand-lockup brand-lockup-mobile">
            <span className="brand-mark"><Stethoscope size={21} strokeWidth={2} /></span>
            <span>
              <strong>Centro Odontológico</strong>
              <small>Colón</small>
            </span>
          </div>

          <div className="login-heading">
            <span className="eyebrow">Portal profesional</span>
            <h2>Bienvenido/a</h2>
            <p>Ingresá con la cuenta asignada por el administrador.</p>
          </div>

          {!configured && (
            <div className="notice notice-info" role="status">
              <LockKeyhole size={18} />
              <span>
                Firebase aún no está configurado. Copiá <code>.env.example</code> a
                <code>.env.local</code>, completá los valores del proyecto y
                reiniciá Vite.
              </span>
            </div>
          )}

          {profileError && (
            <div className="notice notice-error" role="alert">{profileError}</div>
          )}

          {user && !role && !profileError && (
            <div className="notice notice-info" role="status">
              No se pudo validar un rol profesional para esta sesión. Cerrá sesión
              y volvé a ingresar después de que un administrador revise tus claims.
            </div>
          )}
          {user && !role && (
            <button
              className="button button-secondary"
              onClick={() => void signOut()}
              type="button"
            >
              Cerrar sesión y volver a ingresar
            </button>
          )}

          <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
            <label htmlFor="email">Correo electrónico</label>
            <input
              autoComplete="username"
              disabled={!configured || submitting}
              id="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nombre@centro.com"
              required
              type="email"
              value={email}
            />

            <div className="password-label">
              <label htmlFor="password">Contraseña</label>
            </div>
            <input
              autoComplete="current-password"
              disabled={!configured || submitting}
              id="password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Ingresá tu contraseña"
              required
              type="password"
              value={password}
            />

            {formError && <p className="form-error" role="alert">{formError}</p>}

            <button
              className="button button-primary login-button"
              disabled={!configured || submitting}
              type="submit"
            >
              {submitting ? 'Ingresando...' : 'Iniciar sesión'}
              {!submitting && <ArrowRight size={17} />}
            </button>
          </form>

          <div className="login-security">
            <LockKeyhole size={15} />
            <span>Tu sesión está protegida mediante Firebase Authentication.</span>
          </div>
          <p className="login-copyright">© Centro Odontológico Colón</p>
        </div>
      </section>
    </main>
  )
}
