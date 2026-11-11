import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accessibleAgendaIds,
  dateKeyFromDate,
  defaultSchedule,
  getAvailableSlots,
  hasIntervalOverlap,
  intervalsForDate,
  validateClinicIntervals,
  validateIntervals,
  zonedDateTimeToDate,
  type AgendaAppointment,
} from '../src/lib/schedule-logic.ts'

test('grants shared agendas to all supported role and professional combinations', () => {
  assert.deepEqual(accessibleAgendaIds('admin', 'blas-fresia'), [
    'blas-fresia',
    'pamela-moreira',
    'marcela-castro',
  ])
  assert.deepEqual(accessibleAgendaIds('dentist', 'pamela-moreira'), [
    'blas-fresia',
    'pamela-moreira',
    'marcela-castro',
  ])
  assert.deepEqual(accessibleAgendaIds('dentist', 'marcela-castro'), [
    'blas-fresia',
    'pamela-moreira',
    'marcela-castro',
  ])
  assert.deepEqual(accessibleAgendaIds('admin', 'pamela-moreira'), [
    'blas-fresia',
    'pamela-moreira',
    'marcela-castro',
  ])
  assert.deepEqual(accessibleAgendaIds('admin', 'marcela-castro'), [
    'blas-fresia',
    'pamela-moreira',
    'marcela-castro',
  ])
  assert.deepEqual(accessibleAgendaIds('dentist', 'blas-fresia'), [
    'blas-fresia',
    'pamela-moreira',
    'marcela-castro',
  ])
  assert.deepEqual(accessibleAgendaIds('dentist', 'unknown'), [])
})

test('provides 09:00-21:00 weekdays and weekends off', () => {
  const schedule = defaultSchedule('pamela-moreira', 'test-uid')

  assert.deepEqual(schedule.weeklyAvailability['1'], [
    { start: '09:00', end: '21:00' },
  ])
  assert.deepEqual(schedule.weeklyAvailability['6'], [])
  assert.deepEqual(schedule.weeklyAvailability['7'], [])
  assert.equal(schedule.timezone, 'America/Argentina/Tucuman')
})

test('validates work intervals and rejects overlaps or reversed times', () => {
  assert.equal(validateClinicIntervals([{ start: '09:00', end: '21:00' }]), true)
  assert.equal(validateClinicIntervals([{ start: '08:30', end: '21:00' }]), false)
  assert.equal(validateClinicIntervals([{ start: '09:00', end: '20:45' }]), false)
  assert.equal(
    validateClinicIntervals([
      { start: '09:00', end: '12:00' },
      { start: '11:30', end: '21:00' },
    ]),
    false,
  )
  assert.equal(
    validateIntervals([
      { start: '08:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ]),
    true,
  )
  assert.equal(
    validateIntervals([
      { start: '08:00', end: '12:00' },
      { start: '11:30', end: '17:00' },
    ]),
    false,
  )
  assert.equal(validateIntervals([{ start: '13:00', end: '12:00' }]), false)
  assert.equal(
    hasIntervalOverlap(
      { start: '09:00', end: '10:00' },
      { start: '09:30', end: '11:00' },
    ),
    true,
  )
})

test('accounts for appointments, blocks, breaks and date exceptions in availability', () => {
  const schedule = {
    ...defaultSchedule('pamela-moreira', 'test-uid'),
    defaultDurationMinutes: 30,
    weeklyAvailability: {
      ...defaultSchedule('pamela-moreira', 'test-uid').weeklyAvailability,
      '1': [{ start: '09:00', end: '11:00' }],
    },
  }
  const appointmentStart = zonedDateTimeToDate('2026-11-02', '09:00')
  const appointments: AgendaAppointment[] = [
    {
      id: 'appointment-1',
      dentistId: 'pamela-moreira',
      patientId: 'patient-1',
      startAt: appointmentStart,
      endAt: zonedDateTimeToDate('2026-11-02', '09:30'),
      status: 'confirmed',
    },
  ]
  const slots = getAvailableSlots(
    '2026-11-02',
    schedule,
    appointments,
    [
      {
        id: 'block-1',
        dentistId: 'pamela-moreira',
        date: '2026-11-02',
        startTime: '10:00',
        endTime: '10:30',
        reason: 'Reunión',
      },
    ],
  )

  assert.deepEqual(slots, [
    { start: '09:00', end: '09:30', available: false, reason: 'appointment' },
    { start: '09:30', end: '10:00', available: true },
    { start: '10:00', end: '10:30', available: false, reason: 'block' },
    { start: '10:30', end: '11:00', available: true },
  ])
  assert.deepEqual(
    intervalsForDate(
      {
        ...schedule,
        exceptions: [{ date: '2026-11-02', intervals: [], label: 'Día no laborable' }],
      },
      '2026-11-02',
    ),
    [],
  )
})

test('does not let another professional occupancy reduce this agenda availability', () => {
  const schedule = defaultSchedule('pamela-moreira', 'test-uid')
  const appointment: AgendaAppointment = {
    id: 'marcela-appointment',
    dentistId: 'marcela-castro',
    patientId: 'patient-test',
    startAt: zonedDateTimeToDate('2026-11-02', '09:00'),
    endAt: zonedDateTimeToDate('2026-11-02', '09:30'),
    status: 'confirmed',
  }
  const slots = getAvailableSlots('2026-11-02', schedule, [appointment], [])

  assert.equal(slots.find((slot) => slot.start === '09:00')?.available, true)
})

test('offers first and last half-hour slots and excludes weekends and out-of-hours times', () => {
  const schedule = defaultSchedule('pamela-moreira', 'test-uid')
  const slots = getAvailableSlots('2026-11-02', schedule, [], [])

  assert.equal(slots[0]?.start, '09:00')
  assert.equal(slots.at(-1)?.start, '20:30')
  assert.equal(slots.at(-1)?.end, '21:00')
  assert.equal(slots.every((slot) => Number(slot.start.slice(-2)) % 30 === 0), true)
  assert.deepEqual(getAvailableSlots('2026-11-08', schedule, [], []), [])
})

test('converts appointments to and from the Argentina timezone consistently', () => {
  const localAppointment = zonedDateTimeToDate('2026-11-03', '08:00')
  assert.equal(localAppointment.toISOString(), '2026-11-03T11:00:00.000Z')
  assert.equal(dateKeyFromDate(localAppointment), '2026-11-03')
})
