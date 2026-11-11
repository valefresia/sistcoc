import {
  Activity,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  FileHeart,
  LayoutDashboard,
  LogOut,
  Share2,
  ShieldCheck,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  hasClinicAdministrationAccess,
  useAuth,
  type DentistId,
} from '../auth/auth-context'

const dentistNames: Record<DentistId, string> = {
  'blas-fresia': 'Blas Fresia',
  'pamela-moreira': 'Pamela Moreira',
  'marcela-castro': 'Marcela Castro',
}

export function WorkspaceLayout({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const { dentistId, role, signOut, user } = useAuth()
  const isAdmin = hasClinicAdministrationAccess(role, dentistId)
  const displayName = dentistId ? dentistNames[dentistId] : 'Profesional'

  const menu = [
    { label: 'Resumen', icon: LayoutDashboard, to: '/dashboard' },
    { label: 'Agenda del consultorio', icon: CalendarDays, to: '/agenda' },
    { label: 'Pacientes', icon: UsersRound, to: '/patients' },
    { label: 'Historias clínicas', icon: FileHeart, to: '/clinical-records' },
    { label: 'Derivaciones', icon: Share2, to: '/referrals' },
    { label: 'Finanzas', icon: Wallet, to: '/finances' },
    { label: 'Auditoría', icon: ClipboardList, to: '/audit' },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="brand-lockup sidebar-brand" to="/dashboard">
          <span className="brand-mark"><Activity size={21} strokeWidth={2.2} /></span>
          <span>
            <strong>Centro Odontológico</strong>
            <small>Colón</small>
          </span>
        </NavLink>

        <div className="sidebar-section-label">ESPACIO DE TRABAJO</div>
        <nav className="main-nav" aria-label="Navegación principal">
          {menu.map(({ label, icon: Icon, to }) =>
            to ? (
              <NavLink
                aria-label={label}
                className={({ isActive }) =>
                  `nav-item${isActive ? ' nav-item-active' : ''}`
                }
                end
                key={label}
                to={to}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </NavLink>
            ) : (
              <button
                className="nav-item"
                disabled
                key={label}
                title={`${label} — disponible en una próxima etapa`}
                type="button"
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
                <span className="nav-soon">Próximamente</span>
              </button>
            ),
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="security-note">
            <span className="security-note-icon"><ShieldCheck size={17} /></span>
            <div>
              <strong>Entorno protegido</strong>
              <small>Acceso según tu perfil</small>
            </div>
          </div>
          <button className="profile-button" onClick={() => void signOut()} type="button">
            <span className="avatar">{initials(displayName)}</span>
            <span className="profile-copy">
              <strong>{displayName}</strong>
              <small>{isAdmin ? 'Administración del consultorio' : 'Acceso limitado'}</small>
            </span>
            <LogOut aria-label="Cerrar sesión" className="profile-logout" size={17} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Centro Odontológico Colón</span>
            <span className="breadcrumb-separator">/</span>
            <strong>{title}</strong>
          </div>
          <button className="account-menu" onClick={() => void signOut()} type="button">
            <span className="avatar avatar-small">{initials(displayName)}</span>
            <span>{user?.email ?? displayName}</span>
            <ChevronDown size={16} />
          </button>
        </header>
        {children}
      </main>
    </div>
  )
}

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
