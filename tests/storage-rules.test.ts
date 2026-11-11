import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
} from 'firebase/storage'

const firestoreAddress = process.env.FIRESTORE_EMULATOR_HOST
const storageAddress = process.env.FIREBASE_STORAGE_EMULATOR_HOST
const emulatorProjectId = 'demo-sistcoc-rules-test'
const testUid = (environmentVariable: string, fallback: string) =>
  process.env[environmentVariable]?.trim() || fallback

test(
  'Firebase Storage security rules',
  {
    skip:
      firestoreAddress && storageAddress
        ? false
        : 'FIRESTORE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST are required.',
  },
  async () => {
    assert.match(
      firestoreAddress!,
      /^127\.0\.0\.1:\d+$/,
      'Rules tests must connect to a local Firestore Emulator at 127.0.0.1.',
    )
    assert.match(
      storageAddress!,
      /^127\.0\.0\.1:\d+$/,
      'Rules tests must connect to a local Storage Emulator at 127.0.0.1.',
    )
    const [firestoreHost, firestorePort] = firestoreAddress!.split(':')
    const [storageHost, storagePort] = storageAddress!.split(':')
    const environment = await initializeTestEnvironment({
      projectId: emulatorProjectId,
      firestore: {
        host: firestoreHost,
        port: Number(firestorePort),
        rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
      },
      storage: {
        host: storageHost,
        port: Number(storagePort),
        rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8'),
      },
    })

    const professionals = [
      {
        uid: testUid('RULES_TEST_UID_BLAS', 'blas-uid'),
        role: 'admin',
        dentistId: 'blas-fresia',
      },
      {
        uid: testUid('RULES_TEST_UID_PAMELA', 'pamela-uid'),
        role: 'admin',
        dentistId: 'pamela-moreira',
      },
      {
        uid: testUid('RULES_TEST_UID_MARCELA', 'marcela-uid'),
        role: 'admin',
        dentistId: 'marcela-castro',
      },
    ] as const
    const filePath = 'patient-files/patient-1/pdf/file-1'
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])

    try {
      await environment.clearFirestore()
      await environment.clearStorage()
      await environment.withSecurityRulesDisabled(async (context) => {
        const firestore = context.firestore()
        const batch = writeBatch(firestore)
        for (const profile of professionals) {
          batch.set(doc(firestore, `users/${profile.uid}`), profile)
        }
        batch.set(doc(firestore, 'users/unrelated-uid'), {
          uid: 'unrelated-uid',
          role: 'dentist',
          dentistId: 'unrelated-dentist',
        })
        batch.set(doc(firestore, 'patients/patient-1'), { firstName: 'Paciente de prueba' })
        batch.set(doc(firestore, 'patientFiles/file-1'), {
          clinicId: 'centro-odontologico-colon',
          patientId: 'patient-1',
          extension: 'pdf',
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
          storagePath: filePath,
          status: 'uploading',
        })
        await batch.commit()
      })

      const pamelaProfile = professionals[1]
      const marcelaProfile = professionals[2]
      const pamelaStorage = environment.authenticatedContext(pamelaProfile.uid, {
        role: pamelaProfile.role,
        dentistId: 'pamela-moreira',
      }).storage()
      await assertSucceeds(
        uploadBytes(ref(pamelaStorage, filePath), bytes, {
          contentType: 'application/pdf',
          customMetadata: {
            clinicId: 'centro-odontologico-colon',
            patientId: 'patient-1',
            fileId: 'file-1',
          },
        }),
      )

      await environment.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'patientFiles/file-1'), {
          clinicId: 'centro-odontologico-colon',
          patientId: 'patient-1',
          extension: 'pdf',
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
          storagePath: filePath,
          status: 'active',
          updatedAt: serverTimestamp(),
          updatedBy: pamelaProfile.uid,
        })
      })

      const marcelaStorage = environment.authenticatedContext(marcelaProfile.uid, {
        role: marcelaProfile.role,
        dentistId: 'marcela-castro',
      }).storage()
      assert.deepEqual(
        new Uint8Array(await assertSucceeds(getBytes(ref(marcelaStorage, filePath)))),
        bytes,
      )
      await assertFails(
        uploadBytes(ref(pamelaStorage, 'patient-files/patient-1/pdf/untracked'), bytes, {
          contentType: 'application/pdf',
          customMetadata: {
            clinicId: 'centro-odontologico-colon',
            patientId: 'patient-1',
            fileId: 'untracked',
          },
        }),
      )
      const unrelatedStorage = environment.authenticatedContext('unrelated-uid', {
        role: 'dentist',
        dentistId: 'unrelated-dentist',
      }).storage()
      await assertFails(getBytes(ref(unrelatedStorage, filePath)))

      await assertFails(deleteObject(ref(pamelaStorage, filePath)))
      await environment.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'patientFiles/file-1'), {
          clinicId: 'centro-odontologico-colon',
          patientId: 'patient-1',
          extension: 'pdf',
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
          storagePath: filePath,
          status: 'deleting',
        })
      })
      await assertSucceeds(deleteObject(ref(pamelaStorage, filePath)))
    } finally {
      await environment.cleanup()
    }
  },
)
