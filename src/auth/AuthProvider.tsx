import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { User } from 'firebase/auth'
import {
  firebaseConfigured,
  getFirebaseAuth,
  getFirebaseFirestore,
} from '../lib/firebase'
import { firebaseErrorCode, firebaseOperationError } from '../lib/firebase-errors'
import { AuthContext, type DentistId, type UserRole } from './auth-context'
import { resolveProfessionalClaims, resolveProfessionalProfile } from './auth-claims'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<UserRole | null>(null)
  const [dentistId, setDentistId] = useState<DentistId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)
  const active = useRef(true)
  const latestEvent = useRef(0)
  const unsubscribeAuth = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    active.current = true

    void (async () => {
      const [auth, db] = await Promise.all([getFirebaseAuth(), getFirebaseFirestore()])
      if (!active.current) return
      if (!auth || !db) {
        setError('No se pudo inicializar Firebase Authentication y Firestore.')
        setLoading(false)
        return
      }

      const [{ getIdTokenResult, onAuthStateChanged }, { doc, getDocFromServer }] =
        await Promise.all([import('firebase/auth'), import('firebase/firestore')])
      unsubscribeAuth.current = onAuthStateChanged(auth, async (currentUser) => {
        const event = ++latestEvent.current
        setError(null)

        if (!currentUser) {
          setUser(null)
          setRole(null)
          setDentistId(null)
          setLoading(false)
          return
        }

        setLoading(true)
        try {
          const token = await getIdTokenResult(currentUser, true)
          if (!active.current || event !== latestEvent.current) return

          const profileSnapshot = await getDocFromServer(
            doc(db, 'users', currentUser.uid),
          )
          if (!active.current || event !== latestEvent.current) return
          const claims = resolveProfessionalClaims(token.claims)
          const profile = resolveProfessionalProfile(
            claims,
            profileSnapshot.exists() ? profileSnapshot.data() : undefined,
            currentUser.uid,
          )
          setUser(currentUser)
          setRole(profile.role)
          setDentistId(profile.dentistId)
          setError(profile.error)
        } catch (caught) {
          if (!active.current || event !== latestEvent.current) return
          setUser(currentUser)
          setRole(null)
          setDentistId(null)
          const message = firebaseOperationError(caught, 'Cargar perfil profesional')
          setError(
            firebaseErrorCode(caught) === 'permission-denied'
              ? `${message} Puede deberse a que users/{uid} y los custom claims no coinciden, o a que las reglas publicadas difieren de las locales.`
              : message,
          )
        } finally {
          if (active.current && event === latestEvent.current) setLoading(false)
        }
      })
    })().catch((error: unknown) => {
      if (!active.current) return
      setError(firebaseOperationError(error, 'Inicializar Firebase'))
      setLoading(false)
    })

    return () => {
      active.current = false
      unsubscribeAuth.current?.()
      unsubscribeAuth.current = undefined
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const auth = await getFirebaseAuth()
    if (!auth) throw new Error('Firebase todavía no está configurado.')
    const { signInWithEmailAndPassword } = await import('firebase/auth')
    await signInWithEmailAndPassword(auth, email.trim(), password)
  }, [])

  const signOut = useCallback(async () => {
    const auth = await getFirebaseAuth()
    if (!auth) return
    const { signOut: firebaseSignOut } = await import('firebase/auth')
    await firebaseSignOut(auth)
  }, [])

  const value = useMemo(
    () => ({
      configured: firebaseConfigured,
      dentistId,
      error,
      loading,
      role,
      signIn,
      signOut,
      user,
    }),
    [dentistId, error, loading, role, signIn, signOut, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
