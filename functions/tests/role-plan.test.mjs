import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectRoleAssignment } from '../scripts/role-plan.mjs'

const pamela = {
  displayName: 'Pamela Moreira',
  role: 'admin',
  dentistId: 'pamela-moreira',
  migrateFrom: 'dentist',
}

test('reports migration from the expected prior dentist role without conflicting values', () => {
  const plan = inspectRoleAssignment(
    pamela,
    {
      uid: 'pamela-uid',
      customClaims: { role: 'dentist', dentistId: 'pamela-moreira' },
    },
    { uid: 'pamela-uid', role: 'dentist', dentistId: 'pamela-moreira' },
  )

  assert.equal(plan.action, 'sincronizar claims y perfil')
  assert.deepEqual(plan.conflicts, [])
})

test('detects mismatched claims, profile fields, and UID without treating them as migratable', () => {
  const plan = inspectRoleAssignment(
    pamela,
    {
      uid: 'pamela-uid',
      customClaims: { role: 'admin', dentistId: 'marcela-castro' },
    },
    { uid: 'other-uid', role: 'admin', dentistId: 'marcela-castro' },
  )

  assert.equal(plan.action, 'bloqueado por conflicto')
  assert.equal(plan.conflicts.length, 3)
})

test('reports already synchronized accounts without proposing writes', () => {
  const plan = inspectRoleAssignment(
    pamela,
    {
      uid: 'pamela-uid',
      customClaims: { role: 'admin', dentistId: 'pamela-moreira' },
    },
    { uid: 'pamela-uid', role: 'admin', dentistId: 'pamela-moreira' },
  )

  assert.equal(plan.alreadyConfigured, true)
  assert.equal(plan.action, 'sin cambios')
})
