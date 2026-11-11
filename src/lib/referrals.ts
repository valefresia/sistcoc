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
  type Firestore,
  type Transaction,
} from 'firebase/firestore'
import type { DentistId } from '../auth/auth-context'
import { getFirebaseFirestore } from './firebase'
import { CLINIC_ID, isClinicProfessionalProfile } from './clinic'
import {
  canResolveReferral,
  validateReferralInput,
  type ReferralInput,
  type ReferralStatus,
} from './referral-logic'

export class ReferralNotFoundError extends Error {
  constructor() {
    super('No encontramos el paciente o la derivación solicitada.')
    this.name = 'ReferralNotFoundError'
  }
}

export class ReferralPermissionError extends Error {
  constructor() {
    super('El perfil no corresponde a un profesional habilitado del consultorio.')
    this.name = 'ReferralPermissionError'
  }
}

export interface Referral extends ReferralInput {
  id: string
  clinicId: string
  referrerUid: string
  referrerDentistId: DentistId
  recipientUid: string
  recipientDentistId: DentistId
  status: ReferralStatus
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
  auditLogId: string
}

function getDb() {
  return getFirebaseFirestore().then((db) => {
    if (!db) throw new Error('Firebase todavía no está configurado.')
    return db
  })
}

function parseDate(value: unknown) {
  if (!(value instanceof Timestamp)) {
    throw new Error('La derivación contiene una fecha inválida.')
  }
  return value.toDate()
}

function parseReferral(id: string, data: DocumentData): Referral {
  if (!['pending', 'accepted', 'rejected'].includes(String(data.status))) {
    throw new Error('La derivación contiene un estado inválido.')
  }
  return {
    id,
    clinicId: String(data.clinicId ?? ''),
    patientId: String(data.patientId ?? ''),
    referrerUid: String(data.referrerUid ?? ''),
    referrerDentistId: data.referrerDentistId as DentistId,
    recipientUid: String(data.recipientUid ?? ''),
    recipientDentistId: data.recipientDentistId as DentistId,
    status: data.status as ReferralStatus,
    reason: String(data.reason ?? ''),
    notes: String(data.notes ?? ''),
    createdAt: parseDate(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    updatedAt: parseDate(data.updatedAt),
    updatedBy: String(data.updatedBy ?? ''),
    auditLogId: String(data.auditLogId ?? ''),
  }
}

async function validateActor(
  transaction: Transaction,
  db: Firestore,
  actorUid: string,
) {
  const actorSnapshot = await transaction.get(doc(db, 'users', actorUid))
  const actor = actorSnapshot.data()
  const allowed =
    actorSnapshot.exists() &&
    actor?.uid === actorUid &&
    isClinicProfessionalProfile(actorUid, actor.role, actor.dentistId)
  if (!allowed) throw new ReferralPermissionError()
  return actor.dentistId as DentistId
}

export async function createReferral(
  input: ReferralInput,
  actorUid: string,
  actorDentistId: DentistId,
) {
  const validated = validateReferralInput(input, actorDentistId)
  const db = await getDb()
  const recipientQuery = query(
    collection(db, 'users'),
    where('dentistId', '==', validated.recipientDentistId),
    where('role', 'in', ['admin', 'dentist']),
    limit(2),
  )
  const recipients = await getDocs(recipientQuery)
  const recipient = recipients.docs.filter((item) => item.data().uid === item.id)
  if (recipient.length !== 1) {
    throw new Error('No se pudo identificar al profesional destinatario.')
  }
  const referralRef = doc(collection(db, 'referrals'))
  const auditRef = doc(collection(db, 'auditLogs'))
  await runTransaction(db, async (transaction) => {
    const [patientSnapshot, recipientSnapshot] = await Promise.all([
      transaction.get(doc(db, 'patients', validated.patientId)),
      transaction.get(recipient[0].ref),
    ])
    if (!patientSnapshot.exists() || !recipientSnapshot.exists()) {
      throw new ReferralNotFoundError()
    }
    const actorDentistIdCurrent = await validateActor(transaction, db, actorUid)
    if (actorDentistIdCurrent !== actorDentistId) {
      throw new ReferralPermissionError()
    }
    transaction.set(referralRef, {
      clinicId: CLINIC_ID,
      patientId: validated.patientId,
      referrerUid: actorUid,
      referrerDentistId: actorDentistId,
      recipientUid: recipientSnapshot.data().uid,
      recipientDentistId: validated.recipientDentistId,
      status: 'pending',
      reason: validated.reason,
      notes: validated.notes,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: auditRef.id,
    })
    transaction.set(auditRef, {
      entity: 'referral',
      entityId: referralRef.id,
      operation: 'referral_created',
      actorUid,
      createdAt: serverTimestamp(),
    })
  })
  return referralRef.id
}

export async function resolveReferral(
  referralId: string,
  status: 'accepted' | 'rejected',
  actorUid: string,
) {
  const db = await getDb()
  const referralRef = doc(db, 'referrals', referralId)
  const auditRef = doc(collection(db, 'auditLogs'))
  await runTransaction(db, async (transaction) => {
    const referralSnapshot = await transaction.get(referralRef)
    if (!referralSnapshot.exists()) throw new ReferralNotFoundError()
    await validateActor(transaction, db, actorUid)
    const referral = parseReferral(referralSnapshot.id, referralSnapshot.data())
    if (!canResolveReferral(referral.status)) {
      throw new Error('Solo se pueden responder derivaciones pendientes.')
    }
    transaction.update(referralRef, {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: auditRef.id,
    })
    transaction.set(auditRef, {
      entity: 'referral',
      entityId: referralId,
      operation: `referral_${status}`,
      actorUid,
      createdAt: serverTimestamp(),
    })
  })
}

export async function listReferrals(patientId?: string) {
  const db = await getDb()
  const snapshot = await getDocs(
    patientId
      ? query(
          collection(db, 'referrals'),
          where('clinicId', '==', CLINIC_ID),
          where('patientId', '==', patientId),
          orderBy('createdAt', 'desc'),
          limit(200),
        )
      : query(
          collection(db, 'referrals'),
          where('clinicId', '==', CLINIC_ID),
          orderBy('createdAt', 'desc'),
          limit(200),
        ),
  )
  return snapshot.docs.map((document) => parseReferral(document.id, document.data()))
}
