import type { DentistId } from '../auth/auth-context'

export type ReferralStatus = 'pending' | 'accepted' | 'rejected'

export interface ReferralInput {
  patientId: string
  recipientDentistId: DentistId
  reason: string
  notes: string
}

export class ReferralValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferralValidationError'
  }
}

export function validateReferralInput(
  input: ReferralInput,
  actorDentistId: DentistId,
) {
  if (!input.patientId.trim() || input.patientId.includes('/')) {
    throw new ReferralValidationError('Seleccioná un paciente existente.')
  }
  if (
    !['blas-fresia', 'pamela-moreira', 'marcela-castro'].includes(input.recipientDentistId) ||
    input.recipientDentistId === actorDentistId
  ) {
    throw new ReferralValidationError('Seleccioná otro profesional del consultorio.')
  }
  const reason = input.reason.trim()
  const notes = input.notes.trim()
  if (!reason || reason.length > 1000) {
    throw new ReferralValidationError('El motivo es obligatorio y no puede superar 1000 caracteres.')
  }
  if (notes.length > 2000) {
    throw new ReferralValidationError('Las observaciones no pueden superar 2000 caracteres.')
  }
  return { ...input, reason, notes }
}

export function canResolveReferral(
  status: ReferralStatus,
) {
  return status === 'pending'
}
