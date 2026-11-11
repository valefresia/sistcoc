import assert from 'node:assert/strict'
import test from 'node:test'
import { firebaseErrorCode, firebaseOperationError } from '../src/lib/firebase-errors.ts'

test('extracts Firebase codes without exposing underlying error details', () => {
  const error = {
    code: 'firestore/permission-denied',
    message: 'private server response',
  }
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    assert.equal(firebaseErrorCode(error), 'permission-denied')
    const message = firebaseOperationError(error, 'Consultar agenda')
    assert.match(message, /Consultar agenda/)
    assert.match(message, /permission-denied/)
    assert.doesNotMatch(message, /private server response/)
  } finally {
    console.error = originalConsoleError
  }
})

test('distinguishes unauthenticated, failed precondition, missing resource and connectivity errors', () => {
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    for (const [code, expected] of [
      ['unauthenticated', /iniciar sesión/],
      ['failed-precondition', /índices/],
      ['not-found', /No se encontró/],
      ['unavailable', /no está disponible/],
    ] as const) {
      assert.match(
        firebaseOperationError({ code: `firebase/${code}` }, 'Leer datos'),
        expected,
      )
    }
  } finally {
    console.error = originalConsoleError
  }
})
