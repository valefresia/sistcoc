import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveProfessionalClaims,
  resolveProfessionalProfile,
} from '../src/auth/auth-claims.ts'

test('accepts Blas claims with the current professional ID', () => {
  assert.deepEqual(
    resolveProfessionalClaims({ role: 'admin', dentistId: 'blas-fresia' }),
    { role: 'admin', dentistId: 'blas-fresia', error: null },
  )
})

test('reports missing or unsupported role claims without granting access', () => {
  const result = resolveProfessionalClaims({
    dentistId: 'blas-fresia',
  })
  assert.equal(result.role, null)
  assert.equal(result.dentistId, null)
  assert.match(result.error ?? '', /claim role válido/)
})

test('reports stale or unsupported dentist IDs without granting access', () => {
  const result = resolveProfessionalClaims({
    role: 'admin',
    dentistId: 'unknown-professional',
  })
  assert.equal(result.role, null)
  assert.equal(result.dentistId, null)
  assert.match(result.error ?? '', /claim dentistId reconocido/)
})

test('requires a matching Firestore profile before granting application access', () => {
  for (const [uid, dentistId] of [
    ['blas-uid', 'blas-fresia'],
    ['pamela-uid', 'pamela-moreira'],
    ['marcela-uid', 'marcela-castro'],
  ] as const) {
    const claims = resolveProfessionalClaims({ role: 'admin', dentistId })
    assert.deepEqual(
      resolveProfessionalProfile(claims, { uid, role: 'admin', dentistId }, uid),
      { role: 'admin', dentistId, error: null },
    )
  }

  const claims = resolveProfessionalClaims({
    role: 'admin',
    dentistId: 'marcela-castro',
  })

  const mismatchedProfile = resolveProfessionalProfile(
    claims,
    {
      uid: 'marcela-uid',
      role: 'dentist',
      dentistId: 'marcela-castro',
    },
    'marcela-uid',
  )
  assert.equal(mismatchedProfile.role, null)
  assert.match(mismatchedProfile.error ?? '', /no coincide/)

  const missingProfile = resolveProfessionalProfile(claims, undefined, 'marcela-uid')
  assert.equal(missingProfile.role, null)
  assert.match(missingProfile.error ?? '', /No existe el perfil/)
})
