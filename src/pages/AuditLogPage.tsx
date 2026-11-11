import { useEffect, useState } from 'react'
import { AlertCircle, ClipboardList, LoaderCircle } from 'lucide-react'
import {
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  Timestamp,
} from 'firebase/firestore'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import { getFirebaseFirestore } from '../lib/firebase'
import { firebaseOperationError } from '../lib/firebase-errors'

interface AuditEntry {
  id: string
  entity: string
  entityId: string
  operation: string
  actorUid: string
  createdAt: Date
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const db = await getFirebaseFirestore()
      if (!db) throw new Error('Firebase todavía no está configurado.')
      const snapshot = await getDocsFromServer(
        query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(100)),
      )
      const result = snapshot.docs.map((document) => {
        const data = document.data()
        if (
          typeof data.entity !== 'string' ||
          typeof data.entityId !== 'string' ||
          typeof data.operation !== 'string' ||
          typeof data.actorUid !== 'string' ||
          !(data.createdAt instanceof Timestamp)
        ) {
          throw new Error(`El registro de auditoría ${document.id} tiene un formato inválido.`)
        }
        return {
          id: document.id,
          entity: data.entity,
          entityId: data.entityId,
          operation: data.operation,
          actorUid: data.actorUid,
          createdAt: data.createdAt.toDate(),
        }
      })
      if (active) setEntries(result)
    })()
      .catch((caught: unknown) => {
        if (active) setError(firebaseOperationError(caught, 'Consultar auditoría'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <WorkspaceLayout title="Auditoría">
      <section className="workspace-page">
        <div className="workspace-page-heading">
          <div><p className="eyebrow">TRAZABILIDAD</p><h1>Auditoría</h1><p>Últimas 100 operaciones registradas. Los datos personales no se duplican en los eventos.</p></div>
          <ClipboardList size={23} />
        </div>
        {loading && <div className="patient-state" aria-live="polite"><LoaderCircle className="spin" size={21} /> Cargando auditoría...</div>}
        {error && <div className="patient-state patient-state-error" role="alert"><AlertCircle size={20} /> {error}</div>}
        {!loading && !error && entries.length === 0 && <div className="patient-detail-card"><p className="workspace-muted">Todavía no hay operaciones registradas.</p></div>}
        {!loading && !error && entries.length > 0 && (
          <div className="patient-detail-card workspace-table-wrap">
            <table className="workspace-table">
              <thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>Referencia</th><th>Actor</th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.createdAt.toLocaleString('es-AR')}</td>
                    <td>{entry.operation}</td>
                    <td>{entry.entity}</td>
                    <td><code>{entry.entityId}</code></td>
                    <td><code>{entry.actorUid}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </WorkspaceLayout>
  )
}
