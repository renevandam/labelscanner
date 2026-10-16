// Velden zoals ze op de TKE-sticker staan, in kolomvolgorde voor scherm en Excel.
export const FIELDS = [
  { key: 'locatie', label: 'Locatie', type: 'text' },
  { key: 'project', label: 'Project#', type: 'text' },
  { key: 'intern_order', label: 'Intern order#', type: 'text' },
  { key: 'unit', label: 'Unit#', type: 'text' },
  { key: 'datum', label: 'Datum', type: 'date' },
  { key: 'coordinator', label: 'Coordinator', type: 'text' },
  { key: 'doos', label: 'Doos', type: 'qty' },
  { key: 'lengte', label: 'Lengte', type: 'qty' },
  { key: 'pallet', label: 'Pallet', type: 'qty' },
  { key: 'rol', label: 'Rol', type: 'qty' },
  { key: 'kabel', label: 'Kabel', type: 'qty' },
  { key: 'notitie', label: 'Notitie', type: 'text' },
]

export const emptyLabel = () => Object.fromEntries(FIELDS.map((f) => [f.key, '']))

// "11-4-2024" -> "2024-04-11" (ISO) of null als het geen geldige datum is.
export function parseNlDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (!m) return null
  let [, d, mo, y] = m.map(Number)
  if (y < 100) y += 2000
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

// "2024-04-11" -> "11-4-2024"
export function formatNlDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}-${m}-${y}`
}

export function parseQty(s) {
  const t = String(s ?? '').trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

// Zet formulierwaarden om naar een databaserij; geeft { row } of { error }.
// t: vertaalfunctie (useLang().t) voor de foutmelding.
export function toRow(form, t = (k) => k) {
  const row = {}
  for (const f of FIELDS) {
    const v = String(form[f.key] ?? '').trim()
    if (f.type === 'date') {
      if (v === '') row[f.key] = null
      else {
        const iso = parseNlDate(v)
        if (!iso) return { error: t('err.date', { v }) }
        row[f.key] = iso
      }
    } else if (f.type === 'qty') {
      const n = parseQty(v)
      if (Number.isNaN(n)) return { error: t('err.qty', { f: t(`field.${f.key}`) }) }
      row[f.key] = n
    } else {
      row[f.key] = v === '' ? null : v
    }
  }
  if (!row.unit && !row.project && !row.intern_order) {
    return { error: t('err.keyField') }
  }
  return { row }
}
