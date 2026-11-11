export function firebaseErrorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code.split('/').at(-1) ?? 'unknown'
  }
  return null
}

export function firebaseOperationError(error: unknown, operation: string) {
  const code = firebaseErrorCode(error)
  if (!code) {
    return error instanceof Error
      ? error.message
      : `${operation}: ocurrió un error inesperado.`
  }

  console.error('[firebase-operation]', { operation, code })

  const details: Record<string, string> = {
    'permission-denied':
      'Firebase denegó el acceso. Verificá el rol, el perfil profesional y las reglas desplegadas.',
    unauthenticated:
      'La sesión no está autenticada o venció. Volvé a iniciar sesión.',
    'failed-precondition':
      'Firebase rechazó una precondición. Verificá los índices y la configuración requerida.',
    'not-found': 'No se encontró el recurso solicitado.',
    unavailable: 'Firebase no está disponible. Revisá la conexión e intentá nuevamente.',
    'deadline-exceeded': 'La operación agotó el tiempo de espera. Intentá nuevamente.',
    aborted: 'La operación fue interrumpida por un cambio concurrente. Intentá nuevamente.',
    'resource-exhausted': 'Firebase alcanzó un límite temporal. Intentá nuevamente más tarde.',
  }
  return `${operation}: ${details[code] ?? 'Firebase no pudo completar la operación.'} (Firebase: ${code}).`
}
