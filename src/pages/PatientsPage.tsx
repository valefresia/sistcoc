import { useLocation, useParams } from 'react-router-dom'
import { PatientDetailPage } from './PatientDetailPage'
import { PatientFormPage } from './PatientFormPage'
import { PatientListPage } from './PatientListPage'

export function PatientsPage() {
  const { patientId } = useParams()
  const { pathname } = useLocation()
  const isNew = pathname.endsWith('/new')
  const isEditing = pathname.endsWith('/edit')

  if (isNew) return <PatientFormPage mode="create" />
  if (patientId && isEditing) return <PatientFormPage key={patientId} mode="edit" patientId={patientId} />
  if (patientId) return <PatientDetailPage key={patientId} patientId={patientId} />
  return <PatientListPage />
}
