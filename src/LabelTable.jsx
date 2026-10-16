import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, PHOTO_BUCKET } from './lib/supabase.js'
import { FIELDS, formatNlDate, parseNlDate, parseQty } from './lib/labels.js'
import ImportNotes from './ImportNotes.jsx'
import { useLang } from './lib/i18n.jsx'

const PAGE = 100
const COLS = 'id, locatie, project, intern_order, unit, datum, coordinator, doos, lengte, pallet, rol, kabel, notitie, photo_path, klant_notitie, actief, operator, created_at, scanned_by, scanned_by_email'

// Kolommen in de tabel: de stickervelden plus wanneer en door wie gescand.
const COLUMNS = [
  { key: 'actief', label: 'Actief', type: 'bool', readOnly: true },
  ...FIELDS,
  { key: 'klant_notitie', label: 'Notitie klant', type: 'text' },
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
    if (col.type === 'bool') {
      if (v === 'ja') q = q.eq(col.key, true)
      else if (v === 'nee') q = q.eq(col.key, false)
    }
    else if (col.type === 'text') q = q.ilike(col.key, like(v))
    else if (col.type === 'person') {
      // Zoek op operator, naam (via de ledenlijst) of e-mailadres.
      const term = v.toLowerCase()
      const ids = Object.entries(people).filter(([, n]) => n.toLowerCase().includes(term)).map(([id]) => id)
      const safe = v.replace(/[,%()*]/g, ' ').trim()
      q = q.or([`operator.ilike.*${safe}*`, `scanned_by_email.ilike.*${safe}*`, ids.length ? `scanned_by.in.(${ids.join(',')})` : null].filter(Boolean).join(','))
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

// Wie scande: de operator (bij gedeelde scanner-accounts), anders de naam van het account.
function who(r, people, hideEmail) {
  return r.operator || people[r.scanned_by] || (hideEmail ? '' : r.scanned_by_email) || ''
}

function display(col, r, people, hideEmail, locale) {
  if (col.type === 'person') return who(r, people, hideEmail)
  const v = r[col.key]
  if (col.type === 'date') return formatNlDate(v)
  if (col.type === 'stamp') return new Date(v).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
  return v ?? ''
}

// Zet de getypte waarde om naar wat de database verwacht; { value } of { error }.
function parseEdit(col, raw, t) {
  const v = raw.trim()
  if (col.type === 'date') {
    if (!v) return { value: null }
    const iso = parseNlDate(v)
    return iso ? { value: iso } : { error: t('list.dateHelp') }
  }
  if (col.type === 'qty') {
    const n = parseQty(v)
    return Number.isNaN(n) ? { error: t('err.qty', { f: t(`field.${col.key}`) }) } : { value: n }
  }
  return { value: v || null }
}

export default function LabelTable({ isEditor, isCustomer, reloadKey, showToast }) {
  const { t, lang, locale } = useLang()
  const [importing, setImporting] = useState(false)
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
  const [settingActive, setSettingActive] = useState(false)
  // Beheerder en klant mogen Actief omzetten en dus ook regels selecteren.
  const canToggle = isEditor || isCustomer
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
    if (error) return showToast(t('list.loadFailed', { msg: error.message }))
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
    if (error) return showToast(t('list.deleteFailed', { msg: error.message }))
    if (photos.length) await supabase.storage.from(PHOTO_BUCKET).remove(photos)
    setRows((r) => r.filter((x) => !selected.has(x.id)))
    setTotal((t) => (t == null ? t : Math.max(0, t - ids.length)))
    setSelected(new Set())
    showToast(t('list.deleted', { n: ids.length }))
  }

  async function setActive(ids, active) {
    if (!ids.length) return
    setSettingActive(true)
    const { error } = await supabase.rpc('label_set_active', { p_ids: ids, p_active: active })
    setSettingActive(false)
    if (error) return showToast(t('list.changeFailed', { msg: error.message }))
    const set = new Set(ids)
    setRows((rs) => rs.map((r) => (set.has(r.id) ? { ...r, actief: active } : r)))
    if (ids.length > 1) {
      showToast(t(active ? 'list.activeSet' : 'list.inactiveSet', { n: ids.length }))
      setSelected(new Set())
    }
  }

  // Beheerder: alle bewerkbare kolommen. Klant: alleen Notitie klant.
  const canEditCol = (col) => !col.readOnly && (isEditor || (isCustomer && col.key === 'klant_notitie'))

  function startEdit(r, col) {
    if (!canEditCol(col)) return
    const v = col.type === 'date' ? formatNlDate(r[col.key]) : r[col.key] ?? ''
    setEditing({ id: r.id, key: col.key, value: String(v), original: String(v) })
  }

  async function commitEdit() {
    const e = editing
    if (!e) return
    setEditing(null)
    if (e.value.trim() === e.original.trim()) return
    const col = COLUMNS.find((c) => c.key === e.key)
    const { value, error } = parseEdit(col, e.value, t)
    if (error) return showToast(error)
    if (e.key === 'klant_notitie') {
      // Via een aparte functie, zodat klanten verder niets kunnen wijzigen.
      const { data: note, error: rpcErr } = await supabase.rpc('label_set_customer_note', { p_id: e.id, p_note: value ?? '' })
      if (rpcErr) return showToast(t('list.changeFailed', { msg: rpcErr.message }))
      setRows((rs) => rs.map((r) => (r.id === e.id ? { ...r, klant_notitie: note } : r)))
    } else {
      const { data, error: dbErr } = await supabase.from('labels').update({ [e.key]: value }).eq('id', e.id).select(COLS).single()
      if (dbErr) return showToast(t('list.changeFailed', { msg: dbErr.message }))
      setRows((rs) => rs.map((r) => (r.id === e.id ? data : r)))
    }
    showToast(t('list.changed', { f: t(`field.${col.key}`) }))
  }

  async function openPhoto(path) {
    const w = window.open('', '_blank')
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 300)
    if (error || !data) { w?.close(); return showToast(t('list.noPhoto')) }
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
      if (!all.length) return showToast(t('list.nothingToExport'))
      const { exportLabels } = await import('./lib/excel.js')
      await exportLabels(all.map((r) => ({ ...r, door: who(r, people, isCustomer), scanned_by_email: isCustomer ? null : r.scanned_by_email })), lang)
    } catch (e) {
      showToast(t('list.exportFailed', { msg: e.message || e }))
    } finally {
      setExporting(false)
    }
  }

  const colCount = COLUMNS.length + 1 + (canToggle ? 1 : 0)

  return (
    <section className="list">
      <div className="listhead">
        <h2>{t('list.title')} {total != null && <span className="count">{total}</span>}</h2>
        <div className="list-tools">
          <input id="search" type="search" placeholder={t('list.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <button onClick={() => setShowFilters((v) => !v)} aria-pressed={showFilters}>
            {showFilters ? t('list.hideFilters') : t('list.filters')}
          </button>
          {isEditor && <button onClick={() => setImporting(true)}>{t('list.import')}</button>}
          <button className="primary" onClick={doExport} disabled={exporting || !total}>
            {exporting ? t('list.busy') : filtered ? t('list.excelFiltered') : t('list.excel')}
          </button>
        </div>
      </div>

      {isCustomer && (
        <p className="hint">{t('list.customerHint')}</p>
      )}
      {importing && (
        <ImportNotes
          onClose={() => setImporting(false)}
          onDone={(msg) => { setImporting(false); showToast(msg); load(0) }}
        />
      )}

      {canToggle && selected.size > 0 && (
        <div className="selbar" role="region" aria-label="Selectie">
          <span>{t('list.selected', { n: selected.size })}</span>
          {!confirming && (
            <>
              <button onClick={() => setActive([...selected], true)} disabled={settingActive}>{t('list.setActive')}</button>
              <button onClick={() => setActive([...selected], false)} disabled={settingActive}>{t('list.setInactive')}</button>
            </>
          )}
          {!isEditor ? (
            <button onClick={() => setSelected(new Set())}>{t('list.clearSel')}</button>
          ) : confirming ? (
            <>
              <span className="selbar-q">{t('list.confirmDelete')}</span>
              <button className="danger-fill" onClick={deleteSelected} disabled={deleting}>{deleting ? t('list.deleting') : t('list.yesDelete')}</button>
              <button onClick={() => setConfirming(false)} disabled={deleting}>{t('common.cancel')}</button>
            </>
          ) : (
            <>
              <button className="danger-fill" onClick={() => setConfirming(true)}>{t('list.delete')}</button>
              <button onClick={() => setSelected(new Set())}>{t('list.clearSel')}</button>
            </>
          )}
        </div>
      )}

      {isEditor && <p className="hint">{t('list.editHint')}</p>}

      <div className="topscroll" ref={topRef} hidden={!overflow} aria-hidden="true" onScroll={(e) => syncFrom(e.currentTarget, boxRef.current)}>
        <div style={{ width: scrollW, height: 1 }} />
      </div>
      <div className="tablebox" ref={boxRef} onScroll={(e) => syncFrom(e.currentTarget, topRef.current)}>
        <table className={isEditor || isCustomer ? 'editable' : undefined}>
          <thead>
            <tr>
              {canToggle && (
                <th className="chk">
                  <input type="checkbox" id="select-all" aria-label={t('list.selectAll')} checked={allChecked} onChange={toggleAll} />
                </th>
              )}
              {COLUMNS.map((c) => <th key={c.key}>{t(`field.${c.key}`)}</th>)}
              <th></th>
            </tr>
            {showFilters && (
              <tr className="filters">
                {canToggle && <th />}
                {COLUMNS.map((c) => (
                  <th key={c.key}>
                    {c.type === 'bool' ? (
                      <select id={`filter-${c.key}`} aria-label={`Filter ${t(`field.${c.key}`)}`} value={filters[c.key] || ''} onChange={(e) => setFilter(c.key, e.target.value)}>
                        <option value="">{t('list.all')}</option>
                        <option value="ja">{t('common.yes').toLowerCase()}</option>
                        <option value="nee">{t('common.no').toLowerCase()}</option>
                      </select>
                    ) : (
                    <input
                      id={`filter-${c.key}`}
                      aria-label={`Filter ${t(`field.${c.key}`)}`}
                      value={filters[c.key] || ''}
                      onChange={(e) => setFilter(c.key, e.target.value)}
                      placeholder={c.type === 'date' || c.type === 'stamp' ? t('field.datePlaceholder') : c.type === 'qty' ? '=' : t('list.contains')}
                      inputMode={c.type === 'qty' ? 'decimal' : undefined}
                    />
                    )}
                  </th>
                ))}
                <th>
                  {Object.values(filters).some(Boolean) && (
                    <button className="link" onClick={() => setFilters({})}>{t('list.clear')}</button>
                  )}
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty">
                  {loading ? t('common.loading') : filtered ? t('list.emptyFiltered') : t('list.empty')}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={[selected.has(r.id) && 'sel', r.actief === false && 'inactive'].filter(Boolean).join(' ') || undefined}>
                {canToggle && (
                  <td className="chk">
                    <input type="checkbox" id={`sel-${r.id}`} aria-label={t('list.selectRow')} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                {COLUMNS.map((c) => {
                  const isEdit = editing?.id === r.id && editing.key === c.key
                  return (
                    <td
                      key={c.key}
                      className={canEditCol(c) ? 'cell-edit' : undefined}
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
                      ) : c.type === 'bool' ? (
                        canToggle ? (
                          <button
                            className={`toggle ${r.actief ? 'on' : 'off'}`}
                            role="switch"
                            aria-checked={!!r.actief}
                            aria-label={`${t('field.actief')}: ${r.actief ? t('common.yes') : t('common.no')}`}
                            disabled={settingActive}
                            onClick={(e) => { e.stopPropagation(); setActive([r.id], !r.actief) }}
                          >
                            {r.actief ? t('common.yes') : t('common.no')}
                          </button>
                        ) : (r.actief ? t('common.yes') : t('common.no'))
                      ) : (
                        display(c, r, people, isCustomer, locale)
                      )}
                    </td>
                  )
                })}
                <td className="row-btns">
                  {r.photo_path && <button onClick={() => openPhoto(r.photo_path)}>{t('list.photo')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button className="more" onClick={() => load(rows.length)} disabled={loading}>
          {loading ? t('common.loading') : t('list.more')}
        </button>
      )}
    </section>
  )
}
