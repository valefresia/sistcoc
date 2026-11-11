import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase/firestore'
import type { DentistId } from '../auth/auth-context'
import { getFirebaseFirestore } from './firebase'
import { CLINIC_ID, isClinicProfessionalProfile } from './clinic'
import {
  validateBudgetLines,
  validatePaymentAmount,
  type BudgetLineInput,
  type BudgetStatus,
  type PaymentMethod,
} from './finance-logic'
import { getPatient, type Patient } from './patients'

export interface Budget {
  id: string
  patientId: string
  status: BudgetStatus
  expiresAt: Date | null
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
}

export interface BudgetItem {
  id: string
  budgetId: string
  patientId: string
  description: string
  quantity: number
  unitPriceCents: number
  totalCents: number
  paidCents: number
}

export interface PatientPayment {
  id: string
  patientId: string
  budgetId: string
  budgetItemId: string
  amountCents: number
  method: PaymentMethod
  paidAt: Date
  createdAt: Date
  createdBy: string
}

export interface PatientFinance {
  patient: Patient | null
  budgets: Array<{ budget: Budget; items: BudgetItem[] }>
  payments: PatientPayment[]
}

export class FinanceRecordNotFoundError extends Error {
  constructor() {
    super('No encontramos el paciente, presupuesto o concepto solicitado.')
    this.name = 'FinanceRecordNotFoundError'
  }
}

export class FinancePermissionError extends Error {
  constructor() {
    super('El perfil no corresponde a un profesional habilitado del consultorio.')
    this.name = 'FinancePermissionError'
  }
}

function getDb() {
  return getFirebaseFirestore().then((db) => {
    if (!db) throw new Error('Firebase todavía no está configurado.')
    return db
  })
}

function parseDate(value: unknown): Date {
  if (!(value instanceof Timestamp)) throw new Error('El registro financiero tiene una fecha inválida.')
  return value.toDate()
}

function parseBudget(id: string, data: DocumentData): Budget {
  if (!['pending', 'accepted', 'rejected'].includes(String(data.status))) {
    throw new Error('El presupuesto tiene un estado inválido.')
  }
  return {
    id,
    patientId: String(data.patientId ?? ''),
    status: data.status as BudgetStatus,
    expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt.toDate() : null,
    createdAt: parseDate(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    updatedAt: parseDate(data.updatedAt),
    updatedBy: String(data.updatedBy ?? ''),
  }
}

function parseBudgetItem(id: string, data: DocumentData): BudgetItem {
  return {
    id,
    budgetId: String(data.budgetId ?? ''),
    patientId: String(data.patientId ?? ''),
    description: String(data.description ?? ''),
    quantity: Number(data.quantity ?? 0),
    unitPriceCents: Number(data.unitPriceCents ?? 0),
    totalCents: Number(data.totalCents ?? 0),
    paidCents: Number(data.paidCents ?? 0),
  }
}

function parsePayment(id: string, data: DocumentData): PatientPayment {
  if (!['cash', 'debit_card', 'credit_card', 'transfer', 'other'].includes(String(data.method))) {
    throw new Error('El pago tiene un método inválido.')
  }
  return {
    id,
    patientId: String(data.patientId ?? ''),
    budgetId: String(data.budgetId ?? ''),
    budgetItemId: String(data.budgetItemId ?? ''),
    amountCents: Number(data.amountCents ?? 0),
    method: data.method as PaymentMethod,
    paidAt: parseDate(data.paidAt),
    createdAt: parseDate(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
  }
}

async function validateActor(transaction: Transaction, db: Firestore, actorUid: string) {
  const actorSnapshot = await transaction.get(doc(db, 'users', actorUid))
  const actor = actorSnapshot.data()
  const allowed =
    actorSnapshot.exists() &&
    actor?.uid === actorUid &&
    isClinicProfessionalProfile(actorUid, actor.role, actor.dentistId)
  if (!allowed) throw new FinancePermissionError()
  return actor.dentistId as DentistId
}

function makeAudit(
  entity: string,
  entityId: string,
  operation: string,
  actorUid: string,
) {
  return { entity, entityId, operation, actorUid, createdAt: serverTimestamp() }
}

export async function createBudget(
  patientId: string,
  linesInput: BudgetLineInput[],
  expiresOn: string | null,
  actorUid: string,
) {
  const lines = validateBudgetLines(linesInput)
  let expiresAt: Timestamp | null = null
  if (expiresOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
      throw new Error('Ingresá una fecha de vencimiento válida.')
    }
    const parsedDate = new Date(`${expiresOn}T12:00:00.000Z`)
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== expiresOn) {
      throw new Error('Ingresá una fecha de vencimiento válida.')
    }
    expiresAt = Timestamp.fromDate(parsedDate)
  }
  const db = await getDb()
  const patientRef = doc(db, 'patients', patientId)
  const budgetRef = doc(collection(db, 'budgets'))
  const auditRef = doc(collection(db, 'auditLogs'))
  const itemRefs = lines.map(() => doc(collection(db, 'budgetItems')))

  await runTransaction(db, async (transaction) => {
    const patientSnapshot = await transaction.get(patientRef)
    if (!patientSnapshot.exists()) throw new FinanceRecordNotFoundError()
    await validateActor(transaction, db, actorUid)
    transaction.set(budgetRef, {
      clinicId: CLINIC_ID,
      patientId,
      status: 'pending',
      expiresAt,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: auditRef.id,
    })
    for (const [index, item] of lines.entries()) {
      transaction.set(itemRefs[index], {
        clinicId: CLINIC_ID,
        patientId,
        budgetId: budgetRef.id,
        ...item,
        paidCents: 0,
        auditLogId: auditRef.id,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      })
    }
    transaction.set(auditRef, makeAudit('budget', budgetRef.id, 'budget_created', actorUid))
  })
  return budgetRef.id
}

export async function updateBudgetStatus(
  budgetId: string,
  status: Exclude<BudgetStatus, 'pending'>,
  actorUid: string,
) {
  const db = await getDb()
  const budgetRef = doc(db, 'budgets', budgetId)
  const auditRef = doc(collection(db, 'auditLogs'))
  await runTransaction(db, async (transaction) => {
    const budgetSnapshot = await transaction.get(budgetRef)
    if (!budgetSnapshot.exists()) throw new FinanceRecordNotFoundError()
    await validateActor(transaction, db, actorUid)
    if (budgetSnapshot.data().status !== 'pending') {
      throw new Error('Solo se puede aceptar o rechazar un presupuesto pendiente.')
    }
    transaction.update(budgetRef, {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      auditLogId: auditRef.id,
    })
    transaction.set(
      auditRef,
      makeAudit('budget', budgetId, `budget_${status}`, actorUid),
    )
  })
}

export async function recordPayment(
  patientId: string,
  budgetId: string,
  budgetItemId: string,
  amountCents: number,
  method: PaymentMethod,
  actorUid: string,
) {
  if (!['cash', 'debit_card', 'credit_card', 'transfer', 'other'].includes(method)) {
    throw new Error('Seleccioná un método de pago válido.')
  }
  const db = await getDb()
  const budgetRef = doc(db, 'budgets', budgetId)
  const itemRef = doc(db, 'budgetItems', budgetItemId)
  const paymentRef = doc(collection(db, 'payments'))
  const auditRef = doc(collection(db, 'auditLogs'))
  await runTransaction(db, async (transaction) => {
    const [budgetSnapshot, itemSnapshot] = await Promise.all([
      transaction.get(budgetRef),
      transaction.get(itemRef),
    ])
    if (!budgetSnapshot.exists() || !itemSnapshot.exists()) throw new FinanceRecordNotFoundError()
    await validateActor(transaction, db, actorUid)
    const budget = budgetSnapshot.data()
    const item = itemSnapshot.data()
    if (
      budget.patientId !== patientId ||
      item.patientId !== patientId ||
      item.budgetId !== budgetId ||
      budget.status !== 'accepted'
    ) {
      throw new Error('El concepto no pertenece a un presupuesto aceptado de este paciente.')
    }
    const totalCents = Number(item.totalCents)
    const paidCents = Number(item.paidCents)
    if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(paidCents)) {
      throw new Error('El saldo guardado del concepto no es válido.')
    }
    validatePaymentAmount(amountCents, totalCents - paidCents)
    const paidAt = serverTimestamp()
    transaction.update(itemRef, {
      paidCents: paidCents + amountCents,
      lastPaymentId: paymentRef.id,
      auditLogId: auditRef.id,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    })
    transaction.set(paymentRef, {
      clinicId: CLINIC_ID,
      patientId,
      budgetId,
      budgetItemId,
      amountCents,
      method,
      paidAt,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      auditLogId: auditRef.id,
    })
    transaction.set(
      auditRef,
      makeAudit('payment', paymentRef.id, 'payment_created', actorUid),
    )
  })
  return paymentRef.id
}

export async function getPatientFinance(patientId: string): Promise<PatientFinance> {
  const db = await getDb()
  const patient = await getPatient(patientId)
  const budgetsSnapshot = await getDocs(
    query(
      collection(db, 'budgets'),
      where('clinicId', '==', CLINIC_ID),
      where('patientId', '==', patientId),
      orderBy('createdAt', 'desc'),
    ),
  )
  const budgets = await Promise.all(
    budgetsSnapshot.docs.map(async (budgetDocument) => {
      const itemsSnapshot = await getDocs(
        query(
          collection(db, 'budgetItems'),
          where('clinicId', '==', CLINIC_ID),
          where('budgetId', '==', budgetDocument.id),
        ),
      )
      return {
        budget: parseBudget(budgetDocument.id, budgetDocument.data()),
        items: itemsSnapshot.docs.map((item) => parseBudgetItem(item.id, item.data())),
      }
    }),
  )
  const paymentSnapshot = await getDocs(
    query(
      collection(db, 'payments'),
      where('clinicId', '==', CLINIC_ID),
      where('patientId', '==', patientId),
      orderBy('paidAt', 'desc'),
      limit(100),
    ),
  )
  return {
    patient,
    budgets,
    payments: paymentSnapshot.docs.map((payment) => parsePayment(payment.id, payment.data())),
  }
}

export async function getClinicFinanceOverview() {
  const db = await getDb()
  const budgetsSnapshot = await getDocs(
    query(
      collection(db, 'budgets'),
      where('clinicId', '==', CLINIC_ID),
      orderBy('createdAt', 'desc'),
      limit(200),
    ),
  )
  const budgets = await Promise.all(
    budgetsSnapshot.docs.map(async (document) => {
      const itemsSnapshot = await getDocs(
        query(
          collection(db, 'budgetItems'),
          where('clinicId', '==', CLINIC_ID),
          where('budgetId', '==', document.id),
        ),
      )
      return {
        budget: parseBudget(document.id, document.data()),
        items: itemsSnapshot.docs.map((item) => parseBudgetItem(item.id, item.data())),
      }
    }),
  )
  const patientIds = [...new Set(budgets.map(({ budget }) => budget.patientId))]
  const patients = await Promise.all(patientIds.map((patientId) => getPatient(patientId)))
  const patientById = new Map(
    patients.filter((patient): patient is Patient => patient !== null).map((patient) => [patient.id, patient]),
  )
  const paymentsSnapshot = await getDocs(
    query(
      collection(db, 'payments'),
      where('clinicId', '==', CLINIC_ID),
      orderBy('paidAt', 'desc'),
      limit(100),
    ),
  )
  const balances = new Map<string, { patient: Patient | null; acceptedCents: number; paidCents: number; dueCents: number }>()
  for (const { budget, items } of budgets) {
    const balance = balances.get(budget.patientId) ?? {
      patient: patientById.get(budget.patientId) ?? null,
      acceptedCents: 0,
      paidCents: 0,
      dueCents: 0,
    }
    if (budget.status === 'accepted') {
      for (const item of items) {
        balance.acceptedCents += item.totalCents
        balance.paidCents += item.paidCents
        balance.dueCents += Math.max(0, item.totalCents - item.paidCents)
      }
    }
    balances.set(budget.patientId, balance)
  }
  return {
    balances: [...balances.entries()].map(([patientId, balance]) => ({ patientId, ...balance })),
    recentPayments: paymentsSnapshot.docs.map((payment) => parsePayment(payment.id, payment.data())),
    budgets,
  }
}
