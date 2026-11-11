import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore'
import type { DentistId, UserRole } from '../auth/auth-context'
import { getFirebaseFirestore } from './firebase'
import {
  canAccessClinicalRecords,
  ClinicalRecordValidationError,
  emptyMedicalHistory,
  validateConsultationInput,
  validateMedicalHistory,
  validateTreatmentEvolutionInput,
  validateTreatmentInput,
  type ConsultationInput,
  type MedicalHistory,
  type TreatmentEvolutionInput,
  type TreatmentInput,
  type TreatmentStatus,
} from './clinical-record-logic'
import {
  dateKeyFromDate,
  SCHEDULE_TIME_ZONE,
  zonedDateTimeToDate,
} from './schedule-logic'

export interface MedicalRecord {
  patientId: string
  medicalHistory: MedicalHistory
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
  auditLogId: string
}

export interface MedicalHistoryRevision {
  id: string
  medicalHistory: MedicalHistory
  createdAt: Date
  createdBy: string
}

export interface ClinicalConsultation extends ConsultationInput {
  id: string
  professionalUid: string
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
  auditLogId: string
}

export interface ClinicalConsultationRevision {
  id: string
  createdAt: Date
  createdBy: string
  consultation: ClinicalConsultation
}

export interface ClinicalTreatment {
  id: string
  name: string
  planDescription: string
  status: TreatmentStatus
  professionalUid: string
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
  auditLogId: string
  evolutions: TreatmentEvolution[]
}

export interface ClinicalTreatmentRevision {
  id: string
  createdAt: Date
  createdBy: string
  treatment: Omit<ClinicalTreatment, 'evolutions'>
}

export interface TreatmentEvolution {
  id: string
  date: Date
  professionalUid: string
  procedureDescription: string
  evolution: string
  notes: string
  status: TreatmentStatus
  createdAt: Date
  createdBy: string
  auditLogId: string
}

export interface ClinicalRecordDetails {
  record: MedicalRecord | null
  historyRevisions: MedicalHistoryRevision[]
  consultations: ClinicalConsultation[]
  consultationRevisions: Record<string, ClinicalConsultationRevision[]>
  treatments: ClinicalTreatment[]
  treatmentRevisions: Record<string, ClinicalTreatmentRevision[]>
}

export class ClinicalRecordNotFoundError extends Error {
  constructor() {
    super('No encontramos la historia clínica solicitada.')
    this.name = 'ClinicalRecordNotFoundError'
  }
}

export class ClinicalPatientNotFoundError extends Error {
  constructor() {
    super('No encontramos el paciente seleccionado.')
    this.name = 'ClinicalPatientNotFoundError'
  }
}

export class ClinicalProfessionalNotFoundError extends Error {
  constructor() {
    super('No se pudo validar el profesional responsable.')
    this.name = 'ClinicalProfessionalNotFoundError'
  }
}

export class DuplicateAppointmentConsultationError extends Error {
  constructor() {
    super('Ya existe una consulta clínica asociada a este turno.')
    this.name = 'DuplicateAppointmentConsultationError'
  }
}

async function getDb() {
  const db = await getFirebaseFirestore()
  if (!db) throw new Error('Firebase todavía no está configurado.')
  return db
}

function isDentistId(value: unknown): value is DentistId {
  return (
    value === 'blas-fresia' ||
    value === 'pamela-moreira' ||
    value === 'marcela-castro'
  )
}

function parseTimestamp(value: unknown) {
  if (!(value instanceof Timestamp)) {
    throw new Error('La historia clínica contiene una fecha inválida.')
  }
  return value.toDate()
}

function parseMedicalHistory(value: unknown): MedicalHistory {
  return validateMedicalHistory(value)
}

function parseMedicalRecord(patientId: string, data: DocumentData): MedicalRecord {
  if (data.patientId !== patientId || typeof data.createdBy !== 'string' || typeof data.updatedBy !== 'string') {
    throw new Error('La historia clínica guardada tiene un formato inválido.')
  }
  return {
    patientId,
    medicalHistory: parseMedicalHistory(data.medicalHistory),
    createdAt: parseTimestamp(data.createdAt),
    createdBy: data.createdBy,
    updatedAt: parseTimestamp(data.updatedAt),
    updatedBy: data.updatedBy,
    auditLogId: String(data.auditLogId ?? ''),
  }
}

function parseMedicalHistoryRevision(id: string, data: DocumentData): MedicalHistoryRevision {
  return {
    id,
    medicalHistory: parseMedicalHistory(data.medicalHistory),
    createdAt: parseTimestamp(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
  }
}

function parseConsultation(id: string, data: DocumentData): ClinicalConsultation {
  return {
    id,
    appointmentId: typeof data.appointmentId === 'string' ? data.appointmentId : null,
    professionalUid: String(data.professionalUid ?? ''),
    consultationDate: dateKeyFromDate(parseTimestamp(data.consultationDate)),
    reason: String(data.reason ?? ''),
    diagnosis: String(data.diagnosis ?? ''),
    clinicalNotes: String(data.clinicalNotes ?? ''),
    treatmentIndicated: String(data.treatmentIndicated ?? ''),
    treatmentPerformed: String(data.treatmentPerformed ?? ''),
    recommendations: String(data.recommendations ?? ''),
    nextControl:
      data.nextControl instanceof Timestamp
        ? dateKeyFromDate(data.nextControl.toDate())
        : null,
    createdAt: parseTimestamp(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    updatedAt: parseTimestamp(data.updatedAt),
    updatedBy: String(data.updatedBy ?? ''),
    auditLogId: String(data.auditLogId ?? ''),
  }
}

function parseConsultationRevision(
  id: string,
  consultationId: string,
  data: DocumentData,
): ClinicalConsultationRevision {
  if (!data.consultation || typeof data.consultation !== 'object') {
    throw new Error('La revisión de consulta contiene un formato inválido.')
  }
  return {
    id,
    createdAt: parseTimestamp(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    consultation: parseConsultation(consultationId, data.consultation as DocumentData),
  }
}

function parseEvolution(id: string, data: DocumentData): TreatmentEvolution {
  if (!isTreatmentStatus(data.status)) {
    throw new Error('La evolución guardada tiene un estado inválido.')
  }
  return {
    id,
    date: parseTimestamp(data.date),
    professionalUid: String(data.professionalUid ?? ''),
    procedureDescription: String(data.procedureDescription ?? ''),
    evolution: String(data.evolution ?? ''),
    notes: String(data.notes ?? ''),
    status: data.status,
    createdAt: parseTimestamp(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    auditLogId: String(data.auditLogId ?? ''),
  }
}

function parseTreatment(id: string, data: DocumentData): Omit<ClinicalTreatment, 'evolutions'> {
  if (!isTreatmentStatus(data.status)) {
    throw new Error('El tratamiento guardado tiene un estado inválido.')
  }
  return {
    id,
    name: String(data.name ?? ''),
    planDescription: String(data.planDescription ?? ''),
    status: data.status,
    professionalUid: String(data.professionalUid ?? ''),
    createdAt: parseTimestamp(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    updatedAt: parseTimestamp(data.updatedAt),
    updatedBy: String(data.updatedBy ?? ''),
    auditLogId: String(data.auditLogId ?? ''),
  }
}

function parseTreatmentRevision(
  id: string,
  treatmentId: string,
  data: DocumentData,
): ClinicalTreatmentRevision {
  if (!data.treatment || typeof data.treatment !== 'object') {
    throw new Error('La revisión del tratamiento contiene un formato inválido.')
  }
  return {
    id,
    createdAt: parseTimestamp(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    treatment: parseTreatment(treatmentId, data.treatment as DocumentData),
  }
}

function isTreatmentStatus(value: unknown): value is TreatmentStatus {
  return ['planned', 'in_progress', 'completed', 'cancelled'].includes(String(value))
}

function auditRef(db: Awaited<ReturnType<typeof getDb>>) {
  return doc(collection(db, 'auditLogs'))
}

function auditPayload(
  entity: string,
  entityId: string,
  operation: string,
  actorUid: string,
) {
  return {
    entity,
    entityId,
    operation,
    actorUid,
    createdAt: serverTimestamp(),
  }
}

function recordPayload(
  patientId: string,
  medicalHistory: MedicalHistory,
  logId: string,
  actorUid: string,
) {
  return {
    patientId,
    medicalHistory,
    auditLogId: logId,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }
}

export async function getMedicalRecord(patientId: string) {
  const db = await getDb()
  const snapshot = await getDoc(doc(db, 'medicalRecords', patientId))
  return snapshot.exists() ? parseMedicalRecord(patientId, snapshot.data()) : null
}

export async function hasMedicalRecord(patientId: string) {
  const db = await getDb()
  const snapshot = await getDoc(doc(db, 'medicalRecords', patientId))
  return snapshot.exists()
}

export async function createMedicalRecord(patientId: string, actorUid: string) {
  const db = await getDb()
  const recordRef = doc(db, 'medicalRecords', patientId)
  const logRef = auditRef(db)

  await runTransaction(db, async (transaction) => {
    const [patientSnapshot, recordSnapshot, actorSnapshot] = await Promise.all([
      transaction.get(doc(db, 'patients', patientId)),
      transaction.get(recordRef),
      transaction.get(doc(db, 'users', actorUid)),
    ])
    if (!patientSnapshot.exists()) throw new ClinicalPatientNotFoundError()
    const actor = actorSnapshot.data()
    if (!actorSnapshot.exists() || !isAuthorizedUser(actor?.role, actor?.dentistId, actorUid)) {
      throw new ClinicalProfessionalNotFoundError()
    }
    if (recordSnapshot.exists()) return

    transaction.set(recordRef, {
      ...recordPayload(patientId, emptyMedicalHistory(), logRef.id, actorUid),
      createdAt: serverTimestamp(),
      createdBy: actorUid,
    })
    transaction.set(logRef, auditPayload('medicalRecord', patientId, 'history_created', actorUid))
  })
}

export async function updateMedicalHistory(
  patientId: string,
  history: MedicalHistory,
  actorUid: string,
) {
  const validatedHistory = validateMedicalHistory(history)
  const db = await getDb()
  const recordRef = doc(db, 'medicalRecords', patientId)
  const logRef = auditRef(db)
  const revisionRef = doc(collection(recordRef, 'historyRevisions'), logRef.id)

  await runTransaction(db, async (transaction) => {
    const [patientSnapshot, recordSnapshot, actorSnapshot] = await Promise.all([
      transaction.get(doc(db, 'patients', patientId)),
      transaction.get(recordRef),
      transaction.get(doc(db, 'users', actorUid)),
    ])
    if (!patientSnapshot.exists()) throw new ClinicalPatientNotFoundError()
    if (!recordSnapshot.exists()) throw new ClinicalRecordNotFoundError()
    const actor = actorSnapshot.data()
    if (!actorSnapshot.exists() || !isAuthorizedUser(actor?.role, actor?.dentistId, actorUid)) {
      throw new ClinicalProfessionalNotFoundError()
    }
    const previous = parseMedicalRecord(patientId, recordSnapshot.data())

    transaction.set(revisionRef, {
      patientId,
      medicalHistory: previous.medicalHistory,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.update(recordRef, recordPayload(patientId, validatedHistory, logRef.id, actorUid))
    transaction.set(
      logRef,
      auditPayload(
        'medicalRecord',
        `${patientId}/historyRevisions/${revisionRef.id}`,
        'history_updated',
        actorUid,
      ),
    )
  })
}

export async function createConsultation(
  patientId: string,
  input: ConsultationInput,
  actorUid: string,
) {
  const db = await getDb()
  const recordRef = doc(db, 'medicalRecords', patientId)
  const logRef = auditRef(db)
  const consultationsRef = collection(recordRef, 'consultations')
  const consultationId = input.appointmentId
    ? `appointment-${input.appointmentId}`
    : doc(consultationsRef).id
  const consultationRef = doc(consultationsRef, consultationId)

  await runTransaction(db, async (transaction) => {
    const patientRef = doc(db, 'patients', patientId)
    const appointmentRef = input.appointmentId
      ? doc(db, 'appointments', input.appointmentId)
      : null
    const [patientSnapshot, recordSnapshot, actorSnapshot, appointmentSnapshot, existingConsultation] =
      await Promise.all([
        transaction.get(patientRef),
        transaction.get(recordRef),
        transaction.get(doc(db, 'users', actorUid)),
        appointmentRef ? transaction.get(appointmentRef) : Promise.resolve(null),
        transaction.get(consultationRef),
      ])
    if (!patientSnapshot.exists()) throw new ClinicalPatientNotFoundError()
    if (existingConsultation.exists()) throw new DuplicateAppointmentConsultationError()
    if (!recordSnapshot.exists()) throw new ClinicalRecordNotFoundError()
    const actor = actorSnapshot.data()
    if (!actorSnapshot.exists() || !isAuthorizedUser(actor?.role, actor?.dentistId, actorUid)) {
      throw new ClinicalProfessionalNotFoundError()
    }
    const appointmentData = appointmentSnapshot?.data()
    if (appointmentRef && (!appointmentSnapshot?.exists() ||
        appointmentData?.patientId !== patientId)) {
      throw new ClinicalRecordValidationError('El turno no corresponde al paciente seleccionado.')
    }
    const validated = validateConsultationInput(input, {
      patientExists: true,
      patientId,
      professionalUid: actorUid,
      appointmentPatientId: appointmentRef ? appointmentData?.patientId : undefined,
    })
    const consultationDate = Timestamp.fromDate(
      zonedDateTimeToDate(validated.consultationDate, '12:00', SCHEDULE_TIME_ZONE),
    )
    const nextControl = validated.nextControl
      ? Timestamp.fromDate(zonedDateTimeToDate(validated.nextControl, '12:00', SCHEDULE_TIME_ZONE))
      : null

    transaction.set(consultationRef, {
      ...validated,
      consultationDate,
      nextControl,
      professionalUid: actorUid,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.set(
      logRef,
      auditPayload(
        'consultation',
        `${patientId}/consultations/${consultationId}`,
        'consultation_created',
        actorUid,
      ),
    )
  })
}

export async function updateConsultation(
  patientId: string,
  consultationId: string,
  input: ConsultationInput,
  actorUid: string,
) {
  const db = await getDb()
  const recordRef = doc(db, 'medicalRecords', patientId)
  const consultationRef = doc(collection(recordRef, 'consultations'), consultationId)
  const logRef = auditRef(db)
  const revisionRef = doc(collection(consultationRef, 'revisions'), logRef.id)

  await runTransaction(db, async (transaction) => {
    const appointmentRef = input.appointmentId
      ? doc(db, 'appointments', input.appointmentId)
      : null
    const [patientSnapshot, recordSnapshot, actorSnapshot, consultationSnapshot, appointmentSnapshot] =
      await Promise.all([
        transaction.get(doc(db, 'patients', patientId)),
        transaction.get(recordRef),
        transaction.get(doc(db, 'users', actorUid)),
        transaction.get(consultationRef),
        appointmentRef ? transaction.get(appointmentRef) : Promise.resolve(null),
      ])
    if (!patientSnapshot.exists()) throw new ClinicalPatientNotFoundError()
    if (!recordSnapshot.exists()) throw new ClinicalRecordNotFoundError()
    if (!consultationSnapshot.exists()) throw new ClinicalRecordNotFoundError()
    const actor = actorSnapshot.data()
    if (!actorSnapshot.exists() || !isAuthorizedUser(actor?.role, actor?.dentistId, actorUid)) {
      throw new ClinicalProfessionalNotFoundError()
    }
    const appointmentData = appointmentSnapshot?.data()
    if (appointmentRef && (!appointmentSnapshot?.exists() || appointmentData?.patientId !== patientId)) {
      throw new ClinicalRecordValidationError('El turno no corresponde al paciente seleccionado.')
    }
    const validated = validateConsultationInput(input, {
      patientExists: true,
      patientId,
      professionalUid: actorUid,
      appointmentPatientId: appointmentRef ? appointmentData?.patientId : undefined,
    })
    const previous = consultationSnapshot.data()
    if (input.appointmentId !== (typeof previous.appointmentId === 'string' ? previous.appointmentId : null)) {
      throw new ClinicalRecordValidationError('No se puede cambiar el turno asociado a una consulta existente.')
    }
    const consultationDate = Timestamp.fromDate(
      zonedDateTimeToDate(validated.consultationDate, '12:00', SCHEDULE_TIME_ZONE),
    )
    const nextControl = validated.nextControl
      ? Timestamp.fromDate(zonedDateTimeToDate(validated.nextControl, '12:00', SCHEDULE_TIME_ZONE))
      : null

    transaction.set(revisionRef, {
      patientId,
      consultation: previous,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.update(consultationRef, {
      ...validated,
      consultationDate,
      nextControl,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.set(
      logRef,
      auditPayload('consultation', `${patientId}/consultations/${consultationId}`, 'consultation_updated', actorUid),
    )
  })
}

export async function createTreatment(
  patientId: string,
  input: TreatmentInput,
  actorUid: string,
) {
  const validated = validateTreatmentInput(input, actorUid)
  const db = await getDb()
  const recordRef = doc(db, 'medicalRecords', patientId)
  const treatmentRef = doc(collection(recordRef, 'treatments'))
  const logRef = auditRef(db)

  await runTransaction(db, async (transaction) => {
    const [patientSnapshot, recordSnapshot, actorSnapshot] = await Promise.all([
      transaction.get(doc(db, 'patients', patientId)),
      transaction.get(recordRef),
      transaction.get(doc(db, 'users', actorUid)),
    ])
    if (!patientSnapshot.exists()) throw new ClinicalPatientNotFoundError()
    if (!recordSnapshot.exists()) throw new ClinicalRecordNotFoundError()
    const actor = actorSnapshot.data()
    if (!actorSnapshot.exists() || !isAuthorizedUser(actor?.role, actor?.dentistId, actorUid)) {
      throw new ClinicalProfessionalNotFoundError()
    }
    transaction.set(treatmentRef, {
      ...validated,
      status: 'planned',
      professionalUid: actorUid,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.set(
      logRef,
      auditPayload(
        'treatment',
        `${patientId}/treatments/${treatmentRef.id}`,
        'treatment_created',
        actorUid,
      ),
    )
  })
}

export async function updateTreatmentPlan(
  patientId: string,
  treatmentId: string,
  input: TreatmentInput,
  actorUid: string,
) {
  const validated = validateTreatmentInput(input, actorUid)
  const db = await getDb()
  const recordRef = doc(db, 'medicalRecords', patientId)
  const treatmentRef = doc(collection(recordRef, 'treatments'), treatmentId)
  const logRef = auditRef(db)
  const revisionRef = doc(collection(treatmentRef, 'revisions'), logRef.id)

  await runTransaction(db, async (transaction) => {
    const [patientSnapshot, recordSnapshot, actorSnapshot, treatmentSnapshot] = await Promise.all([
      transaction.get(doc(db, 'patients', patientId)),
      transaction.get(recordRef),
      transaction.get(doc(db, 'users', actorUid)),
      transaction.get(treatmentRef),
    ])
    if (!patientSnapshot.exists()) throw new ClinicalPatientNotFoundError()
    if (!recordSnapshot.exists() || !treatmentSnapshot.exists()) throw new ClinicalRecordNotFoundError()
    const actor = actorSnapshot.data()
    if (!actorSnapshot.exists() || !isAuthorizedUser(actor?.role, actor?.dentistId, actorUid)) {
      throw new ClinicalProfessionalNotFoundError()
    }
    transaction.set(revisionRef, {
      patientId,
      treatment: treatmentSnapshot.data(),
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.update(treatmentRef, {
      ...validated,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.set(
      logRef,
      auditPayload('treatment', `${patientId}/treatments/${treatmentId}`, 'treatment_updated', actorUid),
    )
  })
}

export async function addTreatmentEvolution(
  patientId: string,
  treatmentId: string,
  input: TreatmentEvolutionInput,
  actorUid: string,
) {
  const validated = validateTreatmentEvolutionInput(input, actorUid)
  const db = await getDb()
  const recordRef = doc(db, 'medicalRecords', patientId)
  const treatmentRef = doc(collection(recordRef, 'treatments'), treatmentId)
  const evolutionRef = doc(collection(treatmentRef, 'evolutions'))
  const logRef = auditRef(db)

  await runTransaction(db, async (transaction) => {
    const [patientSnapshot, recordSnapshot, actorSnapshot, treatmentSnapshot] =
      await Promise.all([
        transaction.get(doc(db, 'patients', patientId)),
        transaction.get(recordRef),
        transaction.get(doc(db, 'users', actorUid)),
        transaction.get(treatmentRef),
      ])
    if (!patientSnapshot.exists()) throw new ClinicalPatientNotFoundError()
    if (!recordSnapshot.exists()) throw new ClinicalRecordNotFoundError()
    if (!treatmentSnapshot.exists()) throw new ClinicalRecordNotFoundError()
    const actor = actorSnapshot.data()
    if (!actorSnapshot.exists() || !isAuthorizedUser(actor?.role, actor?.dentistId, actorUid)) {
      throw new ClinicalProfessionalNotFoundError()
    }
    const date = Timestamp.fromDate(
      zonedDateTimeToDate(validated.date, '12:00', SCHEDULE_TIME_ZONE),
    )
    const revisionRef = doc(collection(treatmentRef, 'revisions'), logRef.id)
    transaction.set(revisionRef, {
      patientId,
      treatment: treatmentSnapshot.data(),
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.update(treatmentRef, {
      status: validated.status,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.set(evolutionRef, {
      date,
      professionalUid: actorUid,
      procedureDescription: validated.procedureDescription,
      evolution: validated.evolution,
      notes: validated.notes,
      status: validated.status,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      auditLogId: logRef.id,
    })
    transaction.set(
      logRef,
      auditPayload(
        'treatmentEvolution',
        `${patientId}/treatments/${treatmentId}/evolutions/${evolutionRef.id}`,
        'treatment_evolution_recorded',
        actorUid,
      ),
    )
  })
}

export async function getClinicalRecordDetails(patientId: string): Promise<ClinicalRecordDetails> {
  const db = await getDb()
  const recordRef = doc(db, 'medicalRecords', patientId)
  const recordSnapshot = await getDoc(recordRef)
  if (!recordSnapshot.exists()) {
    return {
      record: null,
      historyRevisions: [],
      consultations: [],
      consultationRevisions: {},
      treatments: [],
      treatmentRevisions: {},
    }
  }
  const [consultationSnapshot, treatmentSnapshot] = await Promise.all([
    getDocs(query(collection(recordRef, 'consultations'), orderBy('consultationDate', 'desc'))),
    getDocs(query(collection(recordRef, 'treatments'), orderBy('updatedAt', 'desc'))),
  ])
  const [historyRevisionSnapshot, treatments] = await Promise.all([
    getDocs(query(collection(recordRef, 'historyRevisions'), orderBy('createdAt', 'desc'))),
    Promise.all(
      treatmentSnapshot.docs.map(async (document) => {
        const treatment = parseTreatment(document.id, document.data())
        const evolutions = await getDocs(
          query(collection(document.ref, 'evolutions'), orderBy('date', 'desc')),
        )
        return {
          ...treatment,
          evolutions: evolutions.docs.map((evolution) =>
            parseEvolution(evolution.id, evolution.data()),
          ),
        }
      }),
    ),
  ])
  const consultationRevisions = Object.fromEntries(
    await Promise.all(
      consultationSnapshot.docs.map(async (document) => {
        const revisions = await getDocs(
          query(collection(document.ref, 'revisions'), orderBy('createdAt', 'desc')),
        )
        return [
          document.id,
          revisions.docs.map((revision) =>
            parseConsultationRevision(revision.id, document.id, revision.data()),
          ),
        ] as const
      }),
    ),
  )
  const treatmentRevisions = Object.fromEntries(
    await Promise.all(
      treatmentSnapshot.docs.map(async (document) => {
        const revisions = await getDocs(
          query(collection(document.ref, 'revisions'), orderBy('createdAt', 'desc')),
        )
        return [
          document.id,
          revisions.docs.map((revision) =>
            parseTreatmentRevision(revision.id, document.id, revision.data()),
          ),
        ] as const
      }),
    ),
  )
  return {
    record: parseMedicalRecord(patientId, recordSnapshot.data()),
    historyRevisions: historyRevisionSnapshot.docs.map((revision) =>
      parseMedicalHistoryRevision(revision.id, revision.data()),
    ),
    consultations: consultationSnapshot.docs.map((document) =>
      parseConsultation(document.id, document.data()),
    ),
    consultationRevisions,
    treatments,
    treatmentRevisions,
  }
}

function isAuthorizedUser(role: unknown, dentistId: unknown, uid: string) {
  return (
    isDentistId(dentistId) &&
    (role === 'admin' || role === 'dentist') &&
    canAccessClinicalRecords(uid, role as UserRole, dentistId)
  )
}
