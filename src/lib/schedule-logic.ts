export const SCHEDULE_TIME_ZONE = 'America/Argentina/Tucuman'

export interface TimeInterval {
  start: string
  end: string
}

export interface ScheduleException {
  date: string
  intervals: TimeInterval[]
  label: string
}

export interface ScheduleConfig {
  dentistId: string
  professionalUid: string
  timezone: typeof SCHEDULE_TIME_ZONE
  weeklyAvailability: Record<string, TimeInterval[]>
  defaultDurationMinutes: number
  durationOptions: number[]
  exceptions: ScheduleException[]
}

export interface AgendaAppointment {
  id: string
  dentistId: string
  patientId: string
  startAt: Date
  endAt: Date
  status: string
}

export interface AgendaBlock {
  id: string
  dentistId: string
  date: string
  startTime: string
  endTime: string
  reason: string
}

export interface AvailableSlot extends TimeInterval {
  available: boolean
  reason?: 'appointment' | 'block'
}

export function accessibleAgendaIds(
  role: 'admin' | 'dentist',
  ownDentistId: string,
) {
  const allIds = ['blas-fresia', 'pamela-moreira', 'marcela-castro']
  return (role === 'admin' || role === 'dentist') && allIds.includes(ownDentistId)
    ? allIds
    : []
}

export function defaultSchedule(dentistId: string, professionalUid: string): ScheduleConfig {
  const weekdays: Record<string, TimeInterval[]> = {}
  for (let weekday = 1; weekday <= 5; weekday += 1) {
    weekdays[String(weekday)] = [{ start: '09:00', end: '21:00' }]
  }
  weekdays['6'] = []
  weekdays['7'] = []

  return {
    dentistId,
    professionalUid,
    timezone: SCHEDULE_TIME_ZONE,
    weeklyAvailability: weekdays,
    defaultDurationMinutes: 30,
    durationOptions: [30],
    exceptions: [],
  }
}

export function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function minutesFromTime(value: string) {
  if (!isValidTime(value)) return Number.NaN
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function timeFromMinutes(value: number) {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function validateIntervals(intervals: TimeInterval[]) {
  const sorted = [...intervals].sort(
    (left, right) => minutesFromTime(left.start) - minutesFromTime(right.start),
  )

  return sorted.every((interval, index) => {
    const start = minutesFromTime(interval.start)
    const end = minutesFromTime(interval.end)
    const previousEnd =
      index === 0 ? -1 : minutesFromTime(sorted[index - 1].end)
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start < end &&
      start >= previousEnd
    )
  })
}

export function validateClinicIntervals(intervals: TimeInterval[]) {
  return (
    intervals.length <= 8 &&
    validateIntervals(intervals) &&
    intervals.every((interval) => {
      const start = minutesFromTime(interval.start)
      const end = minutesFromTime(interval.end)
      return (
        start >= 9 * 60 &&
        end <= 21 * 60 &&
        start % 30 === 0 &&
        end % 30 === 0
      )
    })
  )
}

export function dateKeyFromDate(date: Date, timeZone = SCHEDULE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function timeFromDate(date: Date, timeZone = SCHEDULE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.hour}:${values.minute}`
}

export function zonedDateTimeToDate(
  dateKey: string,
  time: string,
  timeZone = SCHEDULE_TIME_ZONE,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !isValidTime(time)) {
    throw new Error('La fecha o la hora de agenda no es válida.')
  }

  const [year, month, day] = dateKey.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  const targetUtc = Date.UTC(year, month - 1, day, hours, minutes)
  let guess = targetUtc

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = new Date(guess)
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(observed)
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    const observedUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    )
    const difference = targetUtc - observedUtc
    guess += difference
    if (difference === 0) break
  }

  return new Date(guess)
}

export function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function startOfWeek(dateKey: string) {
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay()
  return shiftDateKey(dateKey, -(weekday === 0 ? 6 : weekday - 1))
}

export function formatDateKey(dateKey: string, options: Intl.DateTimeFormatOptions = {}) {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    ...options,
  }).format(date)
}

export function intervalsForDate(schedule: ScheduleConfig, dateKey: string) {
  const exception = schedule.exceptions.find((item) => item.date === dateKey)
  if (exception) return exception.intervals
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay() || 7
  return schedule.weeklyAvailability[String(weekday)] ?? []
}

export function getAvailableSlots(
  dateKey: string,
  schedule: ScheduleConfig,
  appointments: AgendaAppointment[],
  blocks: AgendaBlock[],
): AvailableSlot[] {
  const intervals = intervalsForDate(schedule, dateKey)
  const duration = schedule.defaultDurationMinutes
  if (duration !== 30 || schedule.durationOptions.length !== 1 || schedule.durationOptions[0] !== 30) {
    return []
  }

  const appointmentsForDate = appointments.filter(
    (appointment) =>
      appointment.dentistId === schedule.dentistId &&
      appointment.status !== 'cancelled' &&
      dateKeyFromDate(appointment.startAt, schedule.timezone) === dateKey,
  )
  const blocksForDate = blocks.filter(
    (block) => block.dentistId === schedule.dentistId && block.date === dateKey,
  )
  const slots: AvailableSlot[] = []

  for (const interval of intervals) {
    const intervalStart = minutesFromTime(interval.start)
    const intervalEnd = minutesFromTime(interval.end)
    for (let start = intervalStart; start + duration <= intervalEnd; start += duration) {
      const end = start + duration
      if (start % 30 !== 0 || start < 9 * 60 || end > 21 * 60) continue
      const appointmentOverlap = appointmentsForDate.some((appointment) => {
        const appointmentStart = minutesFromTime(
          timeFromDate(appointment.startAt, schedule.timezone),
        )
        const appointmentEnd = minutesFromTime(
          timeFromDate(appointment.endAt, schedule.timezone),
        )
        return start < appointmentEnd && end > appointmentStart
      })
      const blockOverlap = blocksForDate.some(
        (block) =>
          start < minutesFromTime(block.endTime) &&
          end > minutesFromTime(block.startTime),
      )
      slots.push({
        start: timeFromMinutes(start),
        end: timeFromMinutes(end),
        available: !appointmentOverlap && !blockOverlap,
        ...(appointmentOverlap
          ? { reason: 'appointment' as const }
          : blockOverlap
            ? { reason: 'block' as const }
            : {}),
      })
    }
  }

  return slots
}

export function hasIntervalOverlap(left: TimeInterval, right: TimeInterval) {
  return (
    minutesFromTime(left.start) < minutesFromTime(right.end) &&
    minutesFromTime(left.end) > minutesFromTime(right.start)
  )
}
