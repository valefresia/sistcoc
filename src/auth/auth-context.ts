import { createContext, useContext } from 'react'
import type { User } from 'firebase/auth'

export type UserRole = 'admin' | 'dentist'
export type DentistId = 'blas-fresia' | 'pamela-moreira' | 'marcela-castro'

export function hasClinicAdministrationAccess(
  role: UserRole | null,
  dentistId: DentistId | null,
) {
  return (
    (role === 'admin' || role === 'dentist') &&
    (dentistId === 'blas-fresia' ||
      dentistId === 'pamela-moreira' ||
      dentistId === 'marcela-castro')
  )
}

export function isBlasAdministrator(
  role: UserRole | null,
  dentistId: DentistId | null,
) {
  return role === 'admin' && dentistId === 'blas-fresia'
}

export interface AuthContextValue {
  configured: boolean
  dentistId: DentistId | null
  error: string | null
  loading: boolean
  role: UserRole | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  user: User | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe utilizarse dentro de AuthProvider.')
  return context
}
