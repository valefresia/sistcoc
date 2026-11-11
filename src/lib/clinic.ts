import type { DentistId } from '../auth/auth-context'

export const CLINIC_ID = 'centro-odontologico-colon'

export const CLINIC_PROFESSIONALS: ReadonlyArray<{
  dentistId: DentistId
  name: string
}> = [
  { dentistId: 'blas-fresia', name: 'Blas Fresia' },
  { dentistId: 'pamela-moreira', name: 'Pamela Moreira' },
  { dentistId: 'marcela-castro', name: 'Marcela Castro' },
]

export function professionalName(dentistId: string) {
  return CLINIC_PROFESSIONALS.find((professional) => professional.dentistId === dentistId)?.name
    ?? 'Profesional'
}

export function isClinicProfessionalProfile(
  uid: string,
  role: unknown,
  dentistId: unknown,
) {
  return Boolean(
    uid &&
      (role === 'admin' || role === 'dentist') &&
      (dentistId === 'blas-fresia' ||
        dentistId === 'pamela-moreira' ||
        dentistId === 'marcela-castro'),
  )
}
