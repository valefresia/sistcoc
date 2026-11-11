export interface PatientFields {
  firstName: string
  lastName: string
  dni: string
  birthDate: string
  phone: string
  email: string
  address: string
  observations: string
}

export type PatientFieldErrors = Partial<Record<keyof PatientFields, string>>

export function normalizeDni(value: string) {
  return value.trim().replace(/[.\s-]/g, '')
}

export function preparePatientFields(input: PatientFields) {
  const value: PatientFields = {
    firstName: input.firstName.trim().replace(/\s+/g, ' '),
    lastName: input.lastName.trim().replace(/\s+/g, ' '),
    dni: normalizeDni(input.dni),
    birthDate: input.birthDate,
    phone: input.phone.trim(),
    email: input.email.trim().toLocaleLowerCase('es-AR'),
    address: input.address.trim(),
    observations: input.observations.trim(),
  }
  const errors: PatientFieldErrors = {}
  const now = new Date()
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')

  if (!value.firstName) errors.firstName = 'Ingresá el nombre.'
  else if (value.firstName.length > 80) errors.firstName = 'El nombre no puede superar 80 caracteres.'

  if (!value.lastName) errors.lastName = 'Ingresá el apellido.'
  else if (value.lastName.length > 80) errors.lastName = 'El apellido no puede superar 80 caracteres.'

  if (!value.dni) errors.dni = 'Ingresá el DNI.'
  else if (!/^\d{7,8}$/.test(value.dni)) {
    errors.dni = 'Ingresá un DNI válido de 7 u 8 números.'
  }

  const parsedBirthDate = new Date(`${value.birthDate}T00:00:00.000Z`)
  if (
    !value.birthDate ||
    Number.isNaN(parsedBirthDate.getTime()) ||
    parsedBirthDate.toISOString().slice(0, 10) !== value.birthDate ||
    value.birthDate > today
  ) {
    errors.birthDate = 'Ingresá una fecha de nacimiento válida.'
  }

  if (!value.phone) errors.phone = 'Ingresá un teléfono.'
  else if (!/^[0-9()+ .-]{6,25}$/.test(value.phone)) {
    errors.phone = 'Revisá el teléfono. Usá entre 6 y 25 caracteres numéricos.'
  }

  if (
    value.email &&
    (value.email.length > 254 ||
      !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value.email))
  ) {
    errors.email = 'Ingresá un correo electrónico válido.'
  }

  if (value.address.length > 250) errors.address = 'La dirección no puede superar 250 caracteres.'
  if (value.observations.length > 2000) {
    errors.observations = 'Las observaciones no pueden superar 2000 caracteres.'
  }

  return {
    value: Object.keys(errors).length === 0 ? value : null,
    errors,
  }
}
