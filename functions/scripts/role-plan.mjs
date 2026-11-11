export function inspectRoleAssignment(definition, user, profile) {
  const expectedRole = definition.role
  const expectedDentistId = definition.dentistId
  const currentRole = user.customClaims?.role ?? null
  const currentDentistId = user.customClaims?.dentistId ?? null
  const profileExists = profile !== null
  const profileRole = profile?.role ?? null
  const profileDentistId = profile?.dentistId ?? null
  const conflicts = []

  const claimsCanMigrate =
    definition.migrateFrom === currentRole &&
    currentDentistId === expectedDentistId
  if (
    currentRole !== null &&
    currentRole !== expectedRole &&
    !claimsCanMigrate
  ) {
    conflicts.push('Los custom claims tienen un role incompatible.')
  }
  if (currentDentistId !== null && currentDentistId !== expectedDentistId) {
    conflicts.push('Los custom claims tienen un dentistId incompatible.')
  }

  const profileCanMigrate =
    definition.migrateFrom === profileRole &&
    profileDentistId === expectedDentistId
  if (profileExists) {
    if (profile.uid !== user.uid) {
      conflicts.push('El campo uid del perfil no coincide con Firebase Authentication.')
    }
    if (profileRole !== expectedRole && !profileCanMigrate) {
      conflicts.push('El role del perfil tiene un valor incompatible.')
    }
    if (profileDentistId !== expectedDentistId) {
      conflicts.push('El dentistId del perfil tiene un valor incompatible.')
    }
  }

  const alreadyConfigured =
    currentRole === expectedRole &&
    currentDentistId === expectedDentistId &&
    profileExists &&
    profile.uid === user.uid &&
    profileRole === expectedRole &&
    profileDentistId === expectedDentistId

  return {
    alreadyConfigured,
    conflicts,
    currentClaims: { role: currentRole, dentistId: currentDentistId },
    currentProfile: profileExists
      ? {
          uid: profile.uid ?? null,
          role: profileRole,
          dentistId: profileDentistId,
        }
      : null,
    action: alreadyConfigured
      ? 'sin cambios'
      : conflicts.length > 0
        ? 'bloqueado por conflicto'
        : 'sincronizar claims y perfil',
  }
}
