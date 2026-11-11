import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { inspectRoleAssignment } from './role-plan.mjs'

const projectId = process.env.FIREBASE_PROJECT_ID
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const valueArgs = args.filter((argument) => argument !== '--dry-run')
const emailFlags = new Map([
  ['--blas-email', null],
  ['--pamela-email', null],
  ['--marcela-email', null],
])
let invalidArguments = false

for (let index = 0; index < valueArgs.length; index += 2) {
  const flag = valueArgs[index]
  const value = valueArgs[index + 1]
  if (
    !emailFlags.has(flag) ||
    !value ||
    value.startsWith('--') ||
    emailFlags.get(flag) !== null
  ) {
    invalidArguments = true
    break
  }
  emailFlags.set(flag, value.trim().toLowerCase())
}

if (
  invalidArguments ||
  !projectId ||
  [...emailFlags.values()].some((email) => !email)
) {
  console.error(
    'Usage: node scripts/set-roles.mjs [--dry-run] --blas-email <email> --pamela-email <email> --marcela-email <email>; FIREBASE_PROJECT_ID is required.',
  )
  process.exitCode = 1
} else if (new Set(emailFlags.values()).size !== emailFlags.size) {
  console.error('Each professional must use a distinct Firebase Authentication email.')
  process.exitCode = 1
}

const definitions = [
  {
    flag: '--blas-email',
    displayName: 'Blas Fresia',
    role: 'admin',
    dentistId: 'blas-fresia',
  },
  {
    flag: '--pamela-email',
    displayName: 'Pamela Moreira',
    role: 'admin',
    dentistId: 'pamela-moreira',
    migrateFrom: 'dentist',
  },
  {
    flag: '--marcela-email',
    displayName: 'Marcela Castro',
    role: 'admin',
    dentistId: 'marcela-castro',
    migrateFrom: 'dentist',
  },
]

if (process.exitCode !== 1) {
  initializeApp({ credential: applicationDefault(), projectId })

  try {
    const auth = getAuth()
    const db = getFirestore()
    const results = []

    for (const definition of definitions) {
      const email = emailFlags.get(definition.flag)
      try {
        const user = await auth.getUserByEmail(email)
        const profileSnapshot = await db.collection('users').doc(user.uid).get()
        const plan = inspectRoleAssignment(
          definition,
          user,
          profileSnapshot.exists ? profileSnapshot.data() : null,
        )
        results.push({
          professional: definition.displayName,
          email: user.email ?? email,
          uid: user.uid,
          currentClaims: plan.currentClaims,
          currentProfile: plan.currentProfile,
          expected: {
            role: definition.role,
            dentistId: definition.dentistId,
          },
          action: plan.action,
          conflicts: plan.conflicts,
          definition,
          user,
        })
      } catch (error) {
        const code =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : 'unknown'
        results.push({
          professional: definition.displayName,
          email,
          uid: null,
          currentClaims: null,
          currentProfile: null,
          expected: {
            role: definition.role,
            dentistId: definition.dentistId,
          },
          action: 'no se pudo inspeccionar',
          conflicts: [`Error al consultar Firebase: ${code}`],
          error,
          definition,
        })
      }
    }

    console.log(
      JSON.stringify(
        {
          projectId,
          mode: dryRun ? 'dry-run (solo lectura)' : 'aplicación',
          accounts: results.map(
            ({
              professional,
              email,
              uid,
              currentClaims,
              currentProfile,
              expected,
              action,
              conflicts,
            }) => ({
              professional,
              email,
              uid,
              currentClaims,
              currentProfile,
              expected,
              action,
              conflicts,
            }),
          ),
        },
        null,
        2,
      ),
    )

    const hasConflicts = results.some((result) => result.conflicts.length > 0)
    if (hasConflicts) {
      console.error('Hay cuentas sin inspeccionar o con conflictos; no se aplicaron cambios.')
      process.exitCode = 1
    } else if (dryRun) {
      console.log('Modo --dry-run: no se modificaron claims ni documentos de Firestore.')
    } else {
      const changedAccounts = results.filter((result) => result.action !== 'sin cambios')
      const updatedClaims = []

      try {
        for (const account of changedAccounts) {
          await auth.setCustomUserClaims(account.uid, {
            ...(account.user.customClaims ?? {}),
            role: account.definition.role,
            dentistId: account.definition.dentistId,
          })
          updatedClaims.push(account)
        }

        const batch = db.batch()
        for (const account of changedAccounts) {
          batch.set(
            db.collection('users').doc(account.uid),
            {
              uid: account.uid,
              email: account.user.email,
              displayName:
                account.user.displayName || account.definition.displayName,
              role: account.definition.role,
              dentistId: account.definition.dentistId,
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: 'initial-role-setup',
            },
            { merge: true },
          )
        }
        if (changedAccounts.length > 0) await batch.commit()
        console.log('Se sincronizaron los perfiles y custom claims sin conflictos.')
        console.log('Cada profesional debe cerrar sesión y volver a ingresar para refrescar el token.')
      } catch (error) {
        for (const account of updatedClaims.reverse()) {
          try {
            await auth.setCustomUserClaims(
              account.uid,
              account.user.customClaims ?? {},
            )
          } catch (rollbackError) {
            console.error(
              `No se pudieron revertir los claims de ${account.professional}.`,
              rollbackError,
            )
          }
        }
        throw error
      }
    }
  } catch (error) {
    console.error('No se pudo completar la inspección o asignación de roles.', error)
    process.exitCode = 1
  }
}
