import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canResolveReferral,
  ReferralValidationError,
  validateReferralInput,
} from '../src/lib/referral-logic.ts'

test('validates patient-linked referrals and rejects self-referrals', () => {
  assert.deepEqual(
    validateReferralInput({
      patientId: 'patient-1',
      recipientDentistId: 'marcela-castro',
      reason: 'Evaluación endodóntica',
      notes: '',
    }, 'pamela-moreira'),
    {
      patientId: 'patient-1',
      recipientDentistId: 'marcela-castro',
      reason: 'Evaluación endodóntica',
      notes: '',
    },
  )
  assert.throws(
    () => validateReferralInput({
      patientId: 'patient-1',
      recipientDentistId: 'pamela-moreira',
      reason: 'Derivación',
      notes: '',
    }, 'pamela-moreira'),
    ReferralValidationError,
  )
  assert.throws(
    () => validateReferralInput({
      patientId: 'patient-1',
      recipientDentistId: 'marcela-castro',
      reason: ' ',
      notes: '',
    }, 'pamela-moreira'),
    ReferralValidationError,
  )
})

test('all clinic professionals can resolve a pending referral, but not a closed one', () => {
  assert.equal(canResolveReferral('pending'), true)
  assert.equal(canResolveReferral('accepted'), false)
  assert.equal(canResolveReferral('rejected'), false)
})
