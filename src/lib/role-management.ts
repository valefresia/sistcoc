import { getApp } from 'firebase/app'
import type { DentistId } from '../auth/auth-context'

export async function setProfessionalAccess(
  uid: string,
  role: 'dentist' | 'disabled',
  dentistId: DentistId | null,
) {
  const { getFunctions, httpsCallable } = await import('firebase/functions')
  const callable = httpsCallable<
    { uid: string; role: 'dentist' | 'disabled'; dentistId: DentistId | null },
    { uid: string; role: 'dentist' | 'disabled'; dentistId: DentistId | null }
  >(getFunctions(getApp()), 'setUserRole')

  await callable({ uid, role, dentistId })
}
