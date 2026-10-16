import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { useLang } from './lib/i18n.jsx'

// Compact overzicht voor scanners: hun laatste scans van vandaag (max 15, één kleine query).
export default function RecentScans({ operator, reloadKey }) {
  const { t, locale } = useLang()
  const [rows, setRows] = useState(null)

  useEffect(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    let q = supabase
      .from('labels')
      .select('id, locatie, unit, project, doos, created_at')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: false })
      .limit(15)
    if (operator) q = q.eq('operator', operator)
    q.then(({ data }) => setRows(data || []))
  }, [operator, reloadKey])

  return (
    <section className="recent">
      <h2>{t('recent.title')} <span className="count">{t('recent.today')}</span></h2>
      {rows === null ? (
        <p className="hint">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="hint">{t('recent.empty')}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <span className="r-time">{new Date(r.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="r-unit">{r.unit || r.project || '—'}</span>
              <span className="r-loc">{r.locatie || ''}</span>
              {r.doos != null && <span className="r-qty">{t('field.doos')} {r.doos}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
