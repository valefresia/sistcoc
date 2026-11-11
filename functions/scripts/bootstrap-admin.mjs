import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const projectId =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.GCLOUD_PROJECT ??
  process.env.GOOGLE_CLOUD_PROJECT
const email = process.argv[2]?.trim().toLowerCase()

if (!projectId || !email) {
  console.error(
    'Usage: FIREBASE_PROJECT_ID=<project-id> node scripts/bootstrap-admin.mjs <verified-admin-email>',
  )
  process.exitCode = 1
} else {
  initializeApp({ credential: applicationDefault(), projectId })

  try {
    const auth = getAuth()
    const user = await auth.getUserByEmail(email)
    if (!user.emailVerified) {
      throw new Error('The administrator account email must be verified before bootstrap.')
    }

    await auth.setCustomUserClaims(user.uid, {
      ...(user.customClaims ?? {}),
      role: 'admin',
      dentistId: 'blas-fresia',
    })

    await getFirestore().collection('users').doc(user.uid).set(
      {
        uid: user.uid,
        email: user.email ?? email,
        displayName: user.displayName ?? '',
        role: 'admin',
        dentistId: 'blas-fresia',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'bootstrap',
      },
      { merge: true },
    )

    console.log(`Administrator role assigned to ${email}.`)
  } catch (error) {
    console.error('Could not bootstrap administrator.', error)
    process.exitCode = 1
  }
}
