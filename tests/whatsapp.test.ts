import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareWhatsAppReminder } from '../src/lib/whatsapp.ts'

test('prepares an encoded WhatsApp reminder without claiming it was sent', () => {
  const reminder = prepareWhatsAppReminder(
    '+54 9 381 555 1234',
    'Paciente de prueba',
    'confirm',
    { date: '2026-11-06', startTime: '10:30' },
  )
  assert.match(reminder.url, /^https:\/\/wa\.me\/5493815551234\?text=/)
  assert.match(decodeURIComponent(reminder.url), /Paciente de prueba/)
  assert.match(decodeURIComponent(reminder.url), /10:30/)
  assert.equal('sent' in reminder, false)
})

test('rejects malformed phone numbers instead of opening a broken conversation', () => {
  assert.throws(
    () => prepareWhatsAppReminder('123', 'Paciente', 'payment'),
    /formato apto para WhatsApp/,
  )
})
