import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

const app = getApps().length === 0 ? initializeApp() : getApps()[0]
const auth = getAuth(app)
const db = getFirestore(app)

const dentistIds = ['pamela-moreira', 'marcela-castro'] as const
type DentistId = (typeof dentistIds)[number]

function isDentistId(value: unknown): value is DentistId {
  return typeof value === 'string' && dentistIds.includes(value as DentistId)
}

export const setUserRole = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Iniciá sesión para administrar los perfiles.')
  }

  const callerUid = request.auth.uid
  const callerDentistId = request.auth.token.dentistId
  const callerProfile = await db.collection('users').doc(callerUid).get()
  if (
    request.auth.token.role !== 'admin' ||
    callerDentistId !== 'blas-fresia' ||
    !callerProfile.exists ||
    callerProfile.data()?.uid !== callerUid ||
    callerProfile.data()?.role !== 'admin' ||
    callerProfile.data()?.dentistId !== callerDentistId
  ) {
    throw new HttpsError(
      'permission-denied',
      'Solo Blas con perfil y claims coincidentes puede administrar asignaciones de acceso.',
    )
  }

  const data = request.data as Record<string, unknown> | null
  const uid = data?.uid
  const role = data?.role
  const dentistId = data?.dentistId

  if (typeof uid !== 'string' || uid.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Se requiere el UID de una cuenta existente.')
  }

  if (role !== 'dentist' && role !== 'disabled') {
    throw new HttpsError(
      'invalid-argument',
      'El rol debe ser dentist o disabled; los administradores se configuran mediante la asignación inicial segura.',
    )
  }

  if (
    (role === 'dentist' && !isDentistId(dentistId)) ||
    (role === 'disabled' && dentistId !== null)
  ) {
    throw new HttpsError('invalid-argument', 'El profesional indicado no es válido para ese rol.')
  }

  if (uid === request.auth.uid) {
    throw new HttpsError('failed-precondition', 'No podés cambiar tu propio rol.')
  }

  let target
  try {
    target = await auth.getUser(uid)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'auth/user-not-found'
    ) {
      throw new HttpsError('not-found', 'No se encontró la cuenta de Firebase Authentication.')
    }
    console.error('Could not find account while assigning role.', error)
    throw new HttpsError('internal', 'No se pudo consultar la cuenta de destino.')
  }

  if (target.customClaims?.role === 'admin') {
    throw new HttpsError('failed-precondition', 'No se puede cambiar el perfil administrador.')
  }

  const nextClaims = {
    ...(target.customClaims ?? {}),
    role,
    dentistId: role === 'dentist' ? dentistId : null,
  }
  const previousClaims = target.customClaims ?? {}

  await auth.setCustomUserClaims(uid, nextClaims)

  try {
    await db.collection('users').doc(uid).set(
      {
        uid,
        email: target.email ?? null,
        displayName: target.displayName ?? '',
        role,
        dentistId: role === 'dentist' ? dentistId : null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid,
      },
      { merge: true },
    )
  } catch (error) {
    console.error('Could not save user profile after role assignment.', error)
    try {
      await auth.setCustomUserClaims(uid, previousClaims)
    } catch (rollbackError) {
      console.error('Could not roll back custom claims after profile write failure.', rollbackError)
    }
    throw new HttpsError('internal', 'No se pudo guardar el perfil. Intentá nuevamente.')
  }

  return { uid, role, dentistId: role === 'dentist' ? dentistId : null }
})
