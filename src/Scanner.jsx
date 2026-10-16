import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, PHOTO_BUCKET } from './lib/supabase.js'
import { FIELDS, formatNlDate } from './lib/labels.js'
import ScanCard from './ScanCard.jsx'
import LocationBar from './LocationBar.jsx'

const PAGE = 100
const COLS = 'id, locatie, project, intern_order, unit, datum, coordinator, doos, lengte, pallet, rol, kabel, notitie, photo_path, created_at, scanned_by_email'

function applySearch(q, term) {
  const t = term.trim().replace(/[,%()]/g, ' ').trim()
  if (!t) return q
  return q.or(`unit.ilike.%${t}%,project.ilike.%${t}%,intern_order.ilike.%${t}%,locatie.ilike.%${t}%`)
}

export default function Scanner({ session }) {
  const [scans, setScans] = useState([])
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState('')
  const [armed, setArmed] = useState(null)
  const toastTimer = useRef()
  const [location, setLocationState] = useState(() => {
    try { return localStorage.getItem('labelscanner.locatie') || '' } catch { return '' }
  })
  const setLocation = useCallback((v) => {
    setLocationState(v)
    try { localStorage.setItem('labelscanner.locatie', v) } catch { /* privé-modus */ }
  }, [])

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3500)
  }, [])

  const load = useCallback(async (term, offset = 0) => {
    setLoading(true)
    let q = supabase.from('labels').select(COLS, { count: offset === 0 ? 'exact' : undefined })
    q = applySearch(q, term).order('created_at', { ascending: false }).range(offset, offset + PAGE - 1)
    const { data, error, count } = await q
    setLoading(false)
    if (error) return showToast('Lijst laden mislukt: ' + error.message)
    setRows((prev) => (offset === 0 ? data : [...prev, ...data]))
    if (offset === 0) setTotal(count)
    setHasMore(data.length === PAGE)
  }, [showToast])

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [search, load])

  function onFiles(e) {
    const files = [...e.target.files]
    e.target.value = ''
    if (!location) showToast('Let op: geen locatie ingesteld. Vul hem in bij de doos of scan eerst de plank.')
    setScans((s) => [...files.map((file) => ({ id: crypto.randomUUID(), file, location })), ...s])
  }

  function onScanDone(id, saved) {
    setScans((s) => s.filter((x) => x.id !== id))
    if (saved) load(search)
  }

  async function remove(row) {
    if (armed !== row.id) {
      setArmed(row.id)
      setTimeout(() => setArmed((a) => (a === row.id ? null : a)), 3000)
      return
    }
    setArmed(null)
    const { error } = await supabase.from('labels').delete().eq('id', row.id)
    if (error) return showToast('Verwijderen mislukt: ' + error.message)
    if (row.photo_path) await supabase.storage.from(PHOTO_BUCKET).remove([row.photo_path])
    setRows((r) => r.filter((x) => x.id !== row.id))
    setTotal((t) => (t == null ? t : t - 1))
  }

  async function openPhoto(path) {
    const w = window.open('', '_blank')
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 300)
    if (error || !data) { w?.close(); return showToast('Foto niet gevonden') }
    if (w) w.location = data.signedUrl
    else window.location.href = data.signedUrl
  }

  async function doExport() {
    setExporting(true)
    try {
      const all = []
      for (let from = 0; ; from += 1000) {
        let q = supabase.from('labels').select(COLS)
        q = applySearch(q, search).order('created_at', { ascending: false }).range(from, from + 999)
        const { data, error } = await q
        if (error) throw error
        all.push(...data)
        if (data.length < 1000) break
      }
      if (!all.length) return showToast('Er is niets om te exporteren')
      const { exportLabels } = await import('./lib/excel.js')
      await exportLabels(all)
    } catch (e) {
      showToast('Exporteren mislukt: ' + (e.message || e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Labelscanner</h1>
          <p className="sub">Fotografeer een doossticker, controleer de velden, exporteer naar Excel.</p>
        </div>
        <div className="who">
          <span>{session.user.email}</span>
          <button className="link" onClick={() => supabase.auth.signOut()}>Uitloggen</button>
        </div>
      </header>

      <LocationBar location={location} onChange={setLocation} />

      <div className="actions">
        <label className="scan">
          <input type="file" id="cam" accept="image/*" capture="environment" multiple onChange={onFiles} />
          Foto maken van label
        </label>
        <label className="scan alt">
          <input type="file" id="gallery" accept="image/*" multiple onChange={onFiles} />
          Uit galerij kiezen
        </label>
      </div>

      {scans.length > 0 && (
        <section className="queue" aria-live="polite">
          {scans.map((s) => (
            <ScanCard key={s.id} scan={s} userId={session.user.id} onDone={onScanDone} onToast={showToast} />
          ))}
        </section>
      )}

      <section className="list">
        <div className="listhead">
          <h2>Gescande labels {total != null && <span className="count">{total}</span>}</h2>
          <div className="list-tools">
            <input id="search" type="search" placeholder="Zoek unit, project, order of locatie" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="primary" onClick={doExport} disabled={exporting || !total}>
              {exporting ? 'Bezig…' : search ? 'Excel (gefilterd)' : 'Excel downloaden'}
            </button>
          </div>
        </div>
        <div className="tablebox">
          <table>
            <thead>
              <tr>
                {FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}
                <th>Gescand</th>
                <th>Door</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={FIELDS.length + 3} className="empty">
                    {loading ? 'Laden…' : search ? 'Geen labels gevonden voor deze zoekterm.' : 'Nog geen labels. Maak een foto van een sticker om de eerste regel toe te voegen.'}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  {FIELDS.map((f) => (
                    <td key={f.key}>{f.type === 'date' ? formatNlDate(r[f.key]) : r[f.key] ?? ''}</td>
                  ))}
                  <td>{new Date(r.created_at).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{r.scanned_by_email ?? ''}</td>
                  <td className="row-btns">
                    {r.photo_path && <button onClick={() => openPhoto(r.photo_path)}>Foto</button>}
                    <button className="danger" onClick={() => remove(r)}>{armed === r.id ? 'Zeker?' : 'Verwijder'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <button className="more" onClick={() => load(search, rows.length)} disabled={loading}>
            {loading ? 'Laden…' : 'Meer laden'}
          </button>
        )}
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
