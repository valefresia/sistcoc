import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FinanceValidationError,
  formatARS,
  parseMoneyToCents,
  summarizeFinancialLines,
  validateBudgetLines,
  validatePaymentAmount,
} from '../src/lib/finance-logic.ts'

test('parses pesos into integer cents without floating point arithmetic', () => {
  assert.equal(parseMoneyToCents('1234,56'), 123456)
  assert.equal(parseMoneyToCents('15.4'), 1540)
  assert.throws(() => parseMoneyToCents('-1'), FinanceValidationError)
  assert.throws(() => parseMoneyToCents('1.999'), FinanceValidationError)
  assert.equal(formatARS(1540).includes('15,40'), true)
})

test('validates budget concepts and exact integer line totals', () => {
  assert.deepEqual(
    validateBudgetLines([{ description: ' Restauración ', quantity: 3, unitPriceCents: 12550 }]),
    [{
      description: 'Restauración',
      quantity: 3,
      unitPriceCents: 12550,
      totalCents: 37650,
    }],
  )
  assert.throws(
    () => validateBudgetLines([{ description: 'Plan', quantity: 1.5, unitPriceCents: 100 }]),
    FinanceValidationError,
  )
  assert.throws(
    () => validateBudgetLines([{ description: '', quantity: 1, unitPriceCents: 100 }]),
    FinanceValidationError,
  )
})

test('rejects zero, unsafe, and above-balance payments', () => {
  assert.equal(validatePaymentAmount(200, 500), 200)
  assert.throws(() => validatePaymentAmount(0, 500), FinanceValidationError)
  assert.throws(() => validatePaymentAmount(501, 500), FinanceValidationError)
})

test('calculates only accepted budgets and identifies expired pending budgets', () => {
  const summary = summarizeFinancialLines([
    {
      totalCents: 10000,
      paidCents: 3000,
      budgetStatus: 'accepted',
      expiresAt: null,
    },
    {
      totalCents: 9000,
      paidCents: 0,
      budgetStatus: 'pending',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      totalCents: 5000,
      paidCents: 0,
      budgetStatus: 'rejected',
      expiresAt: null,
    },
  ], new Date('2026-02-01T00:00:00Z'))
  assert.deepEqual(summary, {
    acceptedCents: 10000,
    paidCents: 3000,
    outstandingCents: 7000,
    expiredBudgets: 1,
  })
})
