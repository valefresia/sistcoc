import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, LoaderCircle, Share2, X } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import {
  PatientNameLink,
  WorkspaceReferralStatus,
} from '../components/PatientWorkspaceSections'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import { professionalName } from '../lib/clinic'
import { firebaseOperationError } from '../lib/firebase-errors'
import { getPatient, type Patient } from '../lib/patients'
import { listReferrals, resolveReferral, type Referral } from '../lib/referrals'

interface ReferralListItem {
  referral: Referral
  patient: Patient | null
}

export function ReferralsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<ReferralListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadReferrals = useCallback(async () => {
    const referrals = await listReferrals()
    return Promise.all(
      referrals.map(async (referral) => ({
        referral,
        patient: await getPatient(referral.patientId),
      })),
    )
  }, [])

  useEffect(() => {
    let active = true
    void loadReferrals()
      .then((loaded) => {
        if (active) setItems(loaded)
      })
      .catch((caught: unknown) => {
        if (active) setError(firebaseOperationError(caught, 'Cargar derivaciones'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadReferrals])

  async function respond(referral: Referral, status: 'accepted' | 'rejected') {
    if (!user) return
    setBusyId(referral.id)
    setError(null)
    try {
      await resolveReferral(referral.id, status, user.uid)
      setItems(await loadReferrals())
    } catch (caught) {
      setError(firebaseOperationError(caught, 'Gestionar derivación'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <WorkspaceLayout title="Derivaciones">
      <section className="workspace-page">
        <div className="workspace-page-heading">
          <div><p className="eyebrow">COORDINACIÓN CLÍNICA</p><h1>Derivaciones</h1><p>Solicitudes internas vinculadas con la ficha del paciente.</p></div>
          <Share2 size={23} />
        </div>
        {loading && <div className="patient-state" aria-live="polite"><LoaderCircle className="spin" size={21} /> Cargando derivaciones...</div>}
        {error && <div className="patient-state patient-state-error" role="alert"><AlertCircle size={20} /> {error}</div>}
        {!loading && !error && items.length === 0 && <div className="patient-detail-card"><p className="workspace-muted">Todavía no hay derivaciones registradas. Podés crear una desde la ficha del paciente.</p></div>}
        {!loading && items.map(({ referral, patient }) => (
          <article className="workspace-referral-card" key={referral.id}>
            <header>
              <div>
                <p className="eyebrow">{referral.createdAt.toLocaleDateString('es-AR')}</p>
                <h2>{professionalName(referral.referrerDentistId)} <span aria-hidden="true">→</span> {professionalName(referral.recipientDentistId)}</h2>
              </div>
              <WorkspaceReferralStatus status={referral.status} />
            </header>
            <div className="workspace-referral-patient">
              <span>Paciente</span>
              <PatientNameLink
                name={patient ? `${patient.firstName} ${patient.lastName}` : 'Paciente no disponible'}
                patientId={referral.patientId}
              />
            </div>
            <div className="workspace-referral-reason"><strong>Motivo</strong><p>{referral.reason}</p></div>
            {referral.notes && <div className="workspace-referral-reason"><strong>Observaciones internas</strong><p>{referral.notes}</p></div>}
            {referral.status === 'pending' && (
              <div className="workspace-inline-actions">
                <button className="button button-primary" disabled={busyId === referral.id} onClick={() => void respond(referral, 'accepted')} type="button">
                  {busyId === referral.id ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Aceptar
                </button>
                <button className="button button-secondary" disabled={busyId === referral.id} onClick={() => void respond(referral, 'rejected')} type="button">
                  <X size={15} /> Rechazar
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
    </WorkspaceLayout>
  )
}
