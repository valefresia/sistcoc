import { useEffect, useState } from 'react'
import { AlertCircle, LoaderCircle, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import { getClinicFinanceOverview } from '../lib/finance'
import { formatARS } from '../lib/finance-logic'
import { firebaseOperationError } from '../lib/firebase-errors'

type FinanceOverview = Awaited<ReturnType<typeof getClinicFinanceOverview>>

export function FinancePage() {
  const [overview, setOverview] = useState<FinanceOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getClinicFinanceOverview()
      .then((result) => {
        if (active) setOverview(result)
      })
      .catch((caught: unknown) => {
        if (active) setError(firebaseOperationError(caught, 'Cargar resumen financiero'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const acceptedCents = overview?.balances.reduce((sum, item) => sum + item.acceptedCents, 0) ?? 0
  const paidCents = overview?.balances.reduce((sum, item) => sum + item.paidCents, 0) ?? 0
  const outstandingCents = overview?.balances.reduce((sum, item) => sum + item.dueCents, 0) ?? 0

  return (
    <WorkspaceLayout title="Finanzas">
      <section className="workspace-page">
        <div className="workspace-page-heading">
          <div><p className="eyebrow">GESTIÓN DEL CONSULTORIO</p><h1>Finanzas</h1><p>Presupuestos y pagos registrados por paciente.</p></div>
          <Wallet size={23} />
        </div>
        {loading && <div className="patient-state" aria-live="polite"><LoaderCircle className="spin" size={21} /> Cargando resumen financiero...</div>}
        {error && <div className="patient-state patient-state-error" role="alert"><AlertCircle size={20} /> {error}</div>}
        {!loading && !error && overview && (
          <>
            <div className="workspace-metric-grid">
              <Metric label="Presupuestos aceptados" value={formatARS(acceptedCents)} />
              <Metric label="Pagos registrados" value={formatARS(paidCents)} />
              <Metric label="Saldo pendiente" value={formatARS(outstandingCents)} />
            </div>
            <section className="patient-detail-card">
              <div className="patient-form-section-heading"><div><h2>Saldos por paciente</h2><p>Los saldos incluyen únicamente presupuestos aceptados.</p></div></div>
              {overview.balances.length === 0 && <p className="workspace-muted">No hay presupuestos cargados.</p>}
              {overview.balances.length > 0 && (
                <div className="workspace-table-wrap">
                  <table className="workspace-table">
                    <thead><tr><th>Paciente</th><th>Aceptado</th><th>Pagado</th><th>Saldo</th></tr></thead>
                    <tbody>
                      {overview.balances.map(({ patientId, patient, acceptedCents: accepted, paidCents: paid, dueCents }) => (
                        <tr key={patientId}>
                          <td><Link to={`/patients/${patientId}`}>{patient ? `${patient.firstName} ${patient.lastName}` : 'Paciente no disponible'}</Link></td>
                          <td>{formatARS(accepted)}</td><td>{formatARS(paid)}</td><td><strong>{formatARS(dueCents)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="patient-detail-card">
              <div className="patient-form-section-heading"><div><h2>Últimos pagos</h2><p>Los pagos se consultan desde la ficha del paciente para ver cada concepto.</p></div></div>
              {overview.recentPayments.length === 0 && <p className="workspace-muted">Todavía no hay pagos registrados.</p>}
              <ul className="workspace-payment-list">
                {overview.recentPayments.map((payment) => (
                  <li key={payment.id}>
                    <div><strong>{formatARS(payment.amountCents)}</strong><small>{payment.paidAt.toLocaleDateString('es-AR')} · {payment.method}</small></div>
                    <Link to={`/patients/${payment.patientId}`}>Ver ficha</Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </section>
    </WorkspaceLayout>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="workspace-metric-card"><span>{label}</span><strong>{value}</strong></article>
}
