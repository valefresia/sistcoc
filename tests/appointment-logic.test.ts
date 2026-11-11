import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AppointmentBlockOverlapError,
  AppointmentOverlapError,
  AppointmentValidationError,
  canManageAppointment,
  getNextAppointmentStatus,
  getReservationSlotIds,
  getReservationSlotIdsForInterval,
  validateAppointmentDraft,
  type AppointmentInput,
} from '../src/lib/appointment-logic.ts'
import {
  defaultSchedule,
  zonedDateTimeToDate,
  type AgendaAppointment,
  type AgendaBlock,
} from '../src/lib/schedule-logic.ts'

const dentistId = 'pamela-moreira'
const schedule = defaultSchedule(dentistId, 'test-professional-uid')
const baseInput: AppointmentInput = {
  patientId: 'patient-test-1',
  dentistId,
  date: '2026-11-02',
  startTime: '09:00',
  durationMinutes: 30,
  reason: 'Control',
  notes: '',
}

test('creates stable 15-minute reservation locks for appointment and legacy intervals', () => {
  assert.deepEqual(getReservationSlotIds(dentistId, baseInput.date, '09:00', 45), [
    'pamela-moreira_2026-11-02_540',
    'pamela-moreira_2026-11-02_555',
    'pamela-moreira_2026-11-02_570',
  ])
  assert.deepEqual(
    getReservationSlotIdsForInterval(dentistId, baseInput.date, '08:15', '09:00'),
    [
      'pamela-moreira_2026-11-02_495',
      'pamela-moreira_2026-11-02_510',
      'pamela-moreira_2026-11-02_525',
    ],
  )
  assert.throws(
    () => getReservationSlotIdsForInterval(dentistId, baseInput.date, '08:05', '09:00'),
    AppointmentValidationError,
  )
})

test('validates patient, professional hours, 30-minute duration and boundaries', () => {
  const draft = validateAppointmentDraft(baseInput, schedule, [], [], true)
  assert.equal(draft.startMinute, 540)
  assert.equal(draft.endMinute, 570)
  assert.equal(draft.endTime, '09:30')
  assert.equal(draft.professionalUid, 'test-professional-uid')
  assert.equal(draft.startAt.getTime(), zonedDateTimeToDate(baseInput.date, '09:00').getTime())

  assert.throws(
    () => validateAppointmentDraft(baseInput, schedule, [], [], false),
    /paciente seleccionado ya no existe/,
  )
  assert.throws(
    () => validateAppointmentDraft({ ...baseInput, startTime: '21:00' }, schedule, [], [], true),
    /09:00 a 21:00/,
  )
  assert.throws(
    () => validateAppointmentDraft({ ...baseInput, startTime: '08:30' }, schedule, [], [], true),
    /09:00 a 21:00/,
  )
  assert.throws(
    () => validateAppointmentDraft({ ...baseInput, startTime: '09:15' }, schedule, [], [], true),
    /intervalos de 30 minutos/,
  )
  assert.throws(
    () => validateAppointmentDraft({ ...baseInput, durationMinutes: 20 }, schedule, [], [], true),
    /hora o duración/,
  )
  assert.equal(
    validateAppointmentDraft({ ...baseInput, startTime: '20:30' }, schedule, [], [], true).endTime,
    '21:00',
  )
  assert.throws(
    () => validateAppointmentDraft({ ...baseInput, date: '2026-02-29' }, schedule, [], [], true),
    /fecha válida/,
  )
  assert.throws(
    () => validateAppointmentDraft({ ...baseInput, date: '2026-11-31' }, schedule, [], [], true),
    /fecha válida/,
  )
})

test('uses date exceptions and rejects breaks and non-working days', () => {
  const exceptionSchedule = {
    ...schedule,
    exceptions: [
      {
        date: baseInput.date,
        intervals: [{ start: '09:00', end: '12:00' }],
        label: 'Horario especial',
      },
    ],
  }

  assert.doesNotThrow(() =>
    validateAppointmentDraft(
      { ...baseInput, startTime: '09:00' },
      exceptionSchedule,
      [],
      [],
      true,
    ),
  )
  assert.throws(
    () => validateAppointmentDraft({ ...baseInput, startTime: '12:00' }, exceptionSchedule, [], [], true),
    /fuera de la disponibilidad/,
  )
  assert.throws(
    () =>
      validateAppointmentDraft(
        { ...baseInput, date: '2026-11-08' },
        schedule,
        [],
        [],
        true,
      ),
    /fuera de la disponibilidad/,
  )
})

test('rejects overlaps with active appointments but cancelled appointments do not reserve time', () => {
  const occupied: AgendaAppointment = {
    id: 'existing',
    dentistId,
    patientId: 'patient-test-2',
    startAt: zonedDateTimeToDate(baseInput.date, '09:15'),
    endAt: zonedDateTimeToDate(baseInput.date, '09:45'),
    status: 'confirmed',
  }
  assert.throws(
    () => validateAppointmentDraft(baseInput, schedule, [occupied], [], true),
    AppointmentOverlapError,
  )
  assert.doesNotThrow(() =>
    validateAppointmentDraft(
      baseInput,
      schedule,
      [{ ...occupied, status: 'cancelled' }],
      [],
      true,
    ),
  )
  assert.doesNotThrow(() =>
    validateAppointmentDraft(
      { ...baseInput, startTime: '09:30' },
      schedule,
      [
        {
          ...occupied,
          startAt: zonedDateTimeToDate(baseInput.date, '09:00'),
          endAt: zonedDateTimeToDate(baseInput.date, '09:30'),
        },
      ],
      [],
      true,
    ),
  )
})

test('rejects a block conflict and validates edits excluding their own appointment', () => {
  const block: AgendaBlock = {
    id: 'block-1',
    dentistId,
    date: baseInput.date,
    startTime: '09:15',
    endTime: '09:45',
    reason: 'Reunión',
  }
  assert.throws(
    () => validateAppointmentDraft(baseInput, schedule, [], [block], true),
    AppointmentBlockOverlapError,
  )

  const ownAppointment: AgendaAppointment = {
    id: 'appointment-edit',
    dentistId,
    patientId: baseInput.patientId,
    startAt: zonedDateTimeToDate(baseInput.date, '09:00'),
    endAt: zonedDateTimeToDate(baseInput.date, '09:30'),
    status: 'pending',
  }
  assert.doesNotThrow(() =>
    validateAppointmentDraft(
      baseInput,
      schedule,
      [ownAppointment],
      [],
      true,
      ownAppointment.id,
    ),
  )

  const otherAppointment: AgendaAppointment = {
    ...ownAppointment,
    id: 'appointment-other',
    startAt: zonedDateTimeToDate(baseInput.date, '09:15'),
    endAt: zonedDateTimeToDate(baseInput.date, '09:45'),
  }
  assert.throws(
    () =>
      validateAppointmentDraft(
        { ...baseInput, startTime: '09:30' },
        schedule,
        [ownAppointment, otherAppointment],
        [],
        true,
        ownAppointment.id,
      ),
    AppointmentOverlapError,
  )
})

test('enforces role-scoped appointment access and valid state transitions', () => {
  assert.equal(canManageAppointment('admin', 'blas-fresia', 'pamela-moreira'), true)
  assert.equal(canManageAppointment('dentist', 'pamela-moreira', 'pamela-moreira'), true)
  assert.equal(canManageAppointment('dentist', 'pamela-moreira', 'marcela-castro'), true)
  assert.equal(canManageAppointment('dentist', 'marcela-castro', 'blas-fresia'), true)
  assert.equal(canManageAppointment('dentist', 'blas-fresia', 'blas-fresia'), true)
  assert.equal(canManageAppointment('admin', 'pamela-moreira', 'marcela-castro'), true)
  assert.equal(canManageAppointment('dentist', 'other-professional', 'blas-fresia'), false)

  assert.equal(getNextAppointmentStatus('pending', 'confirmed'), 'confirmed')
  assert.equal(getNextAppointmentStatus('pending', 'cancelled'), 'cancelled')
  assert.equal(getNextAppointmentStatus('confirmed', 'cancelled'), 'cancelled')
  assert.throws(() => getNextAppointmentStatus('confirmed', 'confirmed'), /pendientes/)
  assert.throws(() => getNextAppointmentStatus('cancelled', 'cancelled'), /cancelado/)
})
