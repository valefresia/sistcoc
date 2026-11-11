import type { DentistId, UserRole } from './auth-context'

const validDentistIds = new Set<DentistId>([
  'blas-fresia',
  'pamela-moreira',
  'marcela-castro',
])

export function resolveProfessionalClaims(claims: Record<string, unknown>) {
  const role = claims.role
  const dentistId = claims.dentistId

  if (role !== 'admin' && role !== 'dentist') {
    return {
      role: null,
      dentistId: null,
      error:
        'El token de Firebase no contiene un claim role válido (admin o dentist). El perfil de Firestore no reemplaza este claim.',
    } as const
  }

  if (typeof dentistId !== 'string' || !validDentistIds.has(dentistId as DentistId)) {
    return {
      role: null,
      dentistId: null,
      error:
        'El token de Firebase no contiene un claim dentistId reconocido. Para Blas debe ser blas-fresia; cerrá sesión y volvé a ingresar después de actualizar los claims.',
    } as const
  }

  return {
    role: role as UserRole,
    dentistId: dentistId as DentistId,
    error: null,
  } as const
}

export function resolveProfessionalProfile(
  claims: ReturnType<typeof resolveProfessionalClaims>,
  profile: Record<string, unknown> | undefined,
  uid: string,
) {
  if (claims.error) {
    const profileContext = !profile
      ? 'No se encontró el documento users/{uid}.'
      : profile.uid !== uid
        ? 'El campo uid del perfil no coincide con la cuenta autenticada.'
        : `Perfil Firestore actual: role=${String(profile.role ?? 'ausente')}, dentistId=${String(profile.dentistId ?? 'ausente')}.`

    return {
      ...claims,
      error: `${claims.error} ${profileContext}`,
    } as const
  }

  if (!profile) {
    return {
      role: null,
      dentistId: null,
      error: 'No existe el perfil profesional correspondiente en users/{uid}.',
    } as const
  }

  if (
    profile.uid !== uid ||
    profile.role !== claims.role ||
    profile.dentistId !== claims.dentistId
  ) {
    return {
      role: null,
      dentistId: null,
      error:
        'El perfil users/{uid} no coincide con el UID, role y dentistId del token de Firebase. Un administrador debe sincronizar el perfil y los claims.',
    } as const
  }

  return claims
}
