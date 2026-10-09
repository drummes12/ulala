import { ChangeEvent, useMemo, useState } from 'react'
import { FileCsv, UploadSimple } from '@phosphor-icons/react'
import { csvTemplate, parseCsv } from '../lib/csv'
import { bookingStatusLabel, planStatusLabel } from '../lib/planLabels'
import type { CsvPlanInput, LocalPlan } from '../types'
import { useDialogFocus } from '../lib/useDialogFocus'

interface CsvImporterProps {
  existingPlans: LocalPlan[]
  onClose: () => void
  onImport: (plans: CsvPlanInput[]) => Promise<void>
}

export function CsvImporter({
  existingPlans,
  onClose,
  onImport
}: CsvImporterProps) {
  const [text, setText] = useState('')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useDialogFocus<HTMLElement>()

  const parsed = useMemo(() => (text.trim() ? parseCsv(text) : null), [text])
  const withDuplicates = useMemo(() => {
    if (!parsed) return []
    const keys = new Set(
      existingPlans.map((plan) =>
        planKey(plan.title, plan.local_date, plan.start_time)
      )
    )
    return parsed.plans.map((plan) => ({
      ...plan,
      duplicateOf: keys.has(
        planKey(plan.title, plan.local_date, plan.start_time)
      )
        ? 'existing'
        : undefined
    }))
  }, [existingPlans, parsed])
  const importable = withDuplicates.filter(
    (plan) => !skipDuplicates || !plan.duplicateOf
  )

  function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  function downloadTemplate() {
    const blob = new Blob([csvTemplate()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'ulala-itinerario.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function submit() {
    if (!parsed || parsed.errors.length || !importable.length) return
    setImporting(true)
    setError('')
    try {
      await onImport(importable)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo importar.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div
      className='sheet-backdrop'
      role='presentation'
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <section
        ref={dialogRef}
        className='sheet csv-sheet'
        role='dialog'
        aria-modal='true'
        aria-labelledby='csv-title'
      >
        <header className='sheet-header'>
          <div>
            <h2 id='csv-title'>CSV desde Excel</h2>
          </div>
          <button
            className='icon-button'
            type='button'
            onClick={onClose}
            aria-label='Cerrar'
          >
            ×
          </button>
        </header>
        <div className='stack sheet-body'>
          <div className='import-actions'>
            <label className='file-button'>
              <UploadSimple size={18} /> Elegir CSV
              <input type='file' accept='.csv,text/csv' onChange={readFile} />
            </label>
            <button
              className='secondary-button'
              type='button'
              onClick={downloadTemplate}
            >
              <FileCsv size={18} /> Plantilla
            </button>
          </div>
          <div className='helper csv-help'>
            <p>
              Mínimas: <code>fecha</code>, <code>hora_inicio</code> y{' '}
              <code>titulo</code>.
            </p>
            <p>
              Acepta fechas <code>AAAA-MM-DD</code> o <code>DD/MM/AAAA</code>;
              horas <code>HH:mm</code> o rangos como <code>17:30-20:30</code>.
            </p>
            <p>
              Estados: <code>Confirmado</code>, <code>Por reservar</code>,{' '}
              <code>Reserva recomendada</code>, <code>Sin reserva previa</code>,{' '}
              <code>Libre</code>, <code>Opcional</code>, <code>Plan</code>,{' '}
              <code>Idea</code> o <code>Hecho</code>.
            </p>
            <p>
              Columnas extra como <code>Costo</code> o{' '}
              <code>Duración Estimada</code> se guardan en Notas.
            </p>
          </div>
          <label>
            <span>O pega el contenido</span>
            <textarea
              className='csv-input'
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={7}
              placeholder='fecha,hora_inicio,titulo…'
            />
          </label>

          {parsed ? (
            <section className='preview' aria-live='polite'>
              <h3>Vista previa</h3>
              {parsed.warnings.length ? (
                <ul className='warning-list'>
                  {parsed.warnings.slice(0, 8).map((issue) => (
                    <li key={`warning-${issue.row}-${issue.message}`}>
                      Fila {issue.row}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {parsed.errors.length ? (
                <ul className='error-list'>
                  {parsed.errors.slice(0, 8).map((issue) => (
                    <li key={`${issue.row}-${issue.message}`}>
                      Fila {issue.row}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <label className='check-row'>
                    <input
                      type='checkbox'
                      checked={skipDuplicates}
                      onChange={(event) =>
                        setSkipDuplicates(event.target.checked)
                      }
                    />
                    Omitir{' '}
                    {withDuplicates.filter((plan) => plan.duplicateOf).length}{' '}
                    duplicados
                  </label>
                  <ul className='preview-list'>
                    {withDuplicates.slice(0, 8).map((plan) => (
                      <li
                        key={plan.sourceRow}
                        className={plan.duplicateOf ? 'duplicate' : ''}
                      >
                        <strong>
                          {plan.start_time} · {plan.title}
                        </strong>
                        <span>
                          {plan.local_date} · {planStatusLabel(plan.status)}
                          {plan.booking_status !== 'none'
                            ? ` · ${bookingStatusLabel(plan.booking_status)}`
                            : ''}
                          {plan.duplicateOf ? ' · ya existe' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className='helper'>
                    Se importarán {importable.length} de {withDuplicates.length}{' '}
                    filas válidas.
                  </p>
                </>
              )}
            </section>
          ) : null}
          {error ? (
            <p className='form-error' role='alert'>
              {error}
            </p>
          ) : null}
          <div className='sheet-actions'>
            <button
              className='secondary-button'
              type='button'
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              className='primary-button'
              type='button'
              disabled={
                !parsed ||
                Boolean(parsed.errors.length) ||
                !importable.length ||
                importing
              }
              onClick={() => void submit()}
            >
              {importing ? 'Importando…' : 'Importar planes'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function planKey(title: string, date: string, time: string) {
  return `${title.trim().toLowerCase()}|${date}|${time.slice(0, 5)}`
}
