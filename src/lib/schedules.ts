import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type DocumentData,
} from 'firebase/firestore'
import type { DentistId } from '../auth/auth-context'
import { getFirebaseFirestore } from './firebase'
import {
  defaultSchedule,
  accessibleAgendaIds,
  hasIntervalOverlap,
  minutesFromTime,
  SCHEDULE_TIME_ZONE,
  shiftDateKey,
  validateClinicIntervals,
  zonedDateTimeToDate,
  type AgendaAppointment,
  type AgendaBlock,
  type ScheduleConfig,
  type TimeInterval,
} from './schedule-logic'
import { getReservationSlotIdsForInterval } from './appointment-logic'

export interface ProfessionalProfile {
  dentistId: DentistId
  uid: string
  name: string
  color: string
}

export interface AgendaData {
  schedules: Record<string, ScheduleConfig>
  appointments: AgendaAppointment[]
  blocks: AgendaBlock[]
}

export class OverlappingScheduleBlockError extends Error {
  constructor() {
    super('Ese horario se superpone con otro bloqueo de agenda.')
    this.name = 'OverlappingScheduleBlockError'
  }
}

export class ScheduleBlockAppointmentConflictError extends Error {
  constructor() {
    super('Hay turnos existentes dentro del horario seleccionado.')
    this.name = 'ScheduleBlockAppointmentConflictError'
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

const professionals: Record<DentistId, Omit<ProfessionalProfile, 'uid'>> = {
  'blas-fresia': { dentistId: 'blas-fresia', name: 'Blas Fresia', color: 'teal' },
  'pamela-moreira': {
    dentistId: 'pamela-moreira',
    name: 'Pamela Moreira',
    color: 'blue',
  },
  'marcela-castro': {
    dentistId: 'marcela-castro',
    name: 'Marcela Castro',
    color: 'rose',
  },
}

export async function fetchProfessionalProfiles(
  isAdmin: boolean,
  ownDentistId: DentistId,
  ownUid: string,
) {
  const db = await getDb()
  const profiles: ProfessionalProfile[] = []
  const accessibleIds = accessibleAgendaIds(isAdmin ? 'admin' : 'dentist', ownDentistId)
  const profileDocuments = await Promise.all(
    accessibleIds.map((id) =>
      getDocsFromServer(
        query(
          collection(db, 'users'),
          where('dentistId', '==', id),
          where('role', 'in', ['admin', 'dentist']),
        ),
      ),
    ),
  )
  const profileByDentistId = new Map<DentistId, string>()
  for (const snapshot of profileDocuments) {
    for (const userDocument of snapshot.docs) {
      const data = userDocument.data()
      if (
        isDentistId(data.dentistId) &&
        data.uid === userDocument.id &&
        (data.role === 'admin' || data.role === 'dentist')
      ) {
        const existingUid = profileByDentistId.get(data.dentistId)
        if (existingUid && existingUid !== userDocument.id) {
          throw new Error(`Hay más de un perfil para ${data.dentistId} en Firestore.`)
        }
        profileByDentistId.set(data.dentistId, userDocument.id)
      }
    }
  }

  for (const profile of Object.values(professionals).filter((item) =>
    accessibleIds.includes(item.dentistId),
  )) {
    const uid = profileByDentistId.get(profile.dentistId)
    if (!uid) {
      throw new Error(`No se encontró el perfil de ${profile.name} en Firestore.`)
    }
    if (profile.dentistId === ownDentistId && uid !== ownUid) {
      throw new Error('El perfil autenticado no coincide con el profesional asignado en Firestore.')
    }
    profiles.push({ ...profile, uid })
  }
  return profiles
}

function storedSchedule(
  dentistId: DentistId,
  profileUid: string,
  data: DocumentData | undefined,
): ScheduleConfig {
  if (!data) return defaultSchedule(dentistId, profileUid)
  return {
    dentistId,
    professionalUid: profileUid,
    timezone: SCHEDULE_TIME_ZONE,
    weeklyAvailability:
      data.weeklyAvailability ?? defaultSchedule(dentistId, profileUid).weeklyAvailability,
    defaultDurationMinutes:
      30,
    durationOptions: [30],
    exceptions: Array.isArray(data.exceptions) ? data.exceptions : [],
  }
}

export async function fetchAgendaData(
  profiles: ProfessionalProfile[],
  startDate: string,
  endDateExclusive: string,
): Promise<AgendaData> {
  const db = await getDb()
  const schedules: Record<string, ScheduleConfig> = {}
  const appointments: AgendaAppointment[] = []
  const blocks: AgendaBlock[] = []

  await Promise.all(
    profiles.map(async (profile) => {
      const scheduleRef = doc(db, 'schedules', profile.dentistId)
      const start = Timestamp.fromDate(
        zonedDateTimeToDate(startDate, '00:00'),
      )
      const end = Timestamp.fromDate(
        zonedDateTimeToDate(endDateExclusive, '00:00'),
      )
      const [scheduleSnapshot, appointmentSnapshot, blockSnapshot] = await Promise.all([
        getDocFromServer(scheduleRef),
        getDocsFromServer(
          query(
            collection(db, 'appointments'),
            where('dentistId', '==', profile.dentistId),
            where('startAt', '>=', start),
            where('startAt', '<', end),
          ),
        ),
        getDocsFromServer(
          query(
            collection(db, 'scheduleBlocks'),
            where('dentistId', '==', profile.dentistId),
            where('date', '>=', startDate),
            where('date', '<', endDateExclusive),
          ),
        ),
      ])

      schedules[profile.dentistId] = storedSchedule(
        profile.dentistId,
        profile.uid,
        scheduleSnapshot.exists() ? scheduleSnapshot.data() : undefined,
      )

      for (const appointmentDocument of appointmentSnapshot.docs) {
        const data = appointmentDocument.data()
        if (!(data.startAt instanceof Timestamp) || !(data.endAt instanceof Timestamp)) {
          continue
        }
        appointments.push({
          id: appointmentDocument.id,
          dentistId: profile.dentistId,
          patientId: typeof data.patientId === 'string' ? data.patientId : '',
          startAt: data.startAt.toDate(),
          endAt: data.endAt.toDate(),
          status: typeof data.status === 'string' ? data.status : 'scheduled',
        })
      }

      for (const blockDocument of blockSnapshot.docs) {
        const data = blockDocument.data()
        blocks.push({
          id: blockDocument.id,
          dentistId: profile.dentistId,
          date: String(data.date ?? ''),
          startTime: String(data.startTime ?? ''),
          endTime: String(data.endTime ?? ''),
          reason: String(data.reason ?? ''),
        })
      }
    }),
  )

  return { schedules, appointments, blocks }
}

export async function saveSchedule(
  schedule: ScheduleConfig,
  updatedBy: string,
) {
  if (
    Object.keys(schedule.weeklyAvailability).length !== 7 ||
    Object.values(schedule.weeklyAvailability).some(
      (intervals) => !validateClinicIntervals(intervals),
    ) ||
    schedule.exceptions.length > 100 ||
    schedule.exceptions.some(
      (item) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
        !validateClinicIntervals(item.intervals),
    )
  ) {
    throw new Error('La configuración debe respetar el horario de 09:00 a 21:00 y los intervalos de 30 minutos.')
  }
  const db = await getDb()
  const payload = {
    dentistId: schedule.dentistId,
    professionalUid: schedule.professionalUid,
    timezone: SCHEDULE_TIME_ZONE,
    weeklyAvailability: schedule.weeklyAvailability,
    defaultDurationMinutes: 30,
    durationOptions: [30],
    exceptions: schedule.exceptions,
    exceptionsByDate: Object.fromEntries(
      schedule.exceptions.map((exception) => [exception.date, exception.intervals]),
    ),
    updatedAt: serverTimestamp(),
    updatedBy,
  }
  await setDoc(doc(db, 'schedules', schedule.dentistId), payload)
}

export async function createScheduleBlock(
  profile: ProfessionalProfile,
  date: string,
  interval: TimeInterval,
  reason: string,
  createdBy: string,
  allowAppointmentOverlap: boolean,
) {
  const db = await getDb()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidBlockInterval(interval)) {
    throw new Error('La fecha o el intervalo del bloqueo no son válidos.')
  }
  const start = Timestamp.fromDate(zonedDateTimeToDate(date, interval.start))
  const end = Timestamp.fromDate(zonedDateTimeToDate(date, interval.end))
  const slotIds = getReservationSlotIdsForInterval(
    profile.dentistId,
    date,
    interval.start,
    interval.end,
  )

  const dailyBlocksQuery = query(
    collection(db, 'scheduleBlocks'),
    where('dentistId', '==', profile.dentistId),
    where('date', '==', date),
  )
  const dayStart = Timestamp.fromDate(zonedDateTimeToDate(date, '00:00'))
  const dayEnd = Timestamp.fromDate(zonedDateTimeToDate(shiftDateKey(date, 1), '00:00'))
  const appointmentsQuery = query(
    collection(db, 'appointments'),
    where('dentistId', '==', profile.dentistId),
    where('startAt', '>=', dayStart),
    where('startAt', '<', dayEnd),
  )
  const [existingBlocks, existingAppointments] = await Promise.all([
    getDocsFromServer(dailyBlocksQuery),
    getDocsFromServer(appointmentsQuery),
  ])

  if (
    existingBlocks.docs.some((document) =>
      hasIntervalOverlap(interval, {
        start: String(document.data().startTime ?? ''),
        end: String(document.data().endTime ?? ''),
      }),
    )
  ) {
    throw new OverlappingScheduleBlockError()
  }

  const hasAppointments = existingAppointments.docs.some((document) => {
      const data = document.data()
      return (
        data.status !== 'cancelled' &&
        data.startAt instanceof Timestamp &&
        data.endAt instanceof Timestamp &&
        data.startAt.toMillis() < end.toMillis() &&
        data.endAt.toMillis() > start.toMillis()
      )
  })
  if (hasAppointments && !allowAppointmentOverlap) {
    throw new ScheduleBlockAppointmentConflictError()
  }

  const blockRef = doc(collection(db, 'scheduleBlocks'))
  await runTransaction(db, async (transaction) => {
    const reservationRefs = slotIds.map((slotId) =>
      doc(db, 'appointmentReservations', slotId),
    )
    const reservations = await Promise.all(
      reservationRefs.map((ref) => transaction.get(ref)),
    )
    if (reservations.some((snapshot) => snapshot.exists())) {
      const appointmentConflict = reservations.some(
        (snapshot) =>
          snapshot.exists() && snapshot.data().ownerType === 'appointment',
      )
      const blockConflict = reservations.some(
        (snapshot) => snapshot.exists() && snapshot.data().ownerType === 'block',
      )
      if (blockConflict || (appointmentConflict && !allowAppointmentOverlap)) {
        if (appointmentConflict && !allowAppointmentOverlap) {
          throw new ScheduleBlockAppointmentConflictError()
        }
        throw new OverlappingScheduleBlockError()
      }
    }

    transaction.set(blockRef, {
      dentistId: profile.dentistId,
      professionalUid: profile.uid,
      date,
      startTime: interval.start,
      endTime: interval.end,
      startMinute: minutesFromTime(interval.start),
      endMinute: minutesFromTime(interval.end),
      reason: reason.trim(),
      slotIds,
      createdBy,
      createdAt: serverTimestamp(),
    })
    for (const slotId of slotIds) {
      const existing = reservations.find((snapshot) => snapshot.id === slotId)
      if (existing?.exists()) continue
      transaction.set(doc(db, 'appointmentReservations', slotId), {
        slotId,
        slotMinute: Number(slotId.split('_').at(-1)),
        ownerId: blockRef.id,
        ownerType: 'block',
        dentistId: profile.dentistId,
        date,
        createdBy,
        createdAt: serverTimestamp(),
      })
    }
  })
}

function isValidBlockInterval(interval: TimeInterval) {
  const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  return (
    isTime(interval.start) &&
    isTime(interval.end) &&
    interval.start < interval.end &&
    minutesFromTime(interval.start) % 15 === 0 &&
    minutesFromTime(interval.end) % 15 === 0
  )
}

export async function removeScheduleBlock(blockId: string) {
  const db = await getDb()
  const blockRef = doc(db, 'scheduleBlocks', blockId)
  await runTransaction(db, async (transaction) => {
    const blockSnapshot = await transaction.get(blockRef)
    if (!blockSnapshot.exists()) return
    const slotIds: unknown = blockSnapshot.data().slotIds
    const reservationRefs = Array.isArray(slotIds)
      ? slotIds.map((slotId) =>
          doc(db, 'appointmentReservations', String(slotId)),
        )
      : []
    const reservations = await Promise.all(
      reservationRefs.map((ref) => transaction.get(ref)),
    )
    transaction.delete(blockRef)
    for (const reservation of reservations) {
      if (
        reservation.exists() &&
        reservation.data().ownerId === blockId &&
        reservation.data().ownerType === 'block'
      ) {
        transaction.delete(reservation.ref)
      }
    }
  })
}
