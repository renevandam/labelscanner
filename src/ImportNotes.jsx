import { useState } from 'react'
import { supabase } from './lib/supabase.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const norm = (v) => String(v ?? '').trim().toLowerCase()

// Leest de kolom "Notitie klant" uit een eerder gedownloade Excel (gekoppeld via de kolom ID).
async function parseWorkbook(file) {
  const { default: readXlsxFile } = await import('read-excel-file')
  const sheet = await readXlsxFile(file)
  const headerIdx = sheet.findIndex((row) => row.some((c) => norm(c) === 'id') && row.some((c) => norm(c) === 'notitie klant'))
  if (headerIdx < 0) throw new Error('Kolommen "ID" en "Notitie klant" niet gevonden. Gebruik een Excel die uit de labelscanner is gedownload.')
  const header = sheet[headerIdx].map(norm)
  const idCol = header.indexOf('id')
  const noteCol = header.indexOf('notitie klant')
  const rows = []
  let skipped = 0
  for (const row of sheet.slice(headerIdx + 1)) {
    const id = String(row[idCol] ?? '').trim()
    const note = String(row[noteCol] ?? '').trim()
    if (!note) continue
    if (!UUID.test(id)) { skipped++; continue }
    rows.push({ id, note: note.slice(0, 2000) })
  }
  return { rows, skipped }
}

export default function ImportNotes({ onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState(null) // { rows, skipped, fileName }
  const [preview, setPreview] = useState(null) // { matched, changed, unknown }

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setPreview(null)
    setParsed(null)
    setBusy(true)
    try {
      const p = await parseWorkbook(file)
      if (!p.rows.length) throw new Error('Er staan geen klantnotities in dit bestand.')
      const { data, error } = await supabase.rpc('label_import_customer_notes', { p_rows: p.rows, p_apply: false })
      if (error) throw new Error(error.message)
      setParsed({ ...p, fileName: file.name })
      setPreview(data)
    } catch (err) {
      setError(err.message || 'Bestand lezen mislukt.')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    setBusy(true)
    const { data, error } = await supabase.rpc('label_import_customer_notes', { p_rows: parsed.rows, p_apply: true })
    setBusy(false)
    if (error) return setError('Inlezen mislukt: ' + error.message)
    onDone(`${data.changed} klantnotitie${data.changed === 1 ? '' : 's'} bijgewerkt`)
  }

  return (
    <div className="panel-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="panel narrow wide-ish" role="dialog" aria-modal="true" aria-labelledby="imp-title">
        <div className="panel-head">
          <h2 id="imp-title">Klantnotities inlezen</h2>
          <button onClick={onClose}>Sluiten</button>
        </div>
        <p className="hint">
          Kies de Excel die de klant heeft teruggestuurd. Alleen de kolom <b>Notitie klant</b> wordt overgenomen; de regels worden gekoppeld via de kolom <b>ID</b>. Lege notities laten een bestaande notitie staan.
        </p>
        <label className="btn">
          <input type="file" id="import-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={pick} disabled={busy} />
          {busy && !preview ? 'Lezen…' : 'Excel kiezen'}
        </label>

        {error && <p className="error">{error}</p>}

        {preview && (
          <div className="import-summary">
            <p><b>{parsed.fileName}</b></p>
            <ul>
              <li>{parsed.rows.length} regel{parsed.rows.length === 1 ? '' : 's'} met een klantnotitie</li>
              <li><b>{preview.changed}</b> daarvan {preview.changed === 1 ? 'is' : 'zijn'} nieuw of gewijzigd</li>
              {preview.matched - preview.changed > 0 && <li>{preview.matched - preview.changed} al gelijk aan wat er staat</li>}
              {preview.unknown > 0 && <li className="warn">{preview.unknown} niet gevonden (regel verwijderd of ID aangepast)</li>}
              {parsed.skipped > 0 && <li className="warn">{parsed.skipped} overgeslagen zonder geldig ID</li>}
            </ul>
            <div className="row-actions">
              <button className="primary" onClick={apply} disabled={busy || preview.changed === 0}>
                {busy ? 'Inlezen…' : preview.changed ? `${preview.changed} notitie${preview.changed === 1 ? '' : 's'} inlezen` : 'Niets te wijzigen'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
