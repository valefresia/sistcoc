import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type DocumentData,
} from 'firebase/firestore'
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
  type FirebaseStorage,
  type StorageReference,
} from 'firebase/storage'
import { getFirebaseFirestore, getFirebaseStorage } from './firebase'
import { CLINIC_ID, isClinicProfessionalProfile } from './clinic'

export const MAX_PATIENT_FILE_BYTES = 100 * 1024 * 1024

const fileTypes = {
  pdf: { contentType: 'application/pdf', label: 'PDF' },
  jpg: { contentType: 'image/jpeg', label: 'JPG' },
  jpeg: { contentType: 'image/jpeg', label: 'JPG' },
  png: { contentType: 'image/png', label: 'PNG' },
  stl: { contentType: 'model/stl', label: 'STL' },
  ply: { contentType: 'application/octet-stream', label: 'PLY' },
  obj: { contentType: 'text/plain', label: 'OBJ' },
  glb: { contentType: 'model/gltf-binary', label: 'GLB' },
} as const

export type PatientFileExtension = keyof typeof fileTypes
export type PatientFileStatus = 'uploading' | 'active' | 'deleting'

export interface PatientFile {
  id: string
  clinicId: string
  patientId: string
  originalName: string
  extension: PatientFileExtension
  contentType: string
  sizeBytes: number
  storagePath: string
  status: PatientFileStatus
  uploadedAt: Date
  uploadedBy: string
}

export class PatientFileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PatientFileValidationError'
  }
}

export class PatientFileNotFoundError extends Error {
  constructor() {
    super('No encontramos el archivo solicitado.')
    this.name = 'PatientFileNotFoundError'
  }
}

function getDb() {
  return getFirebaseFirestore().then((db) => {
    if (!db) throw new Error('Firebase todavía no está configurado.')
    return db
  })
}

async function getStorage(): Promise<FirebaseStorage> {
  const storage = await getFirebaseStorage()
  if (!storage) throw new Error('Firebase Storage todavía no está configurado.')
  return storage
}

function getStorageReference(storage: FirebaseStorage, path: string): StorageReference {
  return ref(storage, path)
}

function validateFile(file: File) {
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  if (!extension || !(extension in fileTypes)) {
    throw new PatientFileValidationError('Formato no admitido. Usá PDF, JPG, PNG, STL, PLY, OBJ o GLB.')
  }
  if (!file.size || file.size > MAX_PATIENT_FILE_BYTES) {
    throw new PatientFileValidationError('El archivo debe tener entre 1 byte y 100 MB.')
  }
  const type = fileTypes[extension as PatientFileExtension]
  if (file.type && file.type !== type.contentType && file.type !== 'application/octet-stream') {
    throw new PatientFileValidationError('El tipo de archivo no coincide con su extensión.')
  }
  const originalName = file.name.split(/[\\/]/).at(-1)?.trim()
  if (!originalName || originalName.length > 255) {
    throw new PatientFileValidationError('El nombre del archivo no es válido.')
  }
  return {
    extension: extension as PatientFileExtension,
    contentType: type.contentType,
    originalName,
  }
}

function parsePatientFile(id: string, data: DocumentData): PatientFile {
  if (!(data.uploadedAt instanceof Timestamp)) {
    throw new Error('El archivo contiene una fecha de carga inválida.')
  }
  if (!['uploading', 'active', 'deleting'].includes(String(data.status))) {
    throw new Error('El archivo contiene un estado inválido.')
  }
  return {
    id,
    clinicId: String(data.clinicId ?? ''),
    patientId: String(data.patientId ?? ''),
    originalName: String(data.originalName ?? ''),
    extension: data.extension as PatientFileExtension,
    contentType: String(data.contentType ?? ''),
    sizeBytes: Number(data.sizeBytes ?? 0),
    storagePath: String(data.storagePath ?? ''),
    status: data.status as PatientFileStatus,
    uploadedAt: data.uploadedAt.toDate(),
    uploadedBy: String(data.uploadedBy ?? ''),
  }
}

async function validateActor(
  transaction: import('firebase/firestore').Transaction,
  db: import('firebase/firestore').Firestore,
  actorUid: string,
) {
  const snapshot = await transaction.get(doc(db, 'users', actorUid))
  const profile = snapshot.data()
  if (
    !snapshot.exists() ||
    profile?.uid !== actorUid ||
    !isClinicProfessionalProfile(actorUid, profile.role, profile.dentistId)
  ) {
    throw new Error('El perfil no corresponde a un profesional habilitado del consultorio.')
  }
}

function auditData(entityId: string, operation: string, actorUid: string) {
  return {
    entity: 'patientFile',
    entityId,
    operation,
    actorUid,
    createdAt: serverTimestamp(),
  }
}

export async function listPatientFiles(patientId: string) {
  const db = await getDb()
  const snapshot = await getDocs(
    query(
      collection(db, 'patientFiles'),
      where('clinicId', '==', CLINIC_ID),
      where('patientId', '==', patientId),
      where('status', 'in', ['uploading', 'active', 'deleting']),
      orderBy('uploadedAt', 'desc'),
      limit(100),
    ),
  )
  return snapshot.docs.map((document) => parsePatientFile(document.id, document.data()))
}

export async function uploadPatientFile(patientId: string, file: File, actorUid: string) {
  const metadata = validateFile(file)
  const db = await getDb()
  const storage = await getStorage()
  const patientRef = doc(db, 'patients', patientId)
  const fileRef = doc(collection(db, 'patientFiles'))
  const auditRef = doc(collection(db, 'auditLogs'))
  const storagePath = `patient-files/${patientId}/${metadata.extension}/${fileRef.id}`
  const objectRef = getStorageReference(storage, storagePath)

  await runTransaction(db, async (transaction) => {
    const patientSnapshot = await transaction.get(patientRef)
    const actorSnapshot = await transaction.get(doc(db, 'users', actorUid))
    const actor = actorSnapshot.data()
    if (!patientSnapshot.exists()) throw new PatientFileNotFoundError()
    if (
      !actorSnapshot.exists() ||
      actor?.uid !== actorUid ||
      !isClinicProfessionalProfile(actorUid, actor.role, actor.dentistId)
    ) {
      throw new Error('El perfil no corresponde a un profesional habilitado del consultorio.')
    }
    transaction.set(fileRef, {
      clinicId: CLINIC_ID,
      patientId,
      originalName: metadata.originalName,
      extension: metadata.extension,
      contentType: metadata.contentType,
      sizeBytes: file.size,
      storagePath,
      status: 'uploading',
      uploadedAt: serverTimestamp(),
      uploadedBy: actorUid,
      auditLogId: auditRef.id,
    })
    transaction.set(auditRef, auditData(fileRef.id, 'patient_file_upload_started', actorUid))
  })

  try {
    await uploadBytes(objectRef, file, {
      contentType: metadata.contentType,
      customMetadata: { clinicId: CLINIC_ID, patientId, fileId: fileRef.id },
    })
    const uploadedAuditRef = doc(collection(db, 'auditLogs'))
    await runTransaction(db, async (transaction) => {
      const fileSnapshot = await transaction.get(fileRef)
      if (!fileSnapshot.exists() || fileSnapshot.data().status !== 'uploading') {
        throw new Error('El registro del archivo cambió durante la carga.')
      }
      await validateActor(transaction, db, actorUid)
      transaction.update(fileRef, {
        status: 'active',
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
        auditLogId: uploadedAuditRef.id,
      })
      transaction.set(
        uploadedAuditRef,
        auditData(fileRef.id, 'patient_file_uploaded', actorUid),
      )
    })
  } catch (writeError) {
    try {
      await deletePatientFile(fileRef.id, actorUid)
    } catch (cleanupError) {
      throw new AggregateError(
        [writeError, cleanupError],
        'No se pudo finalizar la carga ni limpiar el registro y objeto del archivo.',
      )
    }
    throw writeError
  }
  return fileRef.id
}

export async function getPatientFileBlob(file: PatientFile) {
  if (file.status !== 'active') throw new PatientFileNotFoundError()
  const storage = await getStorage()
  const bytes = await getBytes(getStorageReference(storage, file.storagePath), MAX_PATIENT_FILE_BYTES)
  return new Blob([bytes], { type: file.contentType })
}

function isMissingStorageObject(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'storage/object-not-found'
  )
}

export async function deletePatientFile(fileId: string, actorUid: string) {
  const db = await getDb()
  const fileRef = doc(db, 'patientFiles', fileId)
  const requestAuditRef = doc(collection(db, 'auditLogs'))
  let fileData: DocumentData | undefined

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(fileRef)
    if (!snapshot.exists()) throw new PatientFileNotFoundError()
    await validateActor(transaction, db, actorUid)
    fileData = snapshot.data()
    if (fileData.status === 'active') {
      transaction.update(fileRef, {
        status: 'deleting',
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
        auditLogId: requestAuditRef.id,
      })
      transaction.set(
        requestAuditRef,
        auditData(
          fileId,
          fileData.status === 'uploading'
            ? 'patient_file_upload_cleanup_requested'
            : 'patient_file_delete_requested',
          actorUid,
        ),
      )
    } else if (fileData.status === 'deleted') {
      return
    } else if (fileData.status !== 'deleting') {
      throw new PatientFileNotFoundError()
    }
  })

  if (fileData?.status === 'deleted') return
  if (!fileData || typeof fileData.storagePath !== 'string') {
    throw new Error('El registro del archivo no contiene una ruta de almacenamiento válida.')
  }
  const storage = await getStorage()
  try {
    await deleteObject(getStorageReference(storage, fileData.storagePath))
  } catch (error) {
    if (!isMissingStorageObject(error)) throw error
  }

  const deletedAuditRef = doc(collection(db, 'auditLogs'))
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(fileRef)
    if (!snapshot.exists()) throw new PatientFileNotFoundError()
    await validateActor(transaction, db, actorUid)
    if (snapshot.data().status !== 'deleting') {
      throw new Error('El archivo cambió de estado durante la eliminación.')
    }
    transaction.update(fileRef, {
      status: 'deleted',
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: deletedAuditRef.id,
    })
    transaction.set(
      deletedAuditRef,
      auditData(fileId, 'patient_file_deleted', actorUid),
    )
  })
}
