import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Check,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  MessageCircle,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DentistId } from '../auth/auth-context'
import {
  CLINIC_PROFESSIONALS,
  professionalName,
} from '../lib/clinic'
import {
  createBudget,
  getPatientFinance,
  recordPayment,
  updateBudgetStatus,
  type PatientFinance,
} from '../lib/finance'
import {
  formatARS,
  parseMoneyToCents,
  type BudgetLineInput,
  type PaymentMethod,
} from '../lib/finance-logic'
import {
  deletePatientFile,
  getPatientFileBlob,
  listPatientFiles,
  uploadPatientFile,
  type PatientFile,
  type PatientFileExtension,
} from '../lib/patient-files'
import {
  createReferral,
  listReferrals,
  type Referral,
} from '../lib/referrals'
import { firebaseOperationError } from '../lib/firebase-errors'
import {
  prepareWhatsAppReminder,
  type WhatsAppReminderKind,
} from '../lib/whatsapp'

const Model3DViewer = lazy(async () => {
  const module = await import('./Model3DViewer')
  return { default: module.Model3DViewer }
})

export function PatientFilesSection({
  patientId,
  actorUid,
}: {
  patientId: string
  actorUid: string
}) {
  const [files, setFiles] = useState<PatientFile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    url: string
    name: string
    extension: Extract<PatientFileExtension, 'stl' | 'ply' | 'obj' | 'glb'>
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function reload() {
    setFiles(await listPatientFiles(patientId))
  }

  useEffect(() => {
    let active = true
    void listPatientFiles(patientId)
      .then((records) => {
        if (active) setFiles(records)
      })
      .catch(() => {
        if (active) setError('No se pudieron cargar los archivos del paciente.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [patientId])

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const file = inputRef.current?.files?.[0]
    if (!file) {
      setError('Seleccioná un archivo antes de continuar.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await uploadPatientFile(patientId, file, actorUid)
      await reload()
      setNotice('El archivo se guardó correctamente.')
      form.reset()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar el archivo.')
    } finally {
      setBusy(false)
    }
  }

  async function download(file: PatientFile) {
    setBusy(true)
    setError(null)
    try {
      const blob = await getPatientFileBlob(file)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.originalName
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo descargar el archivo.')
    } finally {
      setBusy(false)
    }
  }

  async function openModel(file: PatientFile) {
    if (!isModelExtension(file.extension)) return
    setBusy(true)
    setError(null)
    try {
      const blob = await getPatientFileBlob(file)
      setPreview({
        url: URL.createObjectURL(blob),
        name: file.originalName,
        extension: file.extension,
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo abrir el modelo 3D.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(file: PatientFile) {
    const prompt = file.status === 'deleting'
      ? 'El objeto está pendiente de eliminación. ¿Querés reintentar ahora?'
      : '¿Querés eliminar este archivo? Se conservará el registro de auditoría.'
    if (!window.confirm(prompt)) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await deletePatientFile(file.id, actorUid)
      await reload()
      setNotice('El archivo quedó eliminado; se conservó su registro de auditoría.')
      if (preview?.name === file.originalName) setPreview(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo eliminar el archivo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="patient-detail-card">
      <div className="patient-form-section-heading">
        <div>
          <h2>Archivos y modelos 3D</h2>
          <p>Adjuntá estudios y modelos autorizados. Límite por archivo: 100 MB.</p>
        </div>
      </div>
      <form className="workspace-upload-form" onSubmit={(event) => void handleUpload(event)}>
        <input
          accept=".pdf,.jpg,.jpeg,.png,.stl,.ply,.obj,.glb"
          aria-label="Archivo del paciente"
          ref={inputRef}
          type="file"
        />
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
          Adjuntar archivo
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="patient-notice patient-notice-success" role="status">{notice}</p>}
      {loading && <p className="workspace-muted">Cargando archivos...</p>}
      {!loading && files.length === 0 && <p className="workspace-muted">Todavía no hay archivos adjuntos.</p>}
      {files.length > 0 && (
        <ul className="workspace-file-list">
          {files.map((file) => (
            <li key={file.id}>
              <span className="workspace-list-icon"><FileText size={17} /></span>
              <span className="workspace-file-copy">
                <strong>{file.originalName}</strong>
                <small>
                  {file.extension.toUpperCase()} · {formatBytes(file.sizeBytes)}
                  {file.status === 'uploading' && ' · Carga pendiente'}
                  {file.status === 'deleting' && ' · Eliminación pendiente'}
                </small>
              </span>
              {isModelExtension(file.extension) && (
                <button className="icon-button" disabled={busy || file.status !== 'active'} onClick={() => void openModel(file)} title="Abrir visor 3D" type="button">
                  Visor 3D
                </button>
              )}
              <button aria-label={`Descargar ${file.originalName}`} className="icon-button" disabled={busy || file.status !== 'active'} onClick={() => void download(file)} title="Descargar" type="button">
                <Download size={17} />
              </button>
              <button aria-label={`${file.status === 'deleting' ? 'Reintentar eliminación' : 'Eliminar'} ${file.originalName}`} className="icon-button icon-button-danger" disabled={busy} onClick={() => void remove(file)} title={file.status === 'deleting' ? 'Reintentar eliminación' : 'Eliminar'} type="button">
                <Trash2 size={17} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <div className="workspace-model-dialog-backdrop" onClick={() => setPreview(null)} role="presentation">
          <section aria-label={`Visor 3D: ${preview.name}`} aria-modal="true" className="workspace-model-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
            <header>
              <div><p className="eyebrow">MODELO 3D</p><h3>{preview.name}</h3></div>
              <button className="icon-button" onClick={() => setPreview(null)} type="button">Cerrar</button>
            </header>
            <Suspense fallback={<div className="patient-state"><LoaderCircle className="spin" size={18} /> Cargando visor 3D...</div>}>
              <Model3DViewer extension={preview.extension} url={preview.url} />
            </Suspense>
          </section>
        </div>
      )}
    </section>
  )
}

export function PatientFinanceSection({
  patientId,
  actorUid,
}: {
  patientId: string
  actorUid: string
}) {
  const [finance, setFinance] = useState<PatientFinance | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lines, setLines] = useState<Array<BudgetLineInput & { price: string }>>([
    { description: '', quantity: 1, unitPriceCents: 0, price: '' },
  ])
  const [expiresOn, setExpiresOn] = useState('')
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, { amount: string; method: PaymentMethod }>>({})

  async function reload() {
    setFinance(await getPatientFinance(patientId))
  }

  useEffect(() => {
    let active = true
    void getPatientFinance(patientId)
      .then((result) => {
        if (active) setFinance(result)
      })
      .catch(() => {
        if (active) setError('No se pudo cargar la información financiera.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [patientId])

  async function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const input = lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceCents: parseMoneyToCents(line.price),
      }))
      await createBudget(patientId, input, expiresOn || null, actorUid)
      await reload()
      setLines([{ description: '', quantity: 1, unitPriceCents: 0, price: '' }])
      setExpiresOn('')
      setNotice('El presupuesto quedó registrado como pendiente.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo crear el presupuesto.')
    } finally {
      setBusy(false)
    }
  }

  async function changeBudgetStatus(budgetId: string, status: 'accepted' | 'rejected') {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await updateBudgetStatus(budgetId, status, actorUid)
      await reload()
      setNotice(status === 'accepted' ? 'El presupuesto fue aceptado.' : 'El presupuesto fue rechazado.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo actualizar el presupuesto.')
    } finally {
      setBusy(false)
    }
  }

  async function submitPayment(
    event: FormEvent<HTMLFormElement>,
    budgetId: string,
    itemId: string,
  ) {
    event.preventDefault()
    const draft = paymentDrafts[itemId] ?? { amount: '', method: 'cash' as PaymentMethod }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await recordPayment(
        patientId,
        budgetId,
        itemId,
        parseMoneyToCents(draft.amount),
        draft.method,
        actorUid,
      )
      await reload()
      setPaymentDrafts((current) => ({ ...current, [itemId]: { ...draft, amount: '' } }))
      setNotice('El pago quedó registrado.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo registrar el pago.')
    } finally {
      setBusy(false)
    }
  }

  function updateLine(index: number, patch: Partial<BudgetLineInput & { price: string }>) {
    setLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, ...patch } : line,
    ))
  }

  return (
    <section className="patient-detail-card">
      <div className="patient-form-section-heading">
        <div>
          <h2>Presupuestos y pagos</h2>
          <p>Importes en pesos argentinos; los movimientos quedan auditados.</p>
        </div>
        <Wallet size={19} />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="patient-notice patient-notice-success" role="status">{notice}</p>}
      {loading && <p className="workspace-muted">Cargando presupuestos y pagos...</p>}
      {!loading && (
        <>
          <form className="workspace-budget-form" onSubmit={(event) => void submitBudget(event)}>
            <h3>Nuevo presupuesto</h3>
            {lines.map((line, index) => (
              <div className="workspace-budget-line" key={index}>
                <label>Concepto
                  <input maxLength={200} onChange={(event) => updateLine(index, { description: event.target.value })} required value={line.description} />
                </label>
                <label>Cantidad
                  <input max={1000} min={1} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} required type="number" value={line.quantity} />
                </label>
                <label>Precio unitario
                  <input inputMode="decimal" onChange={(event) => updateLine(index, { price: event.target.value })} placeholder="0,00" required value={line.price} />
                </label>
                {lines.length > 1 && <button aria-label="Quitar concepto" className="icon-button icon-button-danger" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><Trash2 size={16} /></button>}
              </div>
            ))}
            <div className="workspace-form-actions">
              {lines.length < 25 && <button className="button button-secondary" onClick={() => setLines((current) => [...current, { description: '', quantity: 1, unitPriceCents: 0, price: '' }])} type="button"><Plus size={15} /> Agregar concepto</button>}
              <label>Vencimiento opcional
                <input onChange={(event) => setExpiresOn(event.target.value)} type="date" value={expiresOn} />
              </label>
              <button className="button button-primary" disabled={busy} type="submit">{busy ? 'Guardando...' : 'Crear presupuesto'}</button>
            </div>
          </form>
          {finance?.budgets.length === 0 && <p className="workspace-muted">Todavía no hay presupuestos para este paciente.</p>}
          {finance?.budgets.map(({ budget, items }) => (
            <article className="workspace-budget-card" key={budget.id}>
              <header>
                <div><strong>Presupuesto del {budget.createdAt.toLocaleDateString('es-AR')}</strong><span className={`workspace-status workspace-status-${budget.status}`}>{budgetStatusLabel(budget.status)}</span></div>
                {budget.status === 'pending' && (
                  <div className="workspace-inline-actions">
                    <button className="button button-secondary" disabled={busy} onClick={() => void changeBudgetStatus(budget.id, 'accepted')} type="button"><Check size={15} /> Aceptar</button>
                    <button className="button button-secondary" disabled={busy} onClick={() => void changeBudgetStatus(budget.id, 'rejected')} type="button">Rechazar</button>
                  </div>
                )}
              </header>
              <ul className="workspace-budget-items">
                {items.map((item) => {
                  const balance = Math.max(0, item.totalCents - item.paidCents)
                  const draft = paymentDrafts[item.id] ?? { amount: '', method: 'cash' as PaymentMethod }
                  return (
                    <li key={item.id}>
                      <div><strong>{item.description}</strong><small>{item.quantity} × {formatARS(item.unitPriceCents)} · Total {formatARS(item.totalCents)}</small></div>
                      <div className="workspace-balance"><small>Pagado {formatARS(item.paidCents)}</small><strong>Saldo {formatARS(balance)}</strong></div>
                      {budget.status === 'accepted' && balance > 0 && (
                        <form className="workspace-payment-form" onSubmit={(event) => void submitPayment(event, budget.id, item.id)}>
                          <label className="visually-hidden" htmlFor={`payment-${item.id}`}>Importe del pago</label>
                          <input id={`payment-${item.id}`} inputMode="decimal" onChange={(event) => setPaymentDrafts((current) => ({ ...current, [item.id]: { ...draft, amount: event.target.value } }))} placeholder="Importe" required value={draft.amount} />
                          <select aria-label="Método de pago" onChange={(event) => setPaymentDrafts((current) => ({ ...current, [item.id]: { ...draft, method: event.target.value as PaymentMethod } }))} value={draft.method}>
                            <option value="cash">Efectivo</option><option value="debit_card">Débito</option><option value="credit_card">Crédito</option><option value="transfer">Transferencia</option><option value="other">Otro</option>
                          </select>
                          <button className="button button-primary" disabled={busy} type="submit">Registrar pago</button>
                        </form>
                      )}
                    </li>
                  )
                })}
              </ul>
            </article>
          ))}
          {finance?.payments.length ? (
            <div className="workspace-payment-history">
              <h3>Últimos pagos</h3>
              {finance.payments.map((payment) => (
                <div key={payment.id}><span>{payment.paidAt.toLocaleDateString('es-AR')} · {payment.method}</span><strong>{formatARS(payment.amountCents)}</strong></div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

export function PatientReferralsSection({
  patientId,
  actorUid,
  actorDentistId,
}: {
  patientId: string
  actorUid: string
  actorDentistId: DentistId
}) {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [recipientDentistId, setRecipientDentistId] = useState<DentistId>(
    CLINIC_PROFESSIONALS.find(({ dentistId }) => dentistId !== actorDentistId)?.dentistId
      ?? 'pamela-moreira',
  )
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void listReferrals(patientId)
      .then((records) => {
        if (active) setReferrals(records)
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
  }, [patientId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await createReferral(
        { patientId, recipientDentistId, reason, notes },
        actorUid,
        actorDentistId,
      )
      setReason('')
      setNotes('')
      setReferrals(await listReferrals(patientId))
      setNotice('La derivación se registró y quedó pendiente de respuesta.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo crear la derivación.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="patient-detail-card">
      <div className="patient-form-section-heading">
        <div><h2>Derivaciones internas</h2><p>Compartí una solicitud de atención con otro profesional del consultorio.</p></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="patient-notice patient-notice-success" role="status">{notice}</p>}
      <form className="workspace-referral-form" onSubmit={(event) => void submit(event)}>
        <label>Profesional destinatario
          <select onChange={(event) => setRecipientDentistId(event.target.value as DentistId)} value={recipientDentistId}>
            {CLINIC_PROFESSIONALS.filter(({ dentistId }) => dentistId !== actorDentistId).map(({ dentistId, name }) => <option key={dentistId} value={dentistId}>{name}</option>)}
          </select>
        </label>
        <label>Motivo
          <textarea maxLength={1000} onChange={(event) => setReason(event.target.value)} required rows={2} value={reason} />
        </label>
        <label>Observaciones internas (opcional)
          <textarea maxLength={2000} onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} />
        </label>
        <button className="button button-primary" disabled={busy} type="submit">{busy ? 'Guardando...' : 'Crear derivación'}</button>
      </form>
      {loading && <p className="workspace-muted">Cargando derivaciones...</p>}
      {!loading && referrals.length === 0 && <p className="workspace-muted">Todavía no hay derivaciones para este paciente.</p>}
      {referrals.map((referral) => (
        <div className="workspace-referral-row" key={referral.id}>
          <div><strong>{professionalName(referral.referrerDentistId)} → {professionalName(referral.recipientDentistId)}</strong><small>{referral.reason}</small>{referral.notes && <small>{referral.notes}</small>}</div>
          <span className={`workspace-status workspace-status-${referral.status}`}>{referralStatusLabel(referral.status)}</span>
        </div>
      ))}
      <Link className="text-button" to="/referrals">Abrir bandeja de derivaciones</Link>
    </section>
  )
}

export function WhatsAppReminderLink({
  phone,
  patientName,
  appointment,
}: {
  phone: string
  patientName: string
  appointment?: { date: string; startTime: string }
}) {
  const [kind, setKind] = useState<WhatsAppReminderKind>('upcoming')
  let url: string | null = null
  let error: string | null = null
  try {
    url = prepareWhatsAppReminder(phone, patientName, kind, appointment).url
  } catch (caught) {
    if (caught instanceof Error) error = caught.message
  }
  return (
    <div className="workspace-whatsapp">
      <label>Mensaje manual por WhatsApp
        <select onChange={(event) => setKind(event.target.value as WhatsAppReminderKind)} value={kind}>
          <option value="confirm">Confirmación de turno</option>
          <option value="upcoming">Recordatorio</option>
          <option value="reschedule">Reprogramación</option>
          <option value="missed">Ausencia</option>
          <option value="payment">Saldo pendiente</option>
        </select>
      </label>
      {url
        ? <a className="button button-secondary" href={url} rel="noreferrer" target="_blank"><MessageCircle size={16} /> Preparar mensaje</a>
        : <p className="form-error" role="alert">{error}</p>}
      <small>Se abre WhatsApp con el texto preparado. El sistema no envía ni registra el mensaje.</small>
    </div>
  )
}

export function PatientNameLink({ patientId, name }: { patientId: string; name: string }) {
  return <Link className="workspace-patient-link" to={`/patients/${patientId}`}><ExternalLink size={15} /> {name}</Link>
}

export function WorkspaceReferralStatus({ status }: { status: Referral['status'] }) {
  return <span className={`workspace-status workspace-status-${status}`}>{referralStatusLabel(status)}</span>
}

function isModelExtension(extension: PatientFileExtension): extension is Extract<PatientFileExtension, 'stl' | 'ply' | 'obj' | 'glb'> {
  return ['stl', 'ply', 'obj', 'glb'].includes(extension)
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function budgetStatusLabel(status: string) {
  return status === 'accepted' ? 'Aceptado' : status === 'rejected' ? 'Rechazado' : 'Pendiente'
}

function referralStatusLabel(status: string) {
  return status === 'accepted' ? 'Aceptada' : status === 'rejected' ? 'Rechazada' : 'Pendiente'
}
