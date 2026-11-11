import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAccessClinicalRecords,
  ClinicalRecordValidationError,
  emptyMedicalHistory,
  isValidDateKey,
  sortNewestFirst,
  validateConsultationInput,
  validateMedicalHistory,
  validateTreatmentEvolutionInput,
  validateTreatmentInput,
  type ConsultationInput,
  type MedicalHistory,
} from '../src/lib/clinical-record-logic.ts'

const validConsultation: ConsultationInput = {
  appointmentId: null,
  consultationDate: '2026-03-10',
  reason: 'Control',
  diagnosis: 'Sin hallazgos agudos',
  clinicalNotes: '',
  treatmentIndicated: '',
  treatmentPerformed: '',
  recommendations: '',
  nextControl: null,
}

test('starts every history section as pending and validates the three explicit states', () => {
  const history = emptyMedicalHistory()
  assert.ok(Object.values(history).every((entry) => entry.status === 'pending' && entry.details === ''))
  assert.equal(validateMedicalHistory(history), history)

  const completedHistory: MedicalHistory = {
    ...history,
    allergies: { status: 'none_declared', details: '' },
    diseases: { status: 'recorded', details: 'Hipertensión controlada' },
  }
  assert.equal(validateMedicalHistory(completedHistory), completedHistory)
  assert.throws(
    () => validateMedicalHistory({ ...completedHistory, medication: { status: 'recorded', details: '' } }),
    ClinicalRecordValidationError,
  )
  assert.throws(
    () => validateMedicalHistory({ ...completedHistory, extra: { status: 'pending', details: '' } }),
    ClinicalRecordValidationError,
  )
  assert.throws(() => validateMedicalHistory(null), ClinicalRecordValidationError)
})

test('validates consultation patient, professional, date and appointment association', () => {
  const options = {
    patientExists: true,
    patientId: 'patient-test',
    professionalUid: 'professional-test',
  }
  assert.equal(
    validateConsultationInput(validConsultation, options).reason,
    'Control',
  )
  assert.throws(
    () => validateConsultationInput(validConsultation, { ...options, patientExists: false }),
    /paciente seleccionado ya no existe/,
  )
  assert.throws(
    () => validateConsultationInput(validConsultation, { ...options, professionalUid: '' }),
    /profesional responsable/,
  )
  assert.throws(
    () => validateConsultationInput({ ...validConsultation, consultationDate: '2026-02-29' }, options),
    /fecha de atención válida/,
  )
  assert.throws(
    () =>
      validateConsultationInput(
        { ...validConsultation, appointmentId: 'appointment-1' },
        { ...options, appointmentPatientId: 'another-patient' },
      ),
    /no corresponde al paciente/,
  )
  assert.throws(
    () =>
      validateConsultationInput(
        { ...validConsultation, appointmentId: 'appointment/invalid' },
        { ...options, appointmentPatientId: options.patientId },
      ),
    /turno seleccionado no es válido/,
  )
})

test('requires a valid reason and diagnosis and accepts valid next-control dates', () => {
  assert.throws(
    () => validateConsultationInput({ ...validConsultation, reason: ' ' }, {
      patientExists: true,
      patientId: 'patient-test',
      professionalUid: 'professional-test',
    }),
    /motivo es obligatorio/,
  )
  assert.throws(
    () => validateConsultationInput({ ...validConsultation, diagnosis: '' }, {
      patientExists: true,
      patientId: 'patient-test',
      professionalUid: 'professional-test',
    }),
    /diagnóstico es obligatorio/,
  )
  assert.throws(
    () => validateConsultationInput({ ...validConsultation, nextControl: '2026-02-30' }, {
      patientExists: true,
      patientId: 'patient-test',
      professionalUid: 'professional-test',
    }),
    /próximo control/,
  )
  assert.equal(isValidDateKey('2024-02-29'), true)
  assert.equal(isValidDateKey('2026-02-29'), false)
})

test('validates treatment plans and chronological evolution details', () => {
  assert.deepEqual(
    validateTreatmentInput({ name: '  Restauración ', planDescription: '  Pieza 16 ' }, 'professional-test'),
    { name: 'Restauración', planDescription: 'Pieza 16' },
  )
  assert.throws(
    () => validateTreatmentInput({ name: ' ', planDescription: 'Plan' }, 'professional-test'),
    /nombre del tratamiento es obligatorio/,
  )
  assert.deepEqual(
    validateTreatmentEvolutionInput({
      date: '2026-03-10',
      procedureDescription: 'Restauración pieza 16',
      evolution: 'Procedimiento realizado',
      notes: '',
      status: 'completed',
    }, 'professional-test').status,
    'completed',
  )
  assert.throws(
    () =>
      validateTreatmentEvolutionInput({
        date: '2026-03-10',
        procedureDescription: '',
        evolution: 'Realizado',
        notes: '',
        status: 'completed',
      }, 'professional-test'),
    /procedimiento y la evolución/,
  )
  assert.throws(
    () =>
      validateTreatmentEvolutionInput({
        date: '2026-03-10',
        procedureDescription: 'Control',
        evolution: 'Realizado',
        notes: '',
        status: 'invalid' as 'completed',
      }, 'professional-test'),
    /estado del tratamiento/,
  )
})

test('grants clinical access to all supported role and professional combinations', () => {
  assert.equal(canAccessClinicalRecords('blas-uid', 'admin', 'blas-fresia'), true)
  assert.equal(canAccessClinicalRecords('pamela-uid', 'dentist', 'pamela-moreira'), true)
  assert.equal(canAccessClinicalRecords('marcela-uid', 'dentist', 'marcela-castro'), true)
  assert.equal(canAccessClinicalRecords('pamela-uid', 'admin', 'pamela-moreira'), true)
  assert.equal(canAccessClinicalRecords('blas-uid', 'dentist', 'blas-fresia'), true)
  assert.equal(canAccessClinicalRecords('other-uid', 'dentist', 'other-dentist'), false)
  assert.equal(canAccessClinicalRecords('other-uid', null, 'pamela-moreira'), false)
  assert.equal(canAccessClinicalRecords('', 'admin', 'blas-fresia'), false)

  const ordered = sortNewestFirst(
    [{ date: new Date('2026-03-01') }, { date: new Date('2026-03-10') }],
    (record) => record.date,
  )
  assert.deepEqual(ordered.map((record) => record.date.toISOString().slice(0, 10)), [
    '2026-03-10',
    '2026-03-01',
  ])
})
