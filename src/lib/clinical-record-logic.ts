export const MEDICAL_HISTORY_FIELDS = [
  'diseases',
  'allergies',
  'medication',
  'medicalBackground',
  'dentalBackground',
  'generalNotes',
] as const

export type MedicalHistoryField = (typeof MEDICAL_HISTORY_FIELDS)[number]
export type MedicalHistoryStatus = 'pending' | 'none_declared' | 'recorded'
export type TreatmentStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'

export interface MedicalHistoryEntry {
  status: MedicalHistoryStatus
  details: string
}

export type MedicalHistory = Record<MedicalHistoryField, MedicalHistoryEntry>

export interface ConsultationInput {
  appointmentId: string | null
  consultationDate: string
  reason: string
  diagnosis: string
  clinicalNotes: string
  treatmentIndicated: string
  treatmentPerformed: string
  recommendations: string
  nextControl: string | null
}

export interface TreatmentInput {
  name: string
  planDescription: string
}

export interface TreatmentEvolutionInput {
  date: string
  procedureDescription: string
  evolution: string
  notes: string
  status: TreatmentStatus
}

export class ClinicalRecordValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClinicalRecordValidationError'
  }
}

export function emptyMedicalHistory(): MedicalHistory {
  return Object.fromEntries(
    MEDICAL_HISTORY_FIELDS.map((field) => [
      field,
      { status: 'pending', details: '' },
    ]),
  ) as MedicalHistory
}

export function validateMedicalHistory(value: unknown): MedicalHistory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ClinicalRecordValidationError('Los antecedentes guardados tienen un formato inválido.')
  }
  const history = value as Record<string, unknown>
  if (
    Object.keys(history).length !== MEDICAL_HISTORY_FIELDS.length ||
    MEDICAL_HISTORY_FIELDS.some((field) => !(field in history))
  ) {
    throw new ClinicalRecordValidationError('Los antecedentes guardados tienen un formato inválido.')
  }
  for (const field of MEDICAL_HISTORY_FIELDS) {
    const entry = history[field] as MedicalHistoryEntry | undefined
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 2 ||
      !Object.hasOwn(entry, 'status') ||
      !Object.hasOwn(entry, 'details') ||
      !['pending', 'none_declared', 'recorded'].includes(entry.status) ||
      typeof entry.details !== 'string' ||
      entry.details.length > 2000 ||
      (entry.status === 'recorded' && !entry.details.trim()) ||
      (entry.status !== 'recorded' && entry.details.trim())
    ) {
      throw new ClinicalRecordValidationError(
        'Completá cada antecedente como pendiente, sin antecedentes declarados o registrado.',
      )
    }
  }
  return value as MedicalHistory
}

export function validateConsultationInput(
  input: ConsultationInput,
  options: {
    patientExists: boolean
    patientId: string
    professionalUid: string
    appointmentPatientId?: string
  },
): ConsultationInput {
  if (!options.patientExists) {
    throw new ClinicalRecordValidationError('El paciente seleccionado ya no existe.')
  }
  if (!options.professionalUid.trim()) {
    throw new ClinicalRecordValidationError('No se pudo identificar al profesional responsable.')
  }
  if (
    typeof input.consultationDate !== 'string' ||
    !isValidDateKey(input.consultationDate)
  ) {
    throw new ClinicalRecordValidationError('Ingresá una fecha de atención válida.')
  }
  if (input.appointmentId !== null && typeof input.appointmentId !== 'string') {
    throw new ClinicalRecordValidationError('El turno seleccionado no es válido.')
  }
  if (input.appointmentId && options.appointmentPatientId !== options.patientId) {
    throw new ClinicalRecordValidationError('El turno no corresponde al paciente seleccionado.')
  }
  if (input.appointmentId && (
    input.appointmentId.includes('/') ||
    input.appointmentId.length > 150
  )) {
    throw new ClinicalRecordValidationError('El turno seleccionado no es válido.')
  }
  const textFields: Array<[string, string, number]> = [
    ['motivo', input.reason, 1000],
    ['diagnóstico', input.diagnosis, 4000],
    ['observaciones clínicas', input.clinicalNotes, 4000],
    ['tratamiento indicado', input.treatmentIndicated, 4000],
    ['tratamiento realizado', input.treatmentPerformed, 4000],
    ['indicaciones posteriores', input.recommendations, 4000],
  ]
  for (const [label, value, maxLength] of textFields) {
    if (
      typeof value !== 'string' ||
      value.length > maxLength ||
      (['motivo', 'diagnóstico'].includes(label) && !value.trim())
    ) {
      throw new ClinicalRecordValidationError(
        `El campo ${label} es obligatorio y no puede superar ${maxLength} caracteres.`,
      )
    }
  }
  if (
    input.nextControl !== null &&
    (typeof input.nextControl !== 'string' || !isValidDateKey(input.nextControl))
  ) {
    throw new ClinicalRecordValidationError('Ingresá una fecha válida para el próximo control.')
  }
  return {
    ...input,
    appointmentId: input.appointmentId?.trim() || null,
    reason: input.reason.trim(),
    diagnosis: input.diagnosis.trim(),
    clinicalNotes: input.clinicalNotes.trim(),
    treatmentIndicated: input.treatmentIndicated.trim(),
    treatmentPerformed: input.treatmentPerformed.trim(),
    recommendations: input.recommendations.trim(),
  }
}

export function validateTreatmentInput(
  input: TreatmentInput,
  professionalUid: string,
) {
  if (!professionalUid.trim()) {
    throw new ClinicalRecordValidationError('No se pudo identificar al profesional responsable.')
  }
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 160) {
    throw new ClinicalRecordValidationError('El nombre del tratamiento es obligatorio (máximo 160 caracteres).')
  }
  if (
    typeof input.planDescription !== 'string' ||
    !input.planDescription.trim() ||
    input.planDescription.trim().length > 4000
  ) {
    throw new ClinicalRecordValidationError('La descripción del tratamiento es obligatoria (máximo 4000 caracteres).')
  }
  return { name: input.name.trim(), planDescription: input.planDescription.trim() }
}

export function validateTreatmentEvolutionInput(
  input: TreatmentEvolutionInput,
  professionalUid: string,
) {
  if (!professionalUid.trim()) {
    throw new ClinicalRecordValidationError('No se pudo identificar al profesional responsable.')
  }
  if (typeof input.date !== 'string' || !isValidDateKey(input.date)) {
    throw new ClinicalRecordValidationError('Ingresá una fecha válida para la evolución.')
  }
  if (
    typeof input.procedureDescription !== 'string' ||
    typeof input.evolution !== 'string' ||
    typeof input.notes !== 'string' ||
    !input.procedureDescription.trim() ||
    input.procedureDescription.trim().length > 2000 ||
    !input.evolution.trim() ||
    input.evolution.trim().length > 4000 ||
    input.notes.length > 2000
  ) {
    throw new ClinicalRecordValidationError('Completá el procedimiento y la evolución; revisá los límites de caracteres.')
  }
  if (!['planned', 'in_progress', 'completed', 'cancelled'].includes(input.status)) {
    throw new ClinicalRecordValidationError('El estado del tratamiento no es válido.')
  }
  return {
    ...input,
    procedureDescription: input.procedureDescription.trim(),
    evolution: input.evolution.trim(),
    notes: input.notes.trim(),
  }
}

export function isValidDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return (
    year >= 1900 &&
    new Date(Date.UTC(year, month - 1, day, 12)).toISOString().slice(0, 10) === value
  )
}

export function sortNewestFirst<T>(
  records: T[],
  getDate: (record: T) => Date,
) {
  return [...records].sort((left, right) => getDate(right).getTime() - getDate(left).getTime())
}

export function canAccessClinicalRecords(
  uid: string,
  role: 'admin' | 'dentist' | null,
  dentistId: string | null,
) {
  return Boolean(
    uid &&
      (role === 'admin' || role === 'dentist') &&
      (dentistId === 'blas-fresia' ||
        dentistId === 'pamela-moreira' ||
        dentistId === 'marcela-castro'),
  )
}
