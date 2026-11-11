import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDni, preparePatientFields } from '../src/lib/patient-validation.ts'

function validPatient(overrides: Record<string, string> = {}) {
  return {
    firstName: 'Ana',
    lastName: 'Pérez',
    dni: '12.345.678',
    birthDate: '2000-01-02',
    phone: '+54 11 1234-5678',
    email: 'ana@example.com',
    address: '',
    observations: '',
    ...overrides,
  }
}

test('normalizes DNI punctuation and spacing', () => {
  assert.equal(normalizeDni(' 12.345-678 '), '12345678')
})

test('accepts a valid patient and stores a normalized DNI', () => {
  const result = preparePatientFields(validPatient())
  assert.deepEqual(result.errors, {})
  assert.equal(result.value?.dni, '12345678')
  assert.equal(result.value?.firstName, 'Ana')
  assert.equal(result.value?.lastName, 'Pérez')
})

test('requires a valid 7- or 8-digit DNI', () => {
  const missing = preparePatientFields(validPatient({ dni: '' }))
  const malformed = preparePatientFields(validPatient({ dni: '123456789' }))

  assert.equal(missing.errors.dni, 'Ingresá el DNI.')
  assert.equal(malformed.errors.dni, 'Ingresá un DNI válido de 7 u 8 números.')
  assert.equal(malformed.value, null)
})

test('rejects missing required fields, invalid birth dates, and malformed email', () => {
  const result = preparePatientFields(
    validPatient({
      firstName: ' ',
      lastName: '',
      birthDate: '2025-02-30',
      phone: '',
      email: 'no-es-un-correo',
    }),
  )

  assert.ok(result.errors.firstName)
  assert.ok(result.errors.lastName)
  assert.ok(result.errors.birthDate)
  assert.ok(result.errors.phone)
  assert.ok(result.errors.email)
  assert.equal(result.value, null)
})

test('rejects a future birth date', () => {
  const result = preparePatientFields(validPatient({ birthDate: '2099-01-01' }))

  assert.ok(result.errors.birthDate)
  assert.equal(result.value, null)
})

test('allows an omitted email and optional address/observations', () => {
  const result = preparePatientFields(
    validPatient({ email: '', address: ' ', observations: ' ' }),
  )

  assert.deepEqual(result.errors, {})
  assert.equal(result.value?.email, '')
  assert.equal(result.value?.address, '')
  assert.equal(result.value?.observations, '')
})
