import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, PHOTO_BUCKET } from './lib/supabase.js'
import { FIELDS, formatNlDate, parseNlDate, parseQty } from './lib/labels.js'

const PAGE = 100
const COLS = 'id, locatie, project, intern_order, unit, datum, coordinator, doos, lengte, pallet, rol, kabel, notitie, photo_path, created_at, scanned_by, scanned_by_email'

// Kolommen in de tabel: de stickervelden plus wanneer en door wie gescand.
const COLUMNS = [
  ...FIELDS,
  { key: 'created_at', label: 'Gescand', type: 'stamp', readOnly: true },
  { key: 'scanned_by_email', label: 'Door', type: 'person', readOnly: true },
]

const like = (v) => `%${v.replace(/[%_\\]/g, (c) => '\\' + c)}%`

// Datumfilter: "11-4-2024" (die dag), "4-2024" (die maand) of "2024" (dat jaar).
function dateRange(v) {
  const t = v.trim()
  const iso = parseNlDate(t)
  if (iso) return [iso, iso]
  let m = t.match(/^(\d{1,2})[-/.](\d{4})$/)
  if (m) {
    const y = +m[2], mo = +m[1]
    if (mo < 1 || mo > 12) return null
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
    const mm = String(mo).padStart(2, '0')
    return [`${y}-${mm}-01`, `${y}-${mm}-${last}`]
  }
  m = t.match(/^(\d{4})$/)
  if (m) return [`${m[1]}-01-01`, `${m[1]}-12-31`]
  return null
}

function applyFilters(q, search, filters, people = {}) {
  const t = search.trim().replace(/[,%()*]/g, ' ').trim()
  if (t) q = q.or(['unit', 'project', 'intern_order', 'locatie'].map((c) => `${c}.ilike.*${t}*`).join(','))
  for (const col of COLUMNS) {
    const v = (filters[col.key] || '').trim()
    if (!v) continue
    if (col.type === 'text') q = q.ilike(col.key, like(v))
    else if (col.type === 'person') {
      // Zoek op naam (via de ledenlijst) of op e-mailadres.
      const term = v.toLowerCase()
      const ids = Object.entries(people).filter(([, n]) => n.toLowerCase().includes(term)).map(([id]) => id)
      const safe = v.replace(/[,%()*]/g, ' ').trim()
      q = q.or([`scanned_by_email.ilike.*${safe}*`, ids.length ? `scanned_by.in.(${ids.join(',')})` : null].filter(Boolean).join(','))
    }
    else if (col.type === 'qty') {
      const n = parseQty(v)
      if (n != null && !Number.isNaN(n)) q = q.eq(col.key, n)
    } else if (col.type === 'date') {
      const r = dateRange(v)
      if (r) q = q.gte(col.key, r[0]).lte(col.key, r[1])
    } else if (col.type === 'stamp') {
      const r = dateRange(v)
      if (r) {
        const [y1, m1, d1] = r[0].split('-').map(Number)
        const [y2, m2, d2] = r[1].split('-').map(Number)
        q = q.gte(col.key, new Date(y1, m1 - 1, d1).toISOString()).lt(col.key, new Date(y2, m2 - 1, d2 + 1).toISOString())
      }
    }
  }
  return q
}

function display(col, r, people) {
  if (col.type === 'person') return people[r.scanned_by] || r.scanned_by_email || ''
  const v = r[col.key]
  if (col.type === 'date') return formatNlDate(v)
  if (col.type === 'stamp') return new Date(v).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
  return v ?? ''
}

// Zet de getypte waarde om naar wat de database verwacht; { value } of { error }.
function parseEdit(col, raw) {
  const v = raw.trim()
  if (col.type === 'date') {
    if (!v) return { value: null }
    const iso = parseNlDate(v)
    return iso ? { value: iso } : { error: 'Gebruik dag-maand-jaar, bv. 11-4-2024' }
  }
  if (col.type === 'qty') {
    const n = parseQty(v)
    return Number.isNaN(n) ? { error: `${col.label} moet een getal zijn` } : { value: n }
  }
  return { value: v || null }
}

export default function LabelTable({ isEditor, reloadKey, showToast }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({})
  const [showFilters, setShowFilters] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(null) // { id, key, value }
  const [exporting, setExporting] = useState(false)
  const query = useRef({ search: '', filters: {} })

  // Schuifbalk boven de tabel die gelijk loopt met de onderste.
  const boxRef = useRef(null)
  const topRef = useRef(null)
  const [scrollW, setScrollW] = useState(0)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => {
      setScrollW(box.scrollWidth)
      setOverflow(box.scrollWidth > box.clientWidth + 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    if (box.firstElementChild) ro.observe(box.firstElementChild)
    return () => ro.disconnect()
  }, [])
  const syncing = useRef(false)
  function syncFrom(src, dst) {
    if (syncing.current) { syncing.current = false; return }
    if (dst && dst.scrollLeft !== src.scrollLeft) {
      syncing.current = true
      dst.scrollLeft = src.scrollLeft
    }
  }
  // Namen van leden (user_id → naam) voor de kolom "Door"; één kleine query.
  const [people, setPeople] = useState({})
  const peopleRef = useRef({})
  useEffect(() => {
    supabase.from('label_members').select('user_id, name').then(({ data }) => {
      const map = Object.fromEntries((data || []).filter((m) => m.name).map((m) => [m.user_id, m.name]))
      peopleRef.current = map
      setPeople(map)
    })
  }, [reloadKey])

  const load = useCallback(async (offset = 0) => {
    setLoading(true)
    const { search, filters } = query.current
    let q = supabase.from('labels').select(COLS, { count: offset === 0 ? 'exact' : undefined })
    q = applyFilters(q, search, filters, peopleRef.current).order('created_at', { ascending: false }).range(offset, offset + PAGE - 1)
    const { data, error, count } = await q
    setLoading(false)
    if (error) return showToast('Lijst laden mislukt: ' + error.message)
    setRows((prev) => (offset === 0 ? data : [...prev, ...data]))
    if (offset === 0) {
      setTotal(count)
      setSelected(new Set())
    }
    setHasMore(data.length === PAGE)
  }, [showToast])

  // Zoeken en filteren: pas na een korte pauze in het typen een nieuwe query.
  useEffect(() => {
    const busy = search || Object.values(filters).some(Boolean)
    const t = setTimeout(() => {
      query.current = { search, filters }
      load(0)
    }, busy ? 350 : 0)
    return () => clearTimeout(t)
  }, [search, filters, load, reloadKey])

  const filtered = !!search.trim() || Object.values(filters).some((v) => v?.trim())

  function setFilter(key, v) {
    setFilters((f) => ({ ...f, [key]: v }))
  }

  function toggle(id) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
    setConfirming(false)
  }
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))
    setConfirming(false)
  }

  async function deleteSelected() {
    const ids = [...selected]
    const photos = rows.filter((r) => selected.has(r.id) && r.photo_path).map((r) => r.photo_path)
    setDeleting(true)
    const { error } = await supabase.from('labels').delete().in('id', ids)
    setDeleting(false)
    setConfirming(false)
    if (error) return showToast('Verwijderen mislukt: ' + error.message)
    if (photos.length) await supabase.storage.from(PHOTO_BUCKET).remove(photos)
    setRows((r) => r.filter((x) => !selected.has(x.id)))
    setTotal((t) => (t == null ? t : Math.max(0, t - ids.length)))
    setSelected(new Set())
    showToast(`${ids.length} regel${ids.length === 1 ? '' : 's'} verwijderd`)
  }

  function startEdit(r, col) {
    if (!isEditor || col.readOnly) return
    const v = col.type === 'date' ? formatNlDate(r[col.key]) : r[col.key] ?? ''
    setEditing({ id: r.id, key: col.key, value: String(v), original: String(v) })
  }

  async function commitEdit() {
    const e = editing
    if (!e) return
    setEditing(null)
    if (e.value.trim() === e.original.trim()) return
    const col = COLUMNS.find((c) => c.key === e.key)
    const { value, error } = parseEdit(col, e.value)
    if (error) return showToast(error)
    const { data, error: dbErr } = await supabase.from('labels').update({ [e.key]: value }).eq('id', e.id).select(COLS).single()
    if (dbErr) return showToast('Wijzigen mislukt: ' + dbErr.message)
    setRows((rs) => rs.map((r) => (r.id === e.id ? data : r)))
    showToast(`${col.label} gewijzigd`)
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
        q = applyFilters(q, query.current.search, query.current.filters, peopleRef.current).order('created_at', { ascending: false }).range(from, from + 999)
        const { data, error } = await q
        if (error) throw error
        all.push(...data)
        if (data.length < 1000) break
      }
      if (!all.length) return showToast('Er is niets om te exporteren')
      const { exportLabels } = await import('./lib/excel.js')
      await exportLabels(all.map((r) => ({ ...r, door: people[r.scanned_by] || r.scanned_by_email || '' })))
    } catch (e) {
      showToast('Exporteren mislukt: ' + (e.message || e))
    } finally {
      setExporting(false)
    }
  }

  const colCount = COLUMNS.length + 1 + (isEditor ? 1 : 0)

  return (
    <section className="list">
      <div className="listhead">
        <h2>Gescande labels {total != null && <span className="count">{total}</span>}</h2>
        <div className="list-tools">
          <input id="search" type="search" placeholder="Zoek unit, project, order of locatie" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button onClick={() => setShowFilters((v) => !v)} aria-pressed={showFilters}>
            {showFilters ? 'Filters verbergen' : 'Zoeken per kolom'}
          </button>
          <button className="primary" onClick={doExport} disabled={exporting || !total}>
            {exporting ? 'Bezig…' : filtered ? 'Excel (gefilterd)' : 'Excel downloaden'}
          </button>
        </div>
      </div>

      {isEditor && selected.size > 0 && (
        <div className="selbar" role="region" aria-label="Selectie">
          <span>{selected.size} geselecteerd</span>
          {confirming ? (
            <>
              <span className="selbar-q">Definitief verwijderen, inclusief foto's?</span>
              <button className="danger-fill" onClick={deleteSelected} disabled={deleting}>{deleting ? 'Verwijderen…' : 'Ja, verwijder'}</button>
              <button onClick={() => setConfirming(false)} disabled={deleting}>Annuleren</button>
            </>
          ) : (
            <>
              <button className="danger-fill" onClick={() => setConfirming(true)}>Verwijderen</button>
              <button onClick={() => setSelected(new Set())}>Selectie wissen</button>
            </>
          )}
        </div>
      )}

      {isEditor && <p className="hint">Klik op een cel om hem te wijzigen. Enter slaat op, Esc annuleert.</p>}

      <div className="topscroll" ref={topRef} hidden={!overflow} aria-hidden="true" onScroll={(e) => syncFrom(e.currentTarget, boxRef.current)}>
        <div style={{ width: scrollW, height: 1 }} />
      </div>
      <div className="tablebox" ref={boxRef} onScroll={(e) => syncFrom(e.currentTarget, topRef.current)}>
        <table className={isEditor ? 'editable' : undefined}>
          <thead>
            <tr>
              {isEditor && (
                <th className="chk">
                  <input type="checkbox" id="select-all" aria-label="Alles selecteren" checked={allChecked} onChange={toggleAll} />
                </th>
              )}
              {COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
              <th></th>
            </tr>
            {showFilters && (
              <tr className="filters">
                {isEditor && <th />}
                {COLUMNS.map((c) => (
                  <th key={c.key}>
                    <input
                      id={`filter-${c.key}`}
                      aria-label={`Filter ${c.label}`}
                      value={filters[c.key] || ''}
                      onChange={(e) => setFilter(c.key, e.target.value)}
                      placeholder={c.type === 'date' || c.type === 'stamp' ? 'd-m-jjjj' : c.type === 'qty' ? '=' : 'bevat…'}
                      inputMode={c.type === 'qty' ? 'decimal' : undefined}
                    />
                  </th>
                ))}
                <th>
                  {Object.values(filters).some(Boolean) && (
                    <button className="link" onClick={() => setFilters({})}>Wis</button>
                  )}
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty">
                  {loading ? 'Laden…' : filtered ? 'Geen labels gevonden met deze zoekcriteria.' : 'Nog geen labels. Maak een foto van een sticker om de eerste regel toe te voegen.'}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? 'sel' : undefined}>
                {isEditor && (
                  <td className="chk">
                    <input type="checkbox" id={`sel-${r.id}`} aria-label="Selecteer regel" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                {COLUMNS.map((c) => {
                  const isEdit = editing?.id === r.id && editing.key === c.key
                  return (
                    <td
                      key={c.key}
                      className={isEditor && !c.readOnly ? 'cell-edit' : undefined}
                      onClick={() => !isEdit && startEdit(r, c)}
                    >
                      {isEdit ? (
                        <input
                          id={`edit-${r.id}-${c.key}`}
                          autoFocus
                          value={editing.value}
                          onChange={(e) => setEditing((x) => ({ ...x, value: e.target.value }))}
                          onBlur={(e) => (e.currentTarget.dataset.cancel ? setEditing(null) : commitEdit())}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') { e.currentTarget.dataset.cancel = '1'; e.currentTarget.blur() }
                          }}
                          inputMode={c.type === 'qty' ? 'decimal' : undefined}
                        />
                      ) : (
                        display(c, r, people)
                      )}
                    </td>
                  )
                })}
                <td className="row-btns">
                  {r.photo_path && <button onClick={() => openPhoto(r.photo_path)}>Foto</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button className="more" onClick={() => load(rows.length)} disabled={loading}>
          {loading ? 'Laden…' : 'Meer laden'}
        </button>
      )}
    </section>
  )
}
