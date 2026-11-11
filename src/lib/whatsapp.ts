import type { Patient } from './patients'
import type { AppointmentData } from './appointment-logic'
import { formatDateKey } from './schedule-logic.ts'

export type WhatsAppReminderKind = 'confirm' | 'upcoming' | 'reschedule' | 'missed' | 'payment'

export function prepareWhatsAppReminder(
  phone: string,
  patientName: string,
  kind: WhatsAppReminderKind,
  appointment?: Pick<AppointmentData, 'date' | 'startTime'>,
  balanceText?: string,
) {
  const digits = phone.replace(/\D/g, '')
  const internationalNumber =
    phone.trim().startsWith('+') || digits.startsWith('54')
      ? digits
      : digits.length === 10
        ? `549${digits}`
        : digits
  if (!/^\d{10,15}$/.test(internationalNumber)) {
    throw new Error('El teléfono no tiene un formato apto para WhatsApp. Revisá la ficha del paciente.')
  }

  const safeName = patientName.trim()
  if (!safeName) throw new Error('No se pudo identificar al paciente.')
  const appointmentDetails = appointment
    ? ` para el ${formatDateKey(appointment.date)} a las ${appointment.startTime}`
    : ''
  const messages: Record<WhatsAppReminderKind, string> = {
    confirm: `Hola ${safeName}, te escribimos del Centro Odontológico Colón para confirmar tu turno${appointmentDetails}. ¿Podés confirmarnos tu asistencia?`,
    upcoming: `Hola ${safeName}, te recordamos tu próximo turno${appointmentDetails} en el Centro Odontológico Colón.`,
    reschedule: `Hola ${safeName}, necesitamos coordinar una nueva fecha para tu visita al Centro Odontológico Colón. ¿Qué disponibilidad tenés?`,
    missed: `Hola ${safeName}, notamos que no pudiste asistir a tu turno${appointmentDetails}. Si querés, podemos ayudarte a reprogramarlo.`,
    payment: `Hola ${safeName}, te contactamos del Centro Odontológico Colón por un saldo pendiente${balanceText ? ` de ${balanceText}` : ''}. Escribinos si necesitás revisar el detalle.`,
  }
  const message = messages[kind]
  return {
    message,
    url: `https://wa.me/${internationalNumber}?text=${encodeURIComponent(message)}`,
  }
}

export function patientFullName(patient: Pick<Patient, 'firstName' | 'lastName'>) {
  return `${patient.firstName} ${patient.lastName}`.trim()
}
