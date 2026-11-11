import {
  dateKeyFromDate,
  intervalsForDate,
  minutesFromTime,
  type AgendaAppointment,
  type AgendaBlock,
  type ScheduleConfig,
  type TimeInterval,
  zonedDateTimeToDate,
} from './schedule-logic.ts'

export const APPOINTMENT_DURATIONS = [30] as const
export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled'

export interface AppointmentInput {
  patientId: string
  dentistId: string
  date: string
  startTime: string
  durationMinutes: number
  reason: string
  notes: string
}

export interface AppointmentDraft extends AppointmentInput {
  professionalUid: string
  startAt: Date
  endAt: Date
  startMinute: number
  endMinute: number
  endTime: string
  slotIds: string[]
}

export interface AppointmentData extends AppointmentDraft {
  id: string
  status: AppointmentStatus
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
  auditLogId: string
}

export class AppointmentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppointmentValidationError'
  }
}

export class AppointmentOverlapError extends Error {
  constructor() {
    super('Ese horario se superpone con otro turno activo.')
    this.name = 'AppointmentOverlapError'
  }
}

export class AppointmentBlockOverlapError extends Error {
  constructor() {
    super('Ese horario se superpone con un bloqueo de agenda.')
    this.name = 'AppointmentBlockOverlapError'
  }
}

export class AppointmentNotFoundError extends Error {
  constructor() {
    super('No encontramos el turno solicitado.')
    this.name = 'AppointmentNotFoundError'
  }
}

export class InvalidAppointmentStatusError extends Error {
  constructor(message = 'El estado actual del turno no permite esta acción.') {
    super(message)
    this.name = 'InvalidAppointmentStatusError'
  }
}

export function getReservationSlotIds(
  dentistId: string,
  date: string,
  startTime: string,
  durationMinutes: number,
) {
  if (
    !/^[a-z0-9-]+$/.test(dentistId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 15 ||
    durationMinutes > 120 ||
    durationMinutes % 15 !== 0
  ) {
    throw new AppointmentValidationError('La fecha, hora o duración no es válida.')
  }

  const start = minutesFromTime(startTime)
  if (start % 15 !== 0) {
    throw new AppointmentValidationError('Los turnos deben comenzar en un intervalo de 15 minutos.')
  }

  const end = start + durationMinutes
  return getReservationSlotIdsForInterval(
    dentistId,
    date,
    startTime,
    `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
  )
}

export function getReservationSlotIdsForInterval(
  dentistId: string,
  date: string,
  startTime: string,
  endTime: string,
) {
  if (
    !/^[a-z0-9-]+$/.test(dentistId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
    minutesFromTime(startTime) >= minutesFromTime(endTime) ||
    minutesFromTime(startTime) % 15 !== 0 ||
    minutesFromTime(endTime) % 15 !== 0
  ) {
    throw new AppointmentValidationError('El rango de reserva no es válido.')
  }

  const firstSlot = Math.floor(minutesFromTime(startTime) / 15) * 15
  const lastSlot = Math.ceil(minutesFromTime(endTime) / 15) * 15
  return Array.from({ length: (lastSlot - firstSlot) / 15 }, (_, index) => {
    const minute = firstSlot + index * 15
    return `${dentistId}_${date}_${minute}`
  })
}

export function validateAppointmentDraft(
  input: AppointmentInput,
  schedule: ScheduleConfig,
  appointments: AgendaAppointment[],
  blocks: AgendaBlock[],
  patientExists: boolean,
  excludedAppointmentId?: string,
  allowLegacyDuration = false,
): AppointmentDraft {
  if (!patientExists) {
    throw new AppointmentValidationError('El paciente seleccionado ya no existe.')
  }
  if (!input.patientId.trim()) {
    throw new AppointmentValidationError('Seleccioná un paciente existente.')
  }
  if (input.dentistId !== schedule.dentistId) {
    throw new AppointmentValidationError('El profesional seleccionado no coincide con la agenda.')
  }
  if (!isValidDateKey(input.date)) {
    throw new AppointmentValidationError('Seleccioná una fecha válida.')
  }
  const validNewDuration =
    input.durationMinutes === 30 && schedule.durationOptions.includes(30)
  const validLegacyDuration =
    allowLegacyDuration &&
    [15, 30, 45, 60, 90, 120].includes(input.durationMinutes)
  if (
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.startTime) ||
    (!validNewDuration && !validLegacyDuration)
  ) {
    throw new AppointmentValidationError('La hora o duración seleccionada no está habilitada.')
  }
  if (!input.reason.trim() || input.reason.trim().length > 160) {
    throw new AppointmentValidationError('El motivo es obligatorio y no puede superar 160 caracteres.')
  }
  if (input.notes.trim().length > 1000) {
    throw new AppointmentValidationError('Las observaciones no pueden superar 1000 caracteres.')
  }

  const slotStart = minutesFromTime(input.startTime)
  if (slotStart % (validLegacyDuration && !validNewDuration ? 15 : 30) !== 0) {
    throw new AppointmentValidationError('Elegí un horario en intervalos de 30 minutos.')
  }
  const slotEnd = slotStart + input.durationMinutes
  if (!validLegacyDuration && (slotStart < 9 * 60 || slotEnd > 21 * 60)) {
    throw new AppointmentValidationError('Los turnos deben ser de 09:00 a 21:00.')
  }
  const withinWorkInterval = intervalsForDate(schedule, input.date).some((interval) => {
    const start = minutesFromTime(interval.start)
    const end = minutesFromTime(interval.end)
    return slotStart >= start && slotEnd <= end
  })
  if (!withinWorkInterval && !validLegacyDuration) {
    throw new AppointmentValidationError('El horario está fuera de la disponibilidad configurada.')
  }

  const startAt = zonedDateTimeToDate(input.date, input.startTime, schedule.timezone)
  const endTime = `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`
  const endAt =
    slotEnd < 24 * 60
      ? zonedDateTimeToDate(input.date, endTime, schedule.timezone)
      : new Date(startAt.getTime() + input.durationMinutes * 60_000)
  const proposed = { start: input.startTime, end: endTime }

  const overlappingAppointment = appointments.some((appointment) => {
    if (
      appointment.id === excludedAppointmentId ||
      appointment.status === 'cancelled' ||
      appointment.dentistId !== input.dentistId
    ) {
      return false
    }
    return startAt < appointment.endAt && endAt > appointment.startAt
  })
  if (overlappingAppointment) throw new AppointmentOverlapError()

  const overlappingBlock = blocks.some(
    (block) =>
      block.dentistId === input.dentistId &&
      block.date === input.date &&
      intervalsOverlap(proposed, { start: block.startTime, end: block.endTime }),
  )
  if (overlappingBlock) throw new AppointmentBlockOverlapError()

  return {
    ...input,
    professionalUid: schedule.professionalUid,
    patientId: input.patientId.trim(),
    reason: input.reason.trim(),
    notes: input.notes.trim(),
    startAt,
    endAt,
    startMinute: slotStart,
    endMinute: slotEnd,
    endTime,
    slotIds: getReservationSlotIds(
      input.dentistId,
      input.date,
      input.startTime,
      input.durationMinutes,
    ),
  }
}

function isValidDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return (
    year >= 1900 &&
    new Date(Date.UTC(year, month - 1, day, 12)).toISOString().slice(0, 10) === value
  )
}

function intervalsOverlap(left: TimeInterval, right: TimeInterval) {
  return (
    minutesFromTime(left.start) < minutesFromTime(right.end) &&
    minutesFromTime(left.end) > minutesFromTime(right.start)
  )
}

export function appointmentDateKey(appointment: Pick<AgendaAppointment, 'startAt'>) {
  return dateKeyFromDate(appointment.startAt)
}

export function appointmentDuration(startAt: Date, endAt: Date) {
  return Math.round((endAt.getTime() - startAt.getTime()) / 60_000)
}

export function canManageAppointment(
  role: 'admin' | 'dentist',
  ownDentistId: string,
  appointmentDentistId: string,
) {
  const authorizedUser =
    (role === 'admin' || role === 'dentist') &&
    (ownDentistId === 'blas-fresia' ||
      ownDentistId === 'pamela-moreira' ||
      ownDentistId === 'marcela-castro')
  return authorizedUser &&
    (appointmentDentistId === 'blas-fresia' ||
      appointmentDentistId === 'pamela-moreira' ||
      appointmentDentistId === 'marcela-castro')
}

export function getNextAppointmentStatus(
  current: AppointmentStatus,
  next: 'confirmed' | 'cancelled',
): AppointmentStatus {
  if (current === 'cancelled') {
    throw new InvalidAppointmentStatusError('El turno ya está cancelado.')
  }
  if (next === 'confirmed' && current !== 'pending') {
    throw new InvalidAppointmentStatusError('Solo se pueden confirmar turnos pendientes.')
  }
  return next
}
