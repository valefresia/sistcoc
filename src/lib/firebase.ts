import { getApp, getApps, initializeApp } from 'firebase/app'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
}

const requiredConfigKeys = {
  VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: firebaseConfig.storageBucket,
  VITE_FIREBASE_MESSAGING_SENDER_ID: firebaseConfig.messagingSenderId,
  VITE_FIREBASE_APP_ID: firebaseConfig.appId,
}

const missingConfigKeys = Object.entries(requiredConfigKeys)
  .filter(([, value]) => value.trim().length === 0)
  .map(([key]) => key)

export const firebaseConfigured = missingConfigKeys.length === 0

if (!firebaseConfigured) {
  console.error(
    `[Firebase] Missing required environment variables: ${missingConfigKeys.join(', ')}. ` +
      'Set them in the root .env.local file and restart the Vite server.',
  )
}

const app = firebaseConfigured
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null

export async function getFirebaseAuth() {
  if (!app) return null
  const { getAuth } = await import('firebase/auth')
  return getAuth(app)
}

export async function getFirebaseFirestore() {
  if (!app) return null
  const { getFirestore } = await import('firebase/firestore')
  return getFirestore(app)
}

export async function getFirebaseStorage() {
  if (!app) return null
  const { getStorage } = await import('firebase/storage')
  return getStorage(app)
}
