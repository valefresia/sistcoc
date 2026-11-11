export type BudgetStatus = 'pending' | 'accepted' | 'rejected'
export type PaymentMethod = 'cash' | 'debit_card' | 'credit_card' | 'transfer' | 'other'

export interface BudgetLineInput {
  description: string
  quantity: number
  unitPriceCents: number
}

export interface BudgetLine extends BudgetLineInput {
  totalCents: number
}

export interface FinancialLine {
  totalCents: number
  paidCents: number
  budgetStatus: BudgetStatus
  expiresAt: Date | null
}

export class FinanceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinanceValidationError'
  }
}

const MAX_LINE_COUNT = 25
const MAX_LINE_CENTS = 9_000_000_000_000

export function parseMoneyToCents(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized)) {
    throw new FinanceValidationError('Ingresá un importe válido con hasta dos decimales.')
  }
  const [whole, fraction = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > MAX_LINE_CENTS) {
    throw new FinanceValidationError('El importe supera el máximo permitido.')
  }
  return cents
}

export function validateBudgetLines(lines: BudgetLineInput[]): BudgetLine[] {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINE_COUNT) {
    throw new FinanceValidationError(`El presupuesto debe tener entre 1 y ${MAX_LINE_COUNT} conceptos.`)
  }
  return lines.map((line) => {
    const description = line.description.trim()
    if (!description || description.length > 200) {
      throw new FinanceValidationError('Cada concepto debe tener una descripción de hasta 200 caracteres.')
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000) {
      throw new FinanceValidationError('La cantidad debe ser un número entero entre 1 y 1000.')
    }
    if (
      !Number.isSafeInteger(line.unitPriceCents) ||
      line.unitPriceCents <= 0 ||
      line.unitPriceCents > MAX_LINE_CENTS
    ) {
      throw new FinanceValidationError('El precio unitario debe ser un importe positivo válido.')
    }
    const totalCents = line.quantity * line.unitPriceCents
    if (!Number.isSafeInteger(totalCents) || totalCents > MAX_LINE_CENTS) {
      throw new FinanceValidationError('El total del concepto supera el máximo permitido.')
    }
    return { description, quantity: line.quantity, unitPriceCents: line.unitPriceCents, totalCents }
  })
}

export function validatePaymentAmount(
  amountCents: number,
  outstandingCents: number,
) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new FinanceValidationError('El pago debe ser un importe positivo.')
  }
  if (amountCents > outstandingCents) {
    throw new FinanceValidationError('El pago supera el saldo pendiente del concepto.')
  }
  return amountCents
}

export function summarizeFinancialLines(lines: FinancialLine[], today = new Date()) {
  return lines.reduce(
    (summary, line) => {
      const balance = Math.max(0, line.totalCents - line.paidCents)
      if (line.budgetStatus === 'accepted') {
        summary.acceptedCents += line.totalCents
        summary.paidCents += line.paidCents
        summary.outstandingCents += balance
      }
      if (
        line.budgetStatus === 'pending' &&
        line.expiresAt !== null &&
        line.expiresAt.getTime() < today.getTime()
      ) {
        summary.expiredBudgets += 1
      }
      return summary
    },
    { acceptedCents: 0, paidCents: 0, outstandingCents: 0, expiredBudgets: 0 },
  )
}

export function formatARS(cents: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

