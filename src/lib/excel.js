import writeXlsxFile from 'write-excel-file'
import { FIELDS } from './labels.js'
import { translate } from './i18n.jsx'

export async function exportLabels(rows, lang = 'nl') {
  const t = (k) => translate(lang, k)
  const schema = [
    // Echte TRUE/FALSE-cel (Nederlandse Excel toont WAAR/ONWAAR)
    { column: t('field.actief'), type: Boolean, width: 8, value: (r) => r.actief !== false },
    ...FIELDS.map((f) => {
      if (f.type === 'date')
        return { column: t(`field.${f.key}`), type: Date, format: 'd-m-yyyy', width: 11, value: (r) => (r[f.key] ? new Date(r[f.key] + 'T00:00:00Z') : undefined) }
      if (f.type === 'qty')
        return { column: t(`field.${f.key}`), type: Number, width: 8, value: (r) => (r[f.key] ?? undefined) }
      return { column: t(`field.${f.key}`), type: String, width: f.key === 'notitie' ? 22 : 15, value: (r) => r[f.key] ?? undefined }
    }),
    { column: t('field.klant_notitie'), type: String, width: 30, value: (r) => r.klant_notitie ?? undefined },
    { column: t('xls.scannedAt'), type: Date, format: 'd-m-yyyy hh:mm', width: 17, value: (r) => new Date(r.created_at) },
    { column: t('xls.scannedBy'), type: String, width: 24, value: (r) => r.door || r.scanned_by_email || undefined },
    // Nodig om klantnotities later weer in te lezen; niet aanpassen.
    { column: 'ID', type: String, width: 38, value: (r) => r.id },
  ]
  const name = `labels-${new Date().toISOString().slice(0, 10)}.xlsx`
  await writeXlsxFile(rows, { schema, fileName: name, sheet: 'Labels', stickyRowsCount: 1, fontFamily: 'Calibri', fontSize: 11 })
}
