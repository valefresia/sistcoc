import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  FilePlus2,
  LoaderCircle,
  Pencil,
  Search,
  UsersRound,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import {
  fetchPatientCount,
  fetchPatientPage,
  formatPatientDate,
  isPatientPermissionError,
  searchPatients,
  type Patient,
} from '../lib/patients'
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore'

const PAGE_SIZE = 30

export function PatientListPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<Patient[] | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [searchParams] = useSearchParams()
  const successMessage =
    searchParams.get('created') === '1' ? 'Paciente registrado correctamente.' : null

  useEffect(() => {
    let active = true

    void Promise.all([
      fetchPatientPage(null, PAGE_SIZE),
      fetchPatientCount(),
    ])
      .then(([page, count]) => {
        if (!active) return
        setPatients(page.patients)
        setCursor(page.cursor)
        setHasMore(page.hasMore)
        setTotal(count)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(patientLoadError(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [refreshKey])

  useEffect(() => {
    const term = search.trim()
    if (!term) {
      return
    }

    let active = true
    const timeout = window.setTimeout(() => {
      void searchPatients(term)
        .then((results) => {
          if (active) {
            setSearchResults(results)
            setQueryError(null)
          }
        })
        .catch((caught: unknown) => {
          if (!active) return
          setQueryError(patientLoadError(caught))
          setSearchResults([])
        })
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [search])

  async function handleLoadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await fetchPatientPage(cursor, PAGE_SIZE)
      setPatients((current) => [...current, ...page.patients])
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch (caught) {
      setError(patientLoadError(caught))
    } finally {
      setLoadingMore(false)
    }
  }

  const visiblePatients = searchResults ?? patients
  const isSearching = search.trim().length > 0
  const searching = isSearching && searchResults === null

  return (
    <WorkspaceLayout title="Pacientes">
      <section className="patients-content">
        <div className="patients-page-header">
          <div>
            <p className="eyebrow">GESTIÓN DEL CENTRO</p>
            <h1>Pacientes</h1>
            <p>Administrá y consultá las fichas de los pacientes del centro.</p>
          </div>
          <Link className="button button-primary new-patient-button" to="/patients/new">
            <FilePlus2 size={17} />
            Nuevo paciente
          </Link>
        </div>

        {successMessage && (
          <div className="patient-notice patient-notice-success" role="status">
            <span className="notice-check">✓</span>
            {successMessage}
          </div>
        )}

        <div className="patient-stat-card">
          <span className="patient-stat-icon"><UsersRound size={20} /></span>
          <div>
            <span>Pacientes registrados</span>
            <strong>{total === null ? '—' : total.toLocaleString('es-AR')}</strong>
          </div>
        </div>

        <section className="patient-list-card">
          <div className="patient-list-toolbar">
            <div>
              <h2>Listado de pacientes</h2>
              <p>{total === null ? 'Consultando el total...' : `${total} registros en el centro`}</p>
            </div>
            <label className="patient-search">
              <Search size={17} />
              <input
                aria-label="Buscar por nombre, apellido o DNI"
                onChange={(event) => {
                  setSearch(event.target.value)
                  setSearchResults(null)
                  setQueryError(null)
                }}
                placeholder="Buscar por nombre, apellido o DNI"
                type="search"
                value={search}
              />
              {searching && <LoaderCircle aria-label="Buscando" className="spin" size={16} />}
            </label>
          </div>

          {error && (
            <div className="patient-state patient-state-error" role="alert">
              <AlertCircle size={20} />
              <div>
                <strong>Error al cargar información</strong>
                <p>{error}</p>
                <button
                  className="text-button"
                  onClick={() => {
                    setError(null)
                    setLoading(true)
                    setRefreshKey((key) => key + 1)
                  }}
                  type="button"
                >
                  Intentar nuevamente
                </button>
              </div>
            </div>
          )}

          {!error && loading && (
            <div className="patient-state" aria-live="polite">
              <LoaderCircle className="spin" size={22} />
              <span>Cargando pacientes...</span>
            </div>
          )}

          {!error && !loading && queryError && (
            <div className="patient-state patient-state-error" role="alert">
              <AlertCircle size={20} />
              <span>{queryError}</span>
            </div>
          )}

          {!error && !loading && !queryError && !searching && isSearching && searchResults?.length === 0 && (
            <div className="patient-state">
              <Search size={22} />
              <strong>No encontramos pacientes con esa búsqueda</strong>
              <span>Probá con otro nombre, apellido o DNI.</span>
            </div>
          )}

          {!error && !loading && !queryError && searching && (
            <div className="patient-state" aria-live="polite">
              <LoaderCircle className="spin" size={22} />
              <span>Buscando pacientes...</span>
            </div>
          )}

          {!error && !loading && !isSearching && total === 0 && (
            <div className="patient-state">
              <UsersRound size={25} />
              <strong>No hay pacientes registrados</strong>
              <span>Cuando registres un paciente, su ficha aparecerá aquí.</span>
              <Link className="button button-secondary" to="/patients/new">Registrar primer paciente</Link>
            </div>
          )}

          {!error && !loading && !queryError && !searching && visiblePatients.length > 0 && (
            <>
              <div className="patient-table-scroll">
                <table className="patient-table">
                  <thead>
                    <tr>
                      <th>Nombre y apellido</th>
                      <th>DNI</th>
                      <th>Teléfono</th>
                      <th>Correo electrónico</th>
                      <th>Fecha de registro</th>
                      <th><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePatients.map((patient) => (
                      <tr key={patient.id}>
                        <td>
                          <Link className="patient-name-link" to={`/patients/${patient.id}`}>
                            <span className="patient-avatar">{initials(patient.firstName, patient.lastName)}</span>
                            <span>{patient.firstName} {patient.lastName}</span>
                          </Link>
                        </td>
                        <td className="patient-dni">{patient.dni}</td>
                        <td>{patient.phone}</td>
                        <td>{patient.email || '—'}</td>
                        <td>{formatPatientDate(patient.createdAt)}</td>
                        <td>
                          <div className="patient-row-actions">
                            <Link aria-label={`Ver ficha de ${patient.firstName} ${patient.lastName}`} title="Ver ficha" to={`/patients/${patient.id}`}>
                              <ArrowRight size={16} />
                            </Link>
                            <Link aria-label={`Editar ${patient.firstName} ${patient.lastName}`} title="Editar información" to={`/patients/${patient.id}/edit`}>
                              <Pencil size={15} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!isSearching && hasMore && (
                <div className="load-more-row">
                  <button className="button button-secondary" disabled={loadingMore} onClick={() => void handleLoadMore()} type="button">
                    {loadingMore ? <LoaderCircle className="spin" size={16} /> : <ArrowDown size={16} />}
                    {loadingMore ? 'Cargando...' : 'Cargar más pacientes'}
                  </button>
                </div>
              )}
              {isSearching && (
                <p className="patient-search-count">
                  {visiblePatients.length} {visiblePatients.length === 1 ? 'resultado' : 'resultados'}
                </p>
              )}
            </>
          )}
        </section>
      </section>
    </WorkspaceLayout>
  )
}

function patientLoadError(error: unknown) {
  if (isPatientPermissionError(error)) {
    return 'Tu cuenta no tiene permisos para consultar pacientes. Contactá al administrador.'
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'unavailable'
  ) {
    return 'No se pudo conectar con Firebase. Revisá tu conexión e intentá nuevamente.'
  }
  return 'No se pudo cargar la información. Intentá nuevamente.'
}

function initials(firstName: string, lastName: string) {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()
}
