import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import './App.css'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/auth-context'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'

const PatientsPage = lazy(async () => {
  const module = await import('./pages/PatientsPage')
  return { default: module.PatientsPage }
})

const AgendaPage = lazy(async () => {
  const module = await import('./pages/AgendaPage')
  return { default: module.AgendaPage }
})

const ClinicalRecordsPage = lazy(async () => {
  const module = await import('./pages/ClinicalRecordsPage')
  return { default: module.ClinicalRecordsPage }
})

const FinancePage = lazy(async () => {
  const module = await import('./pages/FinancePage')
  return { default: module.FinancePage }
})

const ReferralsPage = lazy(async () => {
  const module = await import('./pages/ReferralsPage')
  return { default: module.ReferralsPage }
})

const AuditLogPage = lazy(async () => {
  const module = await import('./pages/AuditLogPage')
  return { default: module.AuditLogPage }
})

function LazyPatientsPage() {
  return (
    <Suspense
      fallback={
        <main className="state-page" aria-live="polite">
          <span className="loading-spinner" />
          <p>Cargando pacientes...</p>
        </main>
      }
    >
      <PatientsPage />
    </Suspense>
  )
}

function LazyAgendaPage() {
  return (
    <Suspense
      fallback={
        <main className="state-page" aria-live="polite">
          <span className="loading-spinner" />
          <p>Cargando agenda...</p>
        </main>
      }
    >
      <AgendaPage />
    </Suspense>
  )
}

function LazyClinicalRecordsPage() {
  return (
    <Suspense
      fallback={
        <main className="state-page" aria-live="polite">
          <span className="loading-spinner" />
          <p>Cargando historias clínicas...</p>
        </main>
      }
    >
      <ClinicalRecordsPage />
    </Suspense>
  )
}

function LazyFinancePage() {
  return (
    <Suspense fallback={<PageLoading label="Cargando finanzas..." />}>
      <FinancePage />
    </Suspense>
  )
}

function LazyReferralsPage() {
  return (
    <Suspense fallback={<PageLoading label="Cargando derivaciones..." />}>
      <ReferralsPage />
    </Suspense>
  )
}

function LazyAuditLogPage() {
  return (
    <Suspense fallback={<PageLoading label="Cargando auditoría..." />}>
      <AuditLogPage />
    </Suspense>
  )
}

function PageLoading({ label }: { label: string }) {
  return (
    <main className="state-page" aria-live="polite">
      <span className="loading-spinner" />
      <p>{label}</p>
    </main>
  )
}

function ProtectedRoute() {
  const { configured, loading, role, user } = useAuth()

  if (!configured) {
    return (
      <main className="state-page">
        <section className="state-card">
          <span className="state-icon"><span className="brand-mark">CC</span></span>
          <p className="eyebrow">Configuración necesaria</p>
          <h1>Conectá Firebase para continuar</h1>
          <p>
            Copiá <code>.env.example</code> a <code>.env.local</code>, completá la
            configuración web de Firebase y reiniciá el servidor.
          </p>
        </section>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="state-page" aria-live="polite">
        <span className="loading-spinner" />
        <p>Verificando sesión segura...</p>
      </main>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (!role) return <NoRolePage />

  return <Outlet />
}

function NoRolePage() {
  const { error, signOut, user } = useAuth()

  return (
    <main className="state-page">
      <section className="state-card">
        <span className="state-icon state-icon-warning">!</span>
        <p className="eyebrow">Acceso pendiente</p>
        <h1>No se pudo validar el acceso</h1>
        <p>
          La cuenta <strong>{user?.email}</strong> fue autenticada, pero el token
          no contiene un rol profesional y un identificador de odontólogo válidos.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-secondary" onClick={() => void signOut()}>
          Cerrar sesión
        </button>
      </section>
    </main>
  )
}

function AppRoutes() {
  const { configured, loading, role, user } = useAuth()

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate
            to={configured && !loading && user && role ? '/dashboard' : '/login'}
            replace
          />
        }
      />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/patients" element={<LazyPatientsPage />} />
        <Route path="/patients/new" element={<LazyPatientsPage />} />
        <Route path="/patients/:patientId" element={<LazyPatientsPage />} />
        <Route path="/patients/:patientId/edit" element={<LazyPatientsPage />} />
        <Route path="/agenda" element={<LazyAgendaPage />} />
        <Route path="/clinical-records" element={<LazyClinicalRecordsPage />} />
        <Route path="/clinical-records/:patientId" element={<LazyClinicalRecordsPage />} />
        <Route path="/finances" element={<LazyFinancePage />} />
        <Route path="/referrals" element={<LazyReferralsPage />} />
        <Route path="/audit" element={<LazyAuditLogPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
