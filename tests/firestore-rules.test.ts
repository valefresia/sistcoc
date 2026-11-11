import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Timestamp,
} from 'firebase/firestore'

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST
const emulatorProjectId = 'demo-sistcoc-rules-test'
const testUid = (environmentVariable: string, fallback: string) =>
  process.env[environmentVariable]?.trim() || fallback

test(
  'Firestore security rules',
  { skip: emulatorAddress ? false : 'FIRESTORE_EMULATOR_HOST is not set; rules are not verified.' },
  async (suite) => {
    assert.match(
      emulatorAddress!,
      /^127\.0\.0\.1:\d+$/,
      'Rules tests must connect to a local Firestore Emulator at 127.0.0.1.',
    )
    const [host, rawPort] = emulatorAddress!.split(':')
    const environment = await initializeTestEnvironment({
      projectId: emulatorProjectId,
      firestore: {
        host,
        port: Number(rawPort),
        rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
      },
    })

    const actors = {
      blas: {
        uid: testUid('RULES_TEST_UID_BLAS', 'blas-uid'),
        role: 'admin',
        dentistId: 'blas-fresia',
      },
      pamela: {
        uid: testUid('RULES_TEST_UID_PAMELA', 'pamela-uid'),
        role: 'admin',
        dentistId: 'pamela-moreira',
      },
      marcela: {
        uid: testUid('RULES_TEST_UID_MARCELA', 'marcela-uid'),
        role: 'admin',
        dentistId: 'marcela-castro',
      },
    } as const

    const history = {
      diseases: { status: 'pending', details: '' },
      allergies: { status: 'none_declared', details: '' },
      medication: { status: 'pending', details: '' },
      medicalBackground: { status: 'pending', details: '' },
      dentalBackground: { status: 'pending', details: '' },
      generalNotes: { status: 'pending', details: '' },
    }

    const timestamp = () => Timestamp.fromDate(new Date('2026-01-01T12:00:00Z'))
    const clinicalRecord = (patientId: string, actorUid = actors.pamela.uid) => ({
      patientId,
      medicalHistory: history,
      auditLogId: 'seed-history-log',
      createdAt: timestamp(),
      createdBy: actorUid,
      updatedAt: timestamp(),
      updatedBy: actorUid,
    })
    const consultation = (actorUid = actors.pamela.uid) => ({
      appointmentId: null,
      professionalUid: actorUid,
      consultationDate: timestamp(),
      reason: 'Control',
      diagnosis: 'Sin hallazgos agudos',
      clinicalNotes: '',
      treatmentIndicated: '',
      treatmentPerformed: '',
      recommendations: '',
      nextControl: null,
      createdAt: timestamp(),
      createdBy: actorUid,
      updatedAt: timestamp(),
      updatedBy: actorUid,
      auditLogId: 'seed-consultation-log',
    })
    const treatment = (actorUid = actors.pamela.uid) => ({
      name: 'Restauración',
      planDescription: 'Pieza 16',
      status: 'planned',
      professionalUid: actorUid,
      createdAt: timestamp(),
      createdBy: actorUid,
      updatedAt: timestamp(),
      updatedBy: actorUid,
      auditLogId: 'seed-treatment-log',
    })
    const audit = (entity: string, entityId: string, operation: string, actorUid: string) => ({
      entity,
      entityId,
      operation,
      actorUid,
      createdAt: serverTimestamp(),
    })
    const patient = (
      auditLogId: string,
      actorUid = actors.pamela.uid,
      dni = '12345678',
    ) => ({
      firstName: 'Ana',
      lastName: 'Prueba',
      dni,
      birthDate: Timestamp.fromDate(new Date('2000-01-01T00:00:00Z')),
      phone: '3815551234',
      email: '',
      address: '',
      observations: '',
      firstNameSearch: 'ana',
      lastNameSearch: 'prueba',
      fullNameSearch: 'ana prueba',
      auditLogId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: actorUid,
      updatedBy: actorUid,
    })

    async function resetAndSeed() {
      await environment.clearFirestore()
      await environment.withSecurityRulesDisabled(async (context) => {
        const firestore = context.firestore()
        const batch = writeBatch(firestore)
        for (const actor of Object.values(actors)) {
          batch.set(doc(firestore, `users/${actor.uid}`), {
            uid: actor.uid,
            role: actor.role,
            dentistId: actor.dentistId,
          })
        }
        batch.set(doc(firestore, 'users/unrelated-uid'), {
          uid: 'unrelated-uid',
          role: 'dentist',
          dentistId: 'unrelated-dentist',
        })
        batch.set(doc(firestore, 'patients/patient-1'), { firstName: 'Paciente' })
        batch.set(doc(firestore, 'patients/patient-2'), { firstName: 'Paciente' })
        await batch.commit()
      })
    }

    function dbFor(actor: typeof actors[keyof typeof actors]) {
      return environment.authenticatedContext(actor.uid, {
        role: actor.role,
        dentistId: actor.dentistId,
      }).firestore()
    }

    async function seed(entries: Array<[string, Record<string, unknown>]>) {
      await environment.withSecurityRulesDisabled(async (context) => {
        const firestore = context.firestore()
        const batch = writeBatch(firestore)
        for (const [path, data] of entries) batch.set(doc(firestore, path), data)
        await batch.commit()
      })
    }

    try {
      await suite.test('all three administrator profiles can load profiles and create patients', async () => {
        const users = [
          ['12345671', actors.blas],
          ['12345672', actors.pamela],
          ['12345673', actors.marcela],
        ] as const

        for (const [dni, actor] of users) {
          await resetAndSeed()
          const db = dbFor(actor)
          await assertSucceeds(getDoc(doc(db, `users/${actor.uid}`)))
          await assertSucceeds(getDoc(doc(db, 'patients/patient-1')))

          const batch = writeBatch(db)
          batch.set(doc(db, `patients/${actor.dentistId}-patient`), patient(
            `${actor.dentistId}-create-log`,
            actor.uid,
            dni,
          ))
          batch.set(doc(db, `patientDniIndex/${dni}`), {
            patientId: `${actor.dentistId}-patient`,
            dni,
            createdAt: serverTimestamp(),
            createdBy: actor.uid,
          })
          batch.set(
            doc(db, `auditLogs/${actor.dentistId}-create-log`),
            audit(
              'patient',
              `${actor.dentistId}-patient`,
              'patient_created',
              actor.uid,
            ),
          )
          await assertSucceeds(batch.commit())
        }
      })

      await suite.test('all three administrator profiles can create clinical histories', async () => {
        for (const actor of Object.values(actors)) {
          await resetAndSeed()
          const db = dbFor(actor)
          const batch = writeBatch(db)
          batch.set(doc(db, 'medicalRecords/patient-1'), {
            ...clinicalRecord('patient-1', actor.uid),
            auditLogId: `${actor.dentistId}-history-log`,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: actor.uid,
            updatedBy: actor.uid,
          })
          batch.set(
            doc(db, `auditLogs/${actor.dentistId}-history-log`),
            audit('medicalRecord', 'patient-1', 'history_created', actor.uid),
          )
          await assertSucceeds(batch.commit())
        }
      })

      await suite.test('requires a new matching audit in the atomic patient creation', async () => {
        await resetAndSeed()
        const db = dbFor(actors.pamela)
        const freshPatient = patient('patient-create-log')
        const batch = writeBatch(db)
        batch.set(doc(db, 'patients/patient-new'), freshPatient)
        batch.set(doc(db, 'patientDniIndex/12345678'), {
          patientId: 'patient-new',
          dni: '12345678',
          createdAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
        })
        batch.set(
          doc(db, 'auditLogs/patient-create-log'),
          audit('patient', 'patient-new', 'patient_created', actors.pamela.uid),
        )
        await assertSucceeds(batch.commit())

        await resetAndSeed()
        const missingAudit = writeBatch(db)
        const missingPatientData = patient('missing-audit')
        missingAudit.set(doc(db, 'patients/patient-no-audit'), missingPatientData)
        missingAudit.set(doc(db, 'patientDniIndex/12345678'), {
          patientId: 'patient-no-audit',
          dni: '12345678',
          createdAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
        })
        await assertFails(missingAudit.commit())

        await resetAndSeed()
        await seed([[
          'auditLogs/old-patient-log',
          {
            entity: 'patient',
            entityId: 'patient-reused',
            operation: 'patient_created',
            actorUid: actors.pamela.uid,
            createdAt: timestamp(),
          },
        ]])
        const reusedAudit = writeBatch(db)
        const reusedPatientData = patient('old-patient-log')
        reusedAudit.set(doc(db, 'patients/patient-reused'), reusedPatientData)
        reusedAudit.set(doc(db, 'patientDniIndex/12345678'), {
          patientId: 'patient-reused',
          dni: '12345678',
          createdAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
        })
        await assertFails(reusedAudit.commit())
      })

      await suite.test('permits a new medical history and matching audit in one batch', async () => {
        await resetAndSeed()
        const db = dbFor(actors.pamela)
        const batch = writeBatch(db)
        batch.set(doc(db, 'medicalRecords/patient-1'), {
          ...clinicalRecord('patient-1'),
          medicalHistory: history,
          auditLogId: 'history-create-log',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
          updatedBy: actors.pamela.uid,
        })
        batch.set(
          doc(db, 'auditLogs/history-create-log'),
          audit('medicalRecord', 'patient-1', 'history_created', actors.pamela.uid),
        )
        await assertSucceeds(batch.commit())
      })

      await suite.test('denies clinical writes without an audit or with a reused audit ID', async () => {
        await resetAndSeed()
        const db = dbFor(actors.pamela)
        const withoutAudit = writeBatch(db)
        withoutAudit.set(doc(db, 'medicalRecords/patient-1'), {
          ...clinicalRecord('patient-1'),
          auditLogId: 'missing-log',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
          updatedBy: actors.pamela.uid,
        })
        await assertFails(withoutAudit.commit())

        await seed([[
          'auditLogs/old-log',
          {
            entity: 'medicalRecord',
            entityId: 'patient-1',
            operation: 'history_created',
            actorUid: actors.pamela.uid,
            createdAt: timestamp(),
          },
        ]])
        const reusedAudit = writeBatch(db)
        reusedAudit.set(doc(db, 'medicalRecords/patient-1'), {
          ...clinicalRecord('patient-1'),
          auditLogId: 'old-log',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
          updatedBy: actors.pamela.uid,
        })
        await assertFails(reusedAudit.commit())
      })

      await suite.test('requires and stores the previous medical history on update', async () => {
        await resetAndSeed()
        await seed([['medicalRecords/patient-1', clinicalRecord('patient-1')]])
        const db = dbFor(actors.pamela)
        const nextHistory = { ...history, diseases: { status: 'recorded', details: 'Asma' } }
        const batch = writeBatch(db)
        batch.update(doc(db, 'medicalRecords/patient-1'), {
          medicalHistory: nextHistory,
          auditLogId: 'history-update-log',
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
        })
        batch.set(doc(db, 'medicalRecords/patient-1/historyRevisions/history-update-log'), {
          patientId: 'patient-1',
          medicalHistory: history,
          createdAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
          auditLogId: 'history-update-log',
        })
        batch.set(
          doc(db, 'auditLogs/history-update-log'),
          audit(
            'medicalRecord',
            'patient-1/historyRevisions/history-update-log',
            'history_updated',
            actors.pamela.uid,
          ),
        )
        await assertSucceeds(batch.commit())
        await assertFails(
          updateDoc(doc(db, 'medicalRecords/patient-1/historyRevisions/history-update-log'), {
            createdBy: actors.marcela.uid,
          }),
        )
        await assertFails(
          deleteDoc(doc(db, 'medicalRecords/patient-1/historyRevisions/history-update-log')),
        )

        await resetAndSeed()
        await seed([['medicalRecords/patient-1', clinicalRecord('patient-1')]])
        const missingRevision = writeBatch(db)
        missingRevision.update(doc(db, 'medicalRecords/patient-1'), {
          medicalHistory: nextHistory,
          auditLogId: 'history-no-revision-log',
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
        })
        missingRevision.set(
          doc(db, 'auditLogs/history-no-revision-log'),
          audit(
            'medicalRecord',
            'patient-1/historyRevisions/history-no-revision-log',
            'history_updated',
            actors.pamela.uid,
          ),
        )
        await assertFails(missingRevision.commit())
      })

      await suite.test('requires audit and immutable previous snapshots for consultations and treatments', async () => {
        await resetAndSeed()
        await seed([
          ['medicalRecords/patient-1', clinicalRecord('patient-1')],
          ['medicalRecords/patient-1/consultations/consultation-1', consultation()],
          ['medicalRecords/patient-1/treatments/treatment-1', treatment()],
        ])
        const db = dbFor(actors.pamela)

        const consultationUpdate = writeBatch(db)
        consultationUpdate.update(
          doc(db, 'medicalRecords/patient-1/consultations/consultation-1'),
          {
            diagnosis: 'Actualizado',
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
            auditLogId: 'consultation-update-log',
          },
        )
        consultationUpdate.set(
          doc(db, 'medicalRecords/patient-1/consultations/consultation-1/revisions/consultation-update-log'),
          {
            patientId: 'patient-1',
            consultation: consultation(),
            createdAt: serverTimestamp(),
            createdBy: actors.pamela.uid,
            auditLogId: 'consultation-update-log',
          },
        )
        consultationUpdate.set(
          doc(db, 'auditLogs/consultation-update-log'),
          audit(
            'consultation',
            'patient-1/consultations/consultation-1',
            'consultation_updated',
            actors.pamela.uid,
          ),
        )
        await assertSucceeds(consultationUpdate.commit())
        await assertFails(
          updateDoc(
            doc(db, 'medicalRecords/patient-1/consultations/consultation-1/revisions/consultation-update-log'),
            { createdBy: actors.marcela.uid },
          ),
        )

        const treatmentUpdate = writeBatch(db)
        treatmentUpdate.update(
          doc(db, 'medicalRecords/patient-1/treatments/treatment-1'),
          {
            name: 'Plan actualizado',
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
            auditLogId: 'treatment-update-log',
          },
        )
        treatmentUpdate.set(
          doc(db, 'medicalRecords/patient-1/treatments/treatment-1/revisions/treatment-update-log'),
          {
            patientId: 'patient-1',
            treatment: treatment(),
            createdAt: serverTimestamp(),
            createdBy: actors.pamela.uid,
            auditLogId: 'treatment-update-log',
          },
        )
        treatmentUpdate.set(
          doc(db, 'auditLogs/treatment-update-log'),
          audit(
            'treatment',
            'patient-1/treatments/treatment-1',
            'treatment_updated',
            actors.pamela.uid,
          ),
        )
        await assertSucceeds(treatmentUpdate.commit())
        await assertFails(
          deleteDoc(
            doc(db, 'medicalRecords/patient-1/treatments/treatment-1/revisions/treatment-update-log'),
          ),
        )

        const standaloneAudit = dbFor(actors.marcela)
        await assertFails(
          setDoc(
            doc(standaloneAudit, 'auditLogs/unrelated-clinical-log'),
            audit(
              'treatment',
              'patient-1/treatments/treatment-1',
              'treatment_updated',
              actors.marcela.uid,
            ),
          ),
        )

        await resetAndSeed()
        await seed([
          ['medicalRecords/patient-1', clinicalRecord('patient-1')],
          ['medicalRecords/patient-1/consultations/consultation-1', consultation()],
          ['medicalRecords/patient-1/treatments/treatment-1', treatment()],
        ])
        const noConsultationRevision = writeBatch(db)
        noConsultationRevision.update(
          doc(db, 'medicalRecords/patient-1/consultations/consultation-1'),
          {
            diagnosis: 'Cambio sin revisión',
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
            auditLogId: 'consultation-no-revision-log',
          },
        )
        noConsultationRevision.set(
          doc(db, 'auditLogs/consultation-no-revision-log'),
          audit(
            'consultation',
            'patient-1/consultations/consultation-1',
            'consultation_updated',
            actors.pamela.uid,
          ),
        )
        await assertFails(noConsultationRevision.commit())

        const noTreatmentRevision = writeBatch(db)
        noTreatmentRevision.update(
          doc(db, 'medicalRecords/patient-1/treatments/treatment-1'),
          {
            name: 'Cambio sin revisión',
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
            auditLogId: 'treatment-no-revision-log',
          },
        )
        noTreatmentRevision.set(
          doc(db, 'auditLogs/treatment-no-revision-log'),
          audit(
            'treatment',
            'patient-1/treatments/treatment-1',
            'treatment_updated',
            actors.pamela.uid,
          ),
        )
        await assertFails(noTreatmentRevision.commit())
      })

      await suite.test('requires fresh audit logs when creating consultations and treatments', async () => {
        await resetAndSeed()
        await seed([['medicalRecords/patient-1', clinicalRecord('patient-1')]])
        const db = dbFor(actors.pamela)

        const consultationCreate = writeBatch(db)
        consultationCreate.set(
          doc(db, 'medicalRecords/patient-1/consultations/consultation-create'),
          {
            ...consultation(),
            createdAt: serverTimestamp(),
            createdBy: actors.pamela.uid,
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
            auditLogId: 'consultation-create-log',
          },
        )
        consultationCreate.set(
          doc(db, 'auditLogs/consultation-create-log'),
          audit(
            'consultation',
            'patient-1/consultations/consultation-create',
            'consultation_created',
            actors.pamela.uid,
          ),
        )
        await assertSucceeds(consultationCreate.commit())

        const treatmentCreate = writeBatch(db)
        treatmentCreate.set(
          doc(db, 'medicalRecords/patient-1/treatments/treatment-create'),
          {
            ...treatment(),
            createdAt: serverTimestamp(),
            createdBy: actors.pamela.uid,
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
            auditLogId: 'treatment-create-log',
          },
        )
        treatmentCreate.set(
          doc(db, 'auditLogs/treatment-create-log'),
          audit(
            'treatment',
            'patient-1/treatments/treatment-create',
            'treatment_created',
            actors.pamela.uid,
          ),
        )
        await assertSucceeds(treatmentCreate.commit())

        const missingAudit = writeBatch(db)
        missingAudit.set(
          doc(db, 'medicalRecords/patient-1/treatments/treatment-without-audit'),
          {
            ...treatment(),
            createdAt: serverTimestamp(),
            createdBy: actors.pamela.uid,
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
            auditLogId: 'missing-treatment-log',
          },
        )
        await assertFails(missingAudit.commit())

        const consultationWithoutAudit = writeBatch(db)
        consultationWithoutAudit.set(
          doc(db, 'medicalRecords/patient-1/consultations/consultation-without-audit'),
          {
            ...consultation(),
            createdAt: serverTimestamp(),
            createdBy: actors.pamela.uid,
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
            auditLogId: 'missing-consultation-log',
          },
        )
        await assertFails(consultationWithoutAudit.commit())
      })

      await suite.test('requires a new audit and prior treatment state for evolutions', async () => {
        await resetAndSeed()
        const original = treatment()
        await seed([
          ['medicalRecords/patient-1', clinicalRecord('patient-1')],
          ['medicalRecords/patient-1/treatments/treatment-1', original],
        ])
        const db = dbFor(actors.marcela)
        const batch = writeBatch(db)
        batch.update(doc(db, 'medicalRecords/patient-1/treatments/treatment-1'), {
          status: 'in_progress',
          auditLogId: 'evolution-log',
          updatedAt: serverTimestamp(),
          updatedBy: actors.marcela.uid,
        })
        batch.set(
          doc(db, 'medicalRecords/patient-1/treatments/treatment-1/revisions/evolution-log'),
          {
            patientId: 'patient-1',
            treatment: original,
            createdAt: serverTimestamp(),
            createdBy: actors.marcela.uid,
            auditLogId: 'evolution-log',
          },
        )
        batch.set(
          doc(db, 'medicalRecords/patient-1/treatments/treatment-1/evolutions/evolution-1'),
          {
            date: timestamp(),
            professionalUid: actors.marcela.uid,
            procedureDescription: 'Control',
            evolution: 'Tratamiento iniciado',
            notes: '',
            status: 'in_progress',
            createdAt: serverTimestamp(),
            createdBy: actors.marcela.uid,
            auditLogId: 'evolution-log',
          },
        )
        batch.set(
          doc(db, 'auditLogs/evolution-log'),
          audit(
            'treatmentEvolution',
            'patient-1/treatments/treatment-1/evolutions/evolution-1',
            'treatment_evolution_recorded',
            actors.marcela.uid,
          ),
        )
        await assertSucceeds(batch.commit())
      })

      await suite.test('rejects attributing a clinical operation to another professional', async () => {
        await resetAndSeed()
        await seed([['medicalRecords/patient-1', clinicalRecord('patient-1')]])
        const db = dbFor(actors.pamela)
        const batch = writeBatch(db)
        batch.set(
          doc(db, 'medicalRecords/patient-1/consultations/attributed-consultation'),
          {
            ...consultation(actors.marcela.uid),
            createdAt: serverTimestamp(),
            createdBy: actors.pamela.uid,
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
            auditLogId: 'attributed-consultation-log',
          },
        )
        batch.set(
          doc(db, 'auditLogs/attributed-consultation-log'),
          audit(
            'consultation',
            'patient-1/consultations/attributed-consultation',
            'consultation_created',
            actors.pamela.uid,
          ),
        )
        await assertFails(batch.commit())
      })

      await suite.test('permits shared 30-minute bookings only within the configured clinic hours', async () => {
        await resetAndSeed()
        const target = actors.pamela
        const schedule = {
          dentistId: target.dentistId,
          professionalUid: target.uid,
          timezone: 'America/Argentina/Tucuman',
          weeklyAvailability: {
            '1': [{ start: '09:00', end: '21:00' }],
            '2': [{ start: '09:00', end: '21:00' }],
            '3': [{ start: '09:00', end: '21:00' }],
            '4': [{ start: '09:00', end: '21:00' }],
            '5': [{ start: '09:00', end: '21:00' }],
            '6': [],
            '7': [],
          },
          defaultDurationMinutes: 30,
          durationOptions: [30],
          exceptions: [],
          exceptionsByDate: {},
          updatedAt: timestamp(),
          updatedBy: target.uid,
        }
        await seed([[`schedules/${target.dentistId}`, schedule]])

        async function createAppointment(
          id: string,
          startTime: string,
          actor: typeof actors[keyof typeof actors],
          includeAudit = true,
        ) {
          const [hours, minutes] = startTime.split(':').map(Number)
          const startMinute = hours * 60 + minutes
          const endMinute = startMinute + 30
          const endTime = `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`
          const slotIds = [startMinute, startMinute + 15].map(
            (minute) => `${target.dentistId}_2026-11-06_${minute}`,
          )
          const db = dbFor(actor)
          const batch = writeBatch(db)
          batch.set(doc(db, `appointments/${id}`), {
            patientId: 'patient-1',
            dentistId: target.dentistId,
            professionalUid: target.uid,
            localDate: '2026-11-06',
            startTime,
            endTime,
            startMinute,
            endMinute,
            startAt: Timestamp.fromDate(new Date(`2026-11-06T${startTime}:00-03:00`)),
            endAt: Timestamp.fromDate(new Date(`2026-11-06T${endTime}:00-03:00`)),
            durationMinutes: 30,
            status: 'pending',
            reason: 'Control',
            notes: '',
            slotIds,
            auditLogId: `${id}-audit`,
            createdAt: serverTimestamp(),
            createdBy: actor.uid,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
          })
          for (const [index, slotId] of slotIds.entries()) {
            batch.set(doc(db, `appointmentReservations/${slotId}`), {
              slotId,
              slotMinute: startMinute + index * 15,
              ownerId: id,
              ownerType: 'appointment',
              dentistId: target.dentistId,
              date: '2026-11-06',
              createdBy: actor.uid,
              createdAt: serverTimestamp(),
            })
          }
          if (includeAudit) {
            batch.set(
              doc(db, `auditLogs/${id}-audit`),
              audit('appointment', id, 'appointment_created', actor.uid),
            )
          }
          return batch.commit()
        }

        await assertSucceeds(createAppointment('shared-start', '09:00', actors.marcela))
        await assertSucceeds(createAppointment('shared-last', '20:30', actors.blas))
        await assertFails(createAppointment('before-open', '08:30', actors.blas))
        await assertFails(createAppointment('after-close', '21:00', actors.blas))
        await assertFails(createAppointment('off-grid', '09:15', actors.blas))
        await assertFails(createAppointment('duplicate-slot', '09:00', actors.pamela))
        await assertFails(createAppointment('without-audit', '10:00', actors.blas, false))
      })

      await suite.test('allows Pamela and Marcela to confirm one another’s appointments with audit', async () => {
        await resetAndSeed()
        const appointments = [
          {
            id: 'marcela-appointment',
            target: actors.marcela,
            actor: actors.pamela,
          },
          {
            id: 'pamela-appointment',
            target: actors.pamela,
            actor: actors.marcela,
          },
        ]
        const seedEntries: Array<[string, Record<string, unknown>]> = []
        for (const { id, target } of appointments) {
          const slotId = `${target.dentistId}_2026-11-06_480`
          seedEntries.push(
            [
              `appointments/${id}`,
              {
                patientId: 'patient-1',
                dentistId: target.dentistId,
                professionalUid: target.uid,
                localDate: '2026-11-06',
                startTime: '08:00',
                endTime: '08:15',
                startMinute: 480,
                endMinute: 495,
                startAt: Timestamp.fromDate(new Date('2026-11-06T11:00:00Z')),
                endAt: Timestamp.fromDate(new Date('2026-11-06T11:15:00Z')),
                durationMinutes: 15,
                status: 'pending',
                reason: 'Control',
                notes: '',
                slotIds: [slotId],
                auditLogId: `seed-${id}`,
                createdAt: timestamp(),
                createdBy: target.uid,
                updatedAt: timestamp(),
                updatedBy: target.uid,
              },
            ],
            [
              `appointmentReservations/${slotId}`,
              {
                slotId,
                slotMinute: 480,
                ownerId: id,
                ownerType: 'appointment',
                dentistId: target.dentistId,
                date: '2026-11-06',
                createdBy: target.uid,
                createdAt: timestamp(),
              },
            ],
          )
        }
        await seed(seedEntries)

        for (const { id, actor } of appointments) {
          const db = dbFor(actor)
          const batch = writeBatch(db)
          batch.update(doc(db, `appointments/${id}`), {
            status: 'confirmed',
            auditLogId: `confirm-${id}`,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
          })
          batch.set(
            doc(db, `auditLogs/confirm-${id}`),
            audit('appointment', id, 'appointment_confirmed', actor.uid),
          )
          await assertSucceeds(batch.commit())
        }

        const noAuditSlot = `${actors.marcela.dentistId}_2026-11-06_480`
        await seed([
          [
            'appointments/appointment-without-audit',
            {
              patientId: 'patient-1',
              dentistId: actors.marcela.dentistId,
              professionalUid: actors.marcela.uid,
              localDate: '2026-11-06',
              startTime: '08:00',
              endTime: '08:15',
              startMinute: 480,
              endMinute: 495,
              startAt: Timestamp.fromDate(new Date('2026-11-06T11:00:00Z')),
              endAt: Timestamp.fromDate(new Date('2026-11-06T11:15:00Z')),
              durationMinutes: 15,
              status: 'pending',
              reason: 'Control',
              notes: '',
              slotIds: [noAuditSlot],
              auditLogId: 'unused-appointment-log',
              createdAt: timestamp(),
              createdBy: actors.marcela.uid,
              updatedAt: timestamp(),
              updatedBy: actors.marcela.uid,
            },
          ],
          [
            `appointmentReservations/${noAuditSlot}`,
            {
              slotId: noAuditSlot,
              slotMinute: 480,
              ownerId: 'appointment-without-audit',
              ownerType: 'appointment',
              dentistId: actors.marcela.dentistId,
              date: '2026-11-06',
              createdBy: actors.marcela.uid,
              createdAt: timestamp(),
            },
          ],
          [
            'auditLogs/old-appointment-log',
            audit('appointment', 'appointment-without-audit', 'appointment_created', actors.marcela.uid),
          ],
        ])
        const noAuditDb = dbFor(actors.pamela)
        await assertFails(
          updateDoc(doc(noAuditDb, 'appointments/appointment-without-audit'), {
            status: 'confirmed',
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
          }),
        )
        await assertFails(
          updateDoc(doc(noAuditDb, 'appointments/appointment-without-audit'), {
            status: 'confirmed',
            auditLogId: 'old-appointment-log',
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
          }),
        )
      })

      await suite.test('all three professionals can configure schedules and create blocks', async () => {
        await resetAndSeed()
        const professionals = Object.values(actors)
        const dentistIds = professionals.map(({ dentistId }) => dentistId)
        for (const actor of professionals) {
          const db = dbFor(actor)
          for (const dentistId of dentistIds) {
            const target = professionals.find((item) => item.dentistId === dentistId)!
            await assertSucceeds(setDoc(doc(db, `schedules/${dentistId}`), {
              dentistId,
              professionalUid: target.uid,
              timezone: 'America/Argentina/Tucuman',
              weeklyAvailability: {
                '1': [{ start: '09:00', end: '21:00' }],
                '2': [{ start: '09:00', end: '21:00' }],
                '3': [{ start: '09:00', end: '21:00' }],
                '4': [{ start: '09:00', end: '21:00' }],
                '5': [{ start: '09:00', end: '21:00' }],
                '6': [],
                '7': [],
              },
              defaultDurationMinutes: 30,
              durationOptions: [30],
              exceptions: [],
              exceptionsByDate: {},
              updatedAt: serverTimestamp(),
              updatedBy: actor.uid,
            }))
          }
          await assertFails(
            updateDoc(doc(db, `users/${actors.blas.uid}`), { role: 'dentist' }),
          )

          const slotId = `${actor.dentistId}_2026-11-06_480`
          const blockId = `${actor.uid}-block`
          const blockBatch = writeBatch(db)
          blockBatch.set(doc(db, `scheduleBlocks/${blockId}`), {
            dentistId: actor.dentistId,
            professionalUid: actor.uid,
            date: '2026-11-06',
            startTime: '08:00',
            endTime: '08:15',
            startMinute: 480,
            endMinute: 495,
            reason: 'Bloqueo de prueba',
            slotIds: [slotId],
            createdBy: actor.uid,
            createdAt: serverTimestamp(),
          })
          blockBatch.set(doc(db, `appointmentReservations/${slotId}`), {
            slotId,
            slotMinute: 480,
            ownerId: blockId,
            ownerType: 'block',
            dentistId: actor.dentistId,
            date: '2026-11-06',
            createdBy: actor.uid,
            createdAt: serverTimestamp(),
          })
          await assertSucceeds(blockBatch.commit())
        }
      })

      await suite.test('limits professional profile queries to the three authorized profiles', async () => {
        await resetAndSeed()
        const professionals = Object.values(actors)
        const dentistIds = professionals.map((actor) => actor.dentistId)
        for (const actor of professionals) {
          const db = dbFor(actor)
          for (const dentistId of dentistIds) {
            const profiles = await assertSucceeds(
              getDocs(query(
                collection(db, 'users'),
                where('dentistId', '==', dentistId),
                where('role', 'in', ['admin', 'dentist']),
              )),
            )
            assert.equal(profiles.size, 1)
          }
        }

        const db = dbFor(actors.pamela)
        await assertFails(getDoc(doc(db, 'users/unrelated-uid')))
        const mismatchedClaimsDb = environment.authenticatedContext(
          actors.pamela.uid,
          { role: 'dentist', dentistId: 'marcela-castro' },
        ).firestore()
        await assertSucceeds(getDoc(doc(mismatchedClaimsDb, `users/${actors.pamela.uid}`)))
        await assertFails(getDoc(doc(mismatchedClaimsDb, 'patients/patient-1')))
        await assertFails(
          getDocs(query(
            collection(db, 'users'),
            where('dentistId', '==', 'unrelated-dentist'),
            where('role', '==', 'dentist'),
          )),
        )
      })

      await suite.test('professional administration requires matching profile and custom claims', async () => {
        await resetAndSeed()
        const mismatchedAdmin = environment.authenticatedContext(actors.pamela.uid, {
          role: 'admin',
          dentistId: 'blas-fresia',
        }).firestore()
        await assertFails(setDoc(doc(mismatchedAdmin, 'schedules/blas-fresia'), {
          dentistId: actors.blas.dentistId,
          professionalUid: actors.blas.uid,
          timezone: 'America/Argentina/Tucuman',
          weeklyAvailability: {
            '1': [{ start: '09:00', end: '21:00' }],
            '2': [{ start: '09:00', end: '21:00' }],
            '3': [{ start: '09:00', end: '21:00' }],
            '4': [{ start: '09:00', end: '21:00' }],
            '5': [{ start: '09:00', end: '21:00' }],
            '6': [],
            '7': [],
          },
          defaultDurationMinutes: 30,
          durationOptions: [30],
          exceptions: [],
          exceptionsByDate: {},
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
        }))
      })

      await suite.test('allows supported role claims for any of the three professional IDs', async () => {
        await resetAndSeed()
        await environment.withSecurityRulesDisabled(async (context) => {
          const firestore = context.firestore()
          await updateDoc(doc(firestore, `users/${actors.pamela.uid}`), {
            role: 'admin',
          })
        })
        const pamelaAdmin = environment.authenticatedContext(actors.pamela.uid, {
          role: 'admin',
          dentistId: actors.pamela.dentistId,
        }).firestore()
        await assertSucceeds(setDoc(doc(pamelaAdmin, `schedules/${actors.pamela.dentistId}`), {
          dentistId: actors.pamela.dentistId,
          professionalUid: actors.pamela.uid,
          timezone: 'America/Argentina/Tucuman',
          weeklyAvailability: {
            '1': [{ start: '09:00', end: '21:00' }],
            '2': [{ start: '09:00', end: '21:00' }],
            '3': [{ start: '09:00', end: '21:00' }],
            '4': [{ start: '09:00', end: '21:00' }],
            '5': [{ start: '09:00', end: '21:00' }],
            '6': [],
            '7': [],
          },
          defaultDurationMinutes: 30,
          durationOptions: [30],
          exceptions: [],
          exceptionsByDate: {},
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
        }))
      })

      await suite.test('any clinic professional can resolve a pending referral with a matching audit', async () => {
        await resetAndSeed()
        const db = dbFor(actors.pamela)
        const referral = {
          clinicId: 'centro-odontologico-colon',
          patientId: 'patient-1',
          referrerUid: actors.pamela.uid,
          referrerDentistId: actors.pamela.dentistId,
          recipientUid: actors.marcela.uid,
          recipientDentistId: actors.marcela.dentistId,
          status: 'pending',
          reason: 'Evaluación',
          notes: '',
          createdAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
          auditLogId: 'referral-create-log',
        }
        const create = writeBatch(db)
        create.set(doc(db, 'referrals/referral-1'), referral)
        create.set(
          doc(db, 'auditLogs/referral-create-log'),
          audit('referral', 'referral-1', 'referral_created', actors.pamela.uid),
        )
        await assertSucceeds(create.commit())

        const referrerDb = dbFor(actors.pamela)
        const referrerResponse = writeBatch(referrerDb)
        referrerResponse.update(doc(referrerDb, 'referrals/referral-1'), {
          status: 'accepted',
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
          auditLogId: 'referral-referrer-response-log',
        })
        referrerResponse.set(
          doc(referrerDb, 'auditLogs/referral-referrer-response-log'),
          audit('referral', 'referral-1', 'referral_accepted', actors.pamela.uid),
        )
        await assertSucceeds(referrerResponse.commit())

        const recipientDb = dbFor(actors.marcela)
        const response = writeBatch(recipientDb)
        response.update(doc(recipientDb, 'referrals/referral-1'), {
          status: 'accepted',
          updatedAt: serverTimestamp(),
          updatedBy: actors.marcela.uid,
          auditLogId: 'referral-response-log',
        })
        response.set(
          doc(recipientDb, 'auditLogs/referral-response-log'),
          audit('referral', 'referral-1', 'referral_accepted', actors.marcela.uid),
        )
        await assertFails(response.commit())
      })

      await suite.test('budget lines are created only with their new budget and matching audit', async () => {
        await resetAndSeed()
        const db = dbFor(actors.pamela)
        const budgetId = 'budget-1'
        const auditLogId = 'budget-create-log'
        const batch = writeBatch(db)
        batch.set(doc(db, `budgets/${budgetId}`), {
          clinicId: 'centro-odontologico-colon',
          patientId: 'patient-1',
          status: 'pending',
          expiresAt: null,
          createdAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
          auditLogId,
        })
        batch.set(doc(db, 'budgetItems/budget-item-1'), {
          clinicId: 'centro-odontologico-colon',
          patientId: 'patient-1',
          budgetId,
          description: 'Consulta',
          quantity: 1,
          unitPriceCents: 5000,
          totalCents: 5000,
          paidCents: 0,
          auditLogId,
          createdAt: serverTimestamp(),
          createdBy: actors.pamela.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
        })
        batch.set(
          doc(db, `auditLogs/${auditLogId}`),
          audit('budget', budgetId, 'budget_created', actors.pamela.uid),
        )
        await assertSucceeds(batch.commit())

        await assertFails(
          setDoc(doc(db, 'budgetItems/untracked-item'), {
            clinicId: 'centro-odontologico-colon',
            patientId: 'patient-1',
            budgetId,
            description: 'Cargo no auditado',
            quantity: 1,
            unitPriceCents: 100,
            totalCents: 100,
            paidCents: 0,
            auditLogId,
            createdAt: serverTimestamp(),
            createdBy: actors.pamela.uid,
            updatedAt: serverTimestamp(),
            updatedBy: actors.pamela.uid,
          }),
        )
      })

      await suite.test('patient file metadata transitions require new matching audits', async () => {
        await resetAndSeed()
        const db = dbFor(actors.pamela)
        const start = writeBatch(db)
        start.set(doc(db, 'patientFiles/file-1'), {
          clinicId: 'centro-odontologico-colon',
          patientId: 'patient-1',
          originalName: 'radiografia.pdf',
          extension: 'pdf',
          contentType: 'application/pdf',
          sizeBytes: 4,
          storagePath: 'patient-files/patient-1/pdf/file-1',
          status: 'uploading',
          uploadedAt: serverTimestamp(),
          uploadedBy: actors.pamela.uid,
          auditLogId: 'file-start-log',
        })
        start.set(
          doc(db, 'auditLogs/file-start-log'),
          audit('patientFile', 'file-1', 'patient_file_upload_started', actors.pamela.uid),
        )
        await assertSucceeds(start.commit())

        const activateWithoutAudit = writeBatch(db)
        activateWithoutAudit.update(doc(db, 'patientFiles/file-1'), {
          status: 'active',
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
          auditLogId: 'file-active-log',
        })
        await assertFails(activateWithoutAudit.commit())

        const activate = writeBatch(db)
        activate.update(doc(db, 'patientFiles/file-1'), {
          status: 'active',
          updatedAt: serverTimestamp(),
          updatedBy: actors.pamela.uid,
          auditLogId: 'file-active-log',
        })
        activate.set(
          doc(db, 'auditLogs/file-active-log'),
          audit('patientFile', 'file-1', 'patient_file_uploaded', actors.pamela.uid),
        )
        await assertSucceeds(activate.commit())
      })
    } finally {
      await environment.cleanup()
    }
  },
)
