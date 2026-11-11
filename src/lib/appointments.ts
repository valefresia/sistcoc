import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
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
import type { Patient } from './patients'
import { getPatient } from './patients'
import { getFirebaseFirestore } from './firebase'
import {
  AppointmentBlockOverlapError,
  AppointmentNotFoundError,
  AppointmentOverlapError,
  getNextAppointmentStatus,
  getReservationSlotIds,
  InvalidAppointmentStatusError,
  validateAppointmentDraft,
  type AppointmentData,
  type AppointmentInput,
  type AppointmentStatus,
} from './appointment-logic'
import { SCHEDULE_TIME_ZONE, shiftDateKey, zonedDateTimeToDate } from './schedule-logic'
import type { ProfessionalProfile } from './schedules'
import { defaultSchedule } from './schedule-logic'

export interface AppointmentPageData {
  appointment: AppointmentData
  patient: Patient | null
  professionalName: string
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

function parseSchedule(dentistId: DentistId, uid: string, data?: DocumentData) {
  const defaults = defaultSchedule(dentistId, uid)
  if (!data) return defaults
  return {
    dentistId,
    professionalUid: uid,
    timezone: SCHEDULE_TIME_ZONE as typeof SCHEDULE_TIME_ZONE,
    weeklyAvailability: data.weeklyAvailability ?? defaults.weeklyAvailability,
    defaultDurationMinutes: 30,
    durationOptions: [30],
    exceptions: Array.isArray(data.exceptions) ? data.exceptions : [],
  }
}

function timestampToDate(value: unknown) {
  if (!(value instanceof Timestamp)) {
    throw new Error('El turno guardado tiene timestamps no válidos.')
  }
  return value.toDate()
}

function parseAppointment(id: string, data: DocumentData): AppointmentData {
  if (
    !isDentistId(data.dentistId) ||
    (data.professionalUid !== undefined && typeof data.professionalUid !== 'string') ||
    !(data.startAt instanceof Timestamp) ||
    !(data.endAt instanceof Timestamp) ||
    !['pending', 'confirmed', 'cancelled'].includes(String(data.status))
  ) {
    throw new Error('El turno guardado tiene un formato no válido.')
  }
  return {
    id,
    patientId: String(data.patientId ?? ''),
    dentistId: data.dentistId,
    professionalUid: String(data.professionalUid ?? ''),
    date: String(data.localDate ?? ''),
    startTime: String(data.startTime ?? ''),
    endTime: String(data.endTime ?? ''),
    startMinute: Number(data.startMinute ?? 0),
    endMinute: Number(data.endMinute ?? 0),
    durationMinutes: Number(data.durationMinutes ?? 0),
    reason: String(data.reason ?? ''),
    notes: String(data.notes ?? ''),
    startAt: data.startAt.toDate(),
    endAt: data.endAt.toDate(),
    slotIds: Array.isArray(data.slotIds) ? data.slotIds : [],
    status: data.status as AppointmentStatus,
    createdAt: timestampToDate(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    updatedAt: timestampToDate(data.updatedAt),
    updatedBy: String(data.updatedBy ?? ''),
    auditLogId: String(data.auditLogId ?? ''),
  }
}

function toAgendaAppointment(id: string, data: DocumentData) {
  if (!(data.startAt instanceof Timestamp) || !(data.endAt instanceof Timestamp)) return null
  return {
    id,
    dentistId: String(data.dentistId ?? ''),
    patientId: String(data.patientId ?? ''),
    startAt: data.startAt.toDate(),
    endAt: data.endAt.toDate(),
    status: String(data.status ?? 'pending'),
  }
}

async function loadDayData(
  db: Firestore,
  dentistId: string,
  date: string,
) {
  const start = Timestamp.fromDate(zonedDateTimeToDate(date, '00:00'))
  const end = Timestamp.fromDate(zonedDateTimeToDate(shiftDateKey(date, 1), '00:00'))
  const [appointmentSnapshot, blockSnapshot] = await Promise.all([
    getDocsFromServer(
      query(
        collection(db, 'appointments'),
        where('dentistId', '==', dentistId),
        where('startAt', '>=', start),
        where('startAt', '<', end),
      ),
    ),
    getDocsFromServer(
      query(
        collection(db, 'scheduleBlocks'),
        where('dentistId', '==', dentistId),
        where('date', '==', date),
      ),
    ),
  ])
  return {
    appointments: appointmentSnapshot.docs
      .map((item) => toAgendaAppointment(item.id, item.data()))
      .filter((item): item is NonNullable<typeof item> => item !== null),
    blockRefs: blockSnapshot.docs.map((item) => item.ref),
  }
}

function auditReference(db: Firestore) {
  return doc(collection(db, 'auditLogs'))
}

function reservationReference(db: Firestore, slotId: string) {
  return doc(db, 'appointmentReservations', slotId)
}

function appointmentPayload(
  draft: ReturnType<typeof validateAppointmentDraft>,
  auditLogId: string,
  actorUid: string,
  status: AppointmentStatus,
) {
  return {
    patientId: draft.patientId,
    dentistId: draft.dentistId,
    professionalUid: draft.professionalUid,
    localDate: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
    startMinute: draft.startMinute,
    endMinute: draft.endMinute,
    startAt: Timestamp.fromDate(draft.startAt),
    endAt: Timestamp.fromDate(draft.endAt),
    durationMinutes: draft.durationMinutes,
    status,
    reason: draft.reason,
    notes: draft.notes,
    slotIds: draft.slotIds,
    auditLogId,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }
}

function writeAudit(
  transaction: Transaction,
  ref: ReturnType<typeof auditReference>,
  appointmentId: string,
  operation: string,
  actorUid: string,
) {
  transaction.set(ref, {
    entity: 'appointment',
    entityId: appointmentId,
    operation,
    actorUid,
    createdAt: serverTimestamp(),
  })
}

function reservationPayload(
  slotId: string,
  ownerId: string,
  ownerType: 'appointment' | 'block',
  dentistId: string,
  date: string,
  createdBy: string,
) {
  return {
    slotId,
    slotMinute: Number(slotId.split('_').at(-1)),
    ownerId,
    ownerType,
    dentistId,
    date,
    createdBy,
    createdAt: serverTimestamp(),
  }
}

function throwReservationConflict(
  snapshots: Array<{ exists: () => boolean; data: () => DocumentData | undefined }>,
) {
  const conflict = snapshots.find((snapshot) => snapshot.exists())
  if (conflict?.data()?.ownerType === 'block') {
    throw new AppointmentBlockOverlapError()
  }
  if (conflict) {
    throw new AppointmentOverlapError()
  }
}

export async function createAppointment(
  profile: ProfessionalProfile,
  input: AppointmentInput,
  actorUid: string,
) {
  const db = await getDb()
  const { appointments, blockRefs } = await loadDayData(db, profile.dentistId, input.date)
  const auditRef = auditReference(db)
  const appointmentRef = doc(collection(db, 'appointments'))

  await runTransaction(db, async (transaction) => {
    const scheduleRef = doc(db, 'schedules', profile.dentistId)
    const patientRef = doc(db, 'patients', input.patientId)
    const [patientSnapshot, scheduleSnapshot] = await Promise.all([
      transaction.get(patientRef),
      transaction.get(scheduleRef),
    ])
    const schedule = parseSchedule(
      profile.dentistId,
      profile.uid,
      scheduleSnapshot.exists() ? scheduleSnapshot.data() : undefined,
    )
    const draft = validateAppointmentDraft(
      input,
      schedule,
      appointments,
      [],
      patientSnapshot.exists(),
    )
    const [reservationSnapshots, blockSnapshots] = await Promise.all([
      Promise.all(
        draft.slotIds.map((slotId) =>
          transaction.get(reservationReference(db, slotId)),
        ),
      ),
      Promise.all(blockRefs.map((ref) => transaction.get(ref))),
    ])
    throwReservationConflict(reservationSnapshots)
    const blocks = blockSnapshots.map((snapshot) => {
      const data = snapshot.data()
      return {
        id: snapshot.id,
        dentistId: String(data?.dentistId ?? ''),
        date: String(data?.date ?? ''),
        startTime: String(data?.startTime ?? ''),
        endTime: String(data?.endTime ?? ''),
        reason: String(data?.reason ?? ''),
      }
    })
    validateAppointmentDraft(input, schedule, appointments, blocks, true)

    transaction.set(appointmentRef, {
      ...appointmentPayload(draft, auditRef.id, actorUid, 'pending'),
      createdAt: serverTimestamp(),
      createdBy: actorUid,
    })
    for (const slotId of draft.slotIds) {
      transaction.set(
        reservationReference(db, slotId),
        reservationPayload(
          slotId,
          appointmentRef.id,
          'appointment',
          profile.dentistId,
          input.date,
          actorUid,
        ),
      )
    }
    writeAudit(transaction, auditRef, appointmentRef.id, 'appointment_created', actorUid)
  })

  return appointmentRef.id
}

export async function updateAppointment(
  appointmentId: string,
  profile: ProfessionalProfile,
  input: AppointmentInput,
  actorUid: string,
) {
  const db = await getDb()
  const { appointments, blockRefs } = await loadDayData(db, profile.dentistId, input.date)
  const appointmentRef = doc(db, 'appointments', appointmentId)
  const auditRef = auditReference(db)

  await runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(appointmentRef)
    if (!currentSnapshot.exists()) throw new AppointmentNotFoundError()
    const current = parseAppointment(currentSnapshot.id, currentSnapshot.data())
    if (current.status === 'cancelled') {
      throw new InvalidAppointmentStatusError('No se puede editar un turno cancelado.')
    }

    const patientRef = doc(db, 'patients', input.patientId)
    const scheduleRef = doc(db, 'schedules', profile.dentistId)
    const lockIds = [...new Set([...current.slotIds, ...getReservationSlotIds(
      profile.dentistId,
      input.date,
      input.startTime,
      input.durationMinutes,
    )])]
    const [patientSnapshot, scheduleSnapshot, lockSnapshots, blockSnapshots] =
      await Promise.all([
        transaction.get(patientRef),
        transaction.get(scheduleRef),
        Promise.all(lockIds.map((slotId) => transaction.get(reservationReference(db, slotId)))),
        Promise.all(blockRefs.map((ref) => transaction.get(ref))),
      ])
    const schedule = parseSchedule(
      profile.dentistId,
      profile.uid,
      scheduleSnapshot.exists() ? scheduleSnapshot.data() : undefined,
    )
    const blocks = blockSnapshots.map((snapshot) => {
      const data = snapshot.data()
      return {
        id: snapshot.id,
        dentistId: String(data?.dentistId ?? ''),
        date: String(data?.date ?? ''),
        startTime: String(data?.startTime ?? ''),
        endTime: String(data?.endTime ?? ''),
        reason: String(data?.reason ?? ''),
      }
    })
    const draft = validateAppointmentDraft(
      input,
      schedule,
      appointments,
      blocks,
      patientSnapshot.exists(),
      appointmentId,
      current.dentistId === input.dentistId &&
        current.date === input.date &&
        current.startTime === input.startTime &&
        current.durationMinutes === input.durationMinutes,
    )
    const ownedReservationSnapshots = lockSnapshots.filter((snapshot) => {
      if (!snapshot.exists()) return false
      const data = snapshot.data()
      return data.ownerId === appointmentId && data.ownerType === 'appointment'
    })
    const newReservations = lockSnapshots.filter((snapshot) => {
      if (!snapshot.exists()) return false
      const data = snapshot.data()
      return draft.slotIds.includes(String(data.slotId)) &&
        !(data.ownerId === appointmentId && data.ownerType === 'appointment')
    })
    throwReservationConflict(newReservations)

    transaction.update(appointmentRef, {
      ...appointmentPayload(draft, auditRef.id, actorUid, current.status),
    })
    for (const snapshot of ownedReservationSnapshots) {
      if (!draft.slotIds.includes(String(snapshot.data()?.slotId ?? ''))) {
        transaction.delete(snapshot.ref)
      }
    }
    for (const slotId of draft.slotIds) {
      const currentReservation = lockSnapshots.find(
        (snapshot) => snapshot.id === slotId && snapshot.exists(),
      )
      if (!currentReservation) {
        transaction.set(
          reservationReference(db, slotId),
          reservationPayload(
            slotId,
            appointmentId,
            'appointment',
            profile.dentistId,
            input.date,
            actorUid,
          ),
        )
      }
    }
    writeAudit(transaction, auditRef, appointmentId, 'appointment_updated', actorUid)
  })
}

export async function transitionAppointment(
  appointmentId: string,
  status: 'confirmed' | 'cancelled',
  actorUid: string,
) {
  const db = await getDb()
  const appointmentRef = doc(db, 'appointments', appointmentId)
  const auditRef = auditReference(db)

  await runTransaction(db, async (transaction) => {
    const appointmentSnapshot = await transaction.get(appointmentRef)
    if (!appointmentSnapshot.exists()) throw new AppointmentNotFoundError()
    const appointment = parseAppointment(
      appointmentSnapshot.id,
      appointmentSnapshot.data(),
    )
    getNextAppointmentStatus(appointment.status, status)

    const reservationRefs = appointment.slotIds.map((slotId) =>
      reservationReference(db, slotId),
    )
    const reservationSnapshots = await Promise.all(
      reservationRefs.map((ref) => transaction.get(ref)),
    )

    transaction.update(appointmentRef, {
      status,
      auditLogId: auditRef.id,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    })
    if (status === 'cancelled') {
      for (const snapshot of reservationSnapshots) {
        if (
          snapshot.exists() &&
          snapshot.data().ownerId === appointmentId &&
          snapshot.data().ownerType === 'appointment'
        ) {
          transaction.delete(snapshot.ref)
        }
      }
    }
    writeAudit(
      transaction,
      auditRef,
      appointmentId,
      status === 'confirmed' ? 'appointment_confirmed' : 'appointment_cancelled',
      actorUid,
    )
  })
}

export async function getAppointmentDetails(
  appointmentId: string,
  profiles: ProfessionalProfile[],
): Promise<AppointmentPageData | null> {
  const db = await getDb()
  const snapshot = await getDocFromServer(doc(db, 'appointments', appointmentId))
  if (!snapshot.exists()) return null
  const appointment = parseAppointment(snapshot.id, snapshot.data())
  const profile = profiles.find((item) => item.dentistId === appointment.dentistId)
  const [patient] = await Promise.all([getPatient(appointment.patientId)])
  return {
    appointment,
    patient,
    professionalName: profile?.name ?? appointment.dentistId,
  }
}

export async function fetchAppointmentPatient(patientId: string) {
  return getPatient(patientId)
}

export function isActiveAppointment(status: string) {
  return status === 'pending' || status === 'confirmed'
}
