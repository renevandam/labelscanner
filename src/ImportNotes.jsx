import { useState } from 'react'
import { supabase } from './lib/supabase.js'
import { useLang } from './lib/i18n.jsx'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const norm = (v) => String(v ?? '').trim().toLowerCase()
// Kolomnaam in de Nederlandse en Engelse export
const NOTE_HEADERS = ['notitie klant', 'customer note']

// Leest de kolom "Notitie klant" / "Customer note" uit een eerder gedownloade Excel (gekoppeld via ID).
async function parseWorkbook(file) {
  const { default: readXlsxFile } = await import('read-excel-file')
  const sheet = await readXlsxFile(file)
  const headerIdx = sheet.findIndex((row) => row.some((c) => norm(c) === 'id') && row.some((c) => NOTE_HEADERS.includes(norm(c))))
  if (headerIdx < 0) throw new Error('imp.noColumns')
  const header = sheet[headerIdx].map(norm)
  const idCol = header.indexOf('id')
  const noteCol = header.findIndex((h) => NOTE_HEADERS.includes(h))
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
  const { t } = useLang()
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
      if (!p.rows.length) throw new Error('imp.noNotes')
      const { data, error } = await supabase.rpc('label_import_customer_notes', { p_rows: p.rows, p_apply: false })
      if (error) throw new Error(error.message)
      setParsed({ ...p, fileName: file.name })
      setPreview(data)
    } catch (err) {
      const msg = err?.message || 'imp.readFailed'
      setError(msg.startsWith('imp.') ? t(msg) : msg)
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    setBusy(true)
    const { data, error } = await supabase.rpc('label_import_customer_notes', { p_rows: parsed.rows, p_apply: true })
    setBusy(false)
    if (error) return setError(t('imp.applyFailed', { msg: error.message }))
    onDone(t('imp.done', { n: data.changed }))
  }

  const same = preview ? preview.matched - preview.changed : 0

  return (
    <div className="panel-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="panel narrow wide-ish" role="dialog" aria-modal="true" aria-labelledby="imp-title">
        <div className="panel-head">
          <h2 id="imp-title">{t('imp.title')}</h2>
          <button onClick={onClose}>{t('common.close')}</button>
        </div>
        <p className="hint">{t('imp.help')}</p>
        <label className="btn">
          <input type="file" id="import-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={pick} disabled={busy} />
          {busy && !preview ? t('imp.reading') : t('imp.pick')}
        </label>

        {error && <p className="error">{error}</p>}

        {preview && (
          <div className="import-summary">
            <p><b>{parsed.fileName}</b></p>
            <ul>
              <li>{t('imp.rows', { n: parsed.rows.length })}</li>
              <li><b>{t('imp.changed', { n: preview.changed })}</b></li>
              {same > 0 && <li>{t('imp.same', { n: same })}</li>}
              {preview.unknown > 0 && <li className="warn">{t('imp.unknown', { n: preview.unknown })}</li>}
              {parsed.skipped > 0 && <li className="warn">{t('imp.skipped', { n: parsed.skipped })}</li>}
            </ul>
            <div className="row-actions">
              <button className="primary" onClick={apply} disabled={busy || preview.changed === 0}>
                {busy ? t('imp.applying') : preview.changed ? t('imp.apply', { n: preview.changed }) : t('imp.nothing')}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
