import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { getFirebaseFirestore } from './firebase'
import type { PatientFields } from './patient-validation'
import { preparePatientFields, normalizeDni } from './patient-validation'

export interface Patient extends PatientFields {
  id: string
  createdAt: Timestamp
  updatedAt: Timestamp
  createdBy: string
  updatedBy: string
  firstNameSearch: string
  lastNameSearch: string
  fullNameSearch: string
  auditLogId: string
}

export interface PatientPage {
  patients: Patient[]
  cursor: QueryDocumentSnapshot<DocumentData> | null
  hasMore: boolean
}

export class DuplicatePatientDniError extends Error {
  constructor() {
    super('Ya existe un paciente registrado con ese DNI.')
    this.name = 'DuplicatePatientDniError'
  }
}

export class PatientNotFoundError extends Error {
  constructor() {
    super('No encontramos el paciente solicitado.')
    this.name = 'PatientNotFoundError'
  }
}

export class PatientOperationTimeoutError extends Error {
  constructor() {
    super('Firebase no respondió dentro del tiempo esperado.')
    this.name = 'PatientOperationTimeoutError'
  }
}

const PATIENT_OPERATION_TIMEOUT_MS = 30_000

function logPatientOperationError(operation: string, error: unknown) {
  if (
    error instanceof DuplicatePatientDniError ||
    error instanceof PatientNotFoundError
  ) {
    return
  }

  const details =
    typeof error === 'object' && error !== null
      ? {
          name: 'name' in error && typeof error.name === 'string' ? error.name : 'Error',
          code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
          message:
            'message' in error && typeof error.message === 'string'
              ? error.message
                  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[correo]')
                  .replace(/\b\d{7,8}\b/g, '[DNI]')
                  .replace(/\+?[\d][\d ().-]{5,}\d/g, '[teléfono]')
              : 'Error sin detalle textual.',
        }
      : { name: 'Error', message: 'Error sin detalle textual.' }

  console.error(`[patients] Falló la operación "${operation}".`, details)
}

async function withPatientOperationTimeout<T>(
  operation: string,
  request: Promise<T>,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new PatientOperationTimeoutError()),
          PATIENT_OPERATION_TIMEOUT_MS,
        )
      }),
    ])
  } catch (error) {
    logPatientOperationError(operation, error)
    throw error
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function getDb() {
  return getFirebaseFirestore().then((db) => {
    if (!db) throw new Error('Firebase todavía no está configurado.')
    return db
  })
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .trim()
    .replace(/\s+/g, ' ')
}

function toPatient(id: string, data: DocumentData) {
  const birthDate =
    data.birthDate instanceof Timestamp
      ? data.birthDate.toDate().toISOString().slice(0, 10)
      : String(data.birthDate ?? '')
  return { id, ...data, birthDate } as Patient
}

function getSearchFields(fields: PatientFields) {
  const firstNameSearch = normalizeSearchText(fields.firstName)
  const lastNameSearch = normalizeSearchText(fields.lastName)

  return {
    firstNameSearch,
    lastNameSearch,
    fullNameSearch: `${firstNameSearch} ${lastNameSearch}`,
  }
}

function patientPayload(
  fields: PatientFields,
  auditLogId: string,
  actorUid: string,
) {
  return {
    ...fields,
    birthDate: Timestamp.fromDate(new Date(`${fields.birthDate}T00:00:00.000Z`)),
    ...getSearchFields(fields),
    auditLogId,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }
}

async function createAuditReference() {
  const db = await getDb()
  return doc(collection(db, 'auditLogs'))
}

export async function createPatient(input: PatientFields, actorUid: string) {
  const validated = preparePatientFields(input)
  if (!validated.value) return { errors: validated.errors }
  const fields = validated.value
  const db = await getDb()
  const patientRef = doc(collection(db, 'patients'))
  const dniIndexRef = doc(db, 'patientDniIndex', fields.dni)
  const auditRef = await createAuditReference()

  await withPatientOperationTimeout(
    'crear paciente',
    runTransaction(db, async (transaction) => {
      const dniIndex = await transaction.get(dniIndexRef)
      if (dniIndex.exists()) throw new DuplicatePatientDniError()

      transaction.set(patientRef, {
        ...patientPayload(fields, auditRef.id, actorUid),
        createdAt: serverTimestamp(),
        createdBy: actorUid,
      })
      transaction.set(dniIndexRef, {
        patientId: patientRef.id,
        dni: fields.dni,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
      })
      transaction.set(auditRef, {
        entity: 'patient',
        entityId: patientRef.id,
        operation: 'patient_created',
        actorUid,
        createdAt: serverTimestamp(),
      })
    })
  )

  return { patientId: patientRef.id, errors: {} }
}

export async function updatePatient(
  patientId: string,
  input: PatientFields,
  actorUid: string,
) {
  const validated = preparePatientFields(input)
  if (!validated.value) return { errors: validated.errors }
  const fields = validated.value
  const db = await getDb()
  const patientRef = doc(db, 'patients', patientId)
  const newDniIndexRef = doc(db, 'patientDniIndex', fields.dni)
  const auditRef = await createAuditReference()

  await withPatientOperationTimeout(
    'actualizar paciente',
    runTransaction(db, async (transaction) => {
      const patientSnapshot = await transaction.get(patientRef)
      if (!patientSnapshot.exists()) throw new PatientNotFoundError()

      const current = patientSnapshot.data()
      const oldDni = normalizeDni(String(current.dni ?? ''))
      const newIndexSnapshot = await transaction.get(newDniIndexRef)
      let oldDniIndexRef = null

      if (oldDni !== fields.dni) {
        oldDniIndexRef = doc(db, 'patientDniIndex', oldDni)
        const oldIndexSnapshot = await transaction.get(oldDniIndexRef)
        if (!oldIndexSnapshot.exists() || oldIndexSnapshot.data().patientId !== patientId) {
          throw new Error('No se pudo validar el DNI actual del paciente. Contactá al administrador.')
        }
        if (newIndexSnapshot.exists()) throw new DuplicatePatientDniError()
      } else if (
        !newIndexSnapshot.exists() ||
        newIndexSnapshot.data().patientId !== patientId
      ) {
        throw new Error('No se pudo validar el DNI actual del paciente. Contactá al administrador.')
      }

      transaction.update(patientRef, patientPayload(fields, auditRef.id, actorUid))
      if (oldDniIndexRef) {
        transaction.delete(oldDniIndexRef)
        transaction.set(newDniIndexRef, {
          patientId,
          dni: fields.dni,
          createdAt: serverTimestamp(),
          createdBy: actorUid,
        })
      }
      transaction.set(auditRef, {
        entity: 'patient',
        entityId: patientId,
        operation: 'patient_updated',
        actorUid,
        createdAt: serverTimestamp(),
      })
    })
  )

  return { patientId, errors: {} }
}

export async function getPatient(patientId: string) {
  const db = await getDb()
  const snapshot = await withPatientOperationTimeout(
    'consultar paciente',
    getDoc(doc(db, 'patients', patientId)),
  )
  return snapshot.exists() ? toPatient(snapshot.id, snapshot.data()) : null
}

export async function fetchPatientCount() {
  const db = await getDb()
  const result = await withPatientOperationTimeout(
    'contar pacientes',
    getCountFromServer(collection(db, 'patients')),
  )
  return result.data().count
}

export async function fetchPatientPage(
  cursor: QueryDocumentSnapshot<DocumentData> | null,
  pageSize = 30,
): Promise<PatientPage> {
  const db = await getDb()
  const patientsRef = collection(db, 'patients')
  const patientQuery = cursor
    ? query(patientsRef, orderBy('createdAt', 'desc'), startAfter(cursor), limit(pageSize))
    : query(patientsRef, orderBy('createdAt', 'desc'), limit(pageSize))
  const snapshot = await withPatientOperationTimeout(
    'cargar pacientes',
    getDocs(patientQuery),
  )
  const patients = snapshot.docs.map((document) => toPatient(document.id, document.data()))
  return {
    patients,
    cursor: snapshot.docs.at(-1) ?? cursor,
    hasMore: snapshot.docs.length === pageSize,
  }
}

export async function searchPatients(search: string) {
  const db = await getDb()
  const term = normalizeSearchText(search)
  if (!term) return []

  const digits = normalizeDni(search)
  const searchFields =
    /^\d+$/.test(digits)
      ? ['dni']
      : ['firstNameSearch', 'lastNameSearch', 'fullNameSearch']
  const patientsRef = collection(db, 'patients')
  const snapshots = await withPatientOperationTimeout(
    'buscar pacientes',
    Promise.all(
      searchFields.map((field) =>
        getDocs(
          query(
            patientsRef,
            where(field, '>=', field === 'dni' ? digits : term),
            where(field, '<=', `${field === 'dni' ? digits : term}\uf8ff`),
          ),
        ),
      ),
    ),
  )

  const matches = new Map<string, Patient>()
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      matches.set(document.id, toPatient(document.id, document.data()))
    }
  }

  return [...matches.values()].sort((left, right) =>
    `${left.lastNameSearch} ${left.firstNameSearch}`.localeCompare(
      `${right.lastNameSearch} ${right.firstNameSearch}`,
      'es',
    ),
  )
}

export function formatPatientDate(value: string | Timestamp | null | undefined) {
  if (!value) return '—'
  const date =
    typeof value === 'string'
      ? new Date(`${value}T12:00:00`)
      : value.toDate()
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(date)
}

export function isPatientPermissionError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.split('/').at(-1) === 'permission-denied'
  )
}
