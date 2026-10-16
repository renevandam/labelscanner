import { useEffect, useState } from 'react'
import { supabase, PHOTO_BUCKET } from './lib/supabase.js'
import { useLang } from './lib/i18n.jsx'
import { formatNlDate } from './lib/labels.js'

// Compact overzicht voor scanners: hun laatste scans van vandaag (max 15) met foto.
// Eén query voor de regels en één voor alle foto-links samen.
export default function RecentScans({ operator, reloadKey }) {
  const { t, locale } = useLang()
  const [rows, setRows] = useState(null)
  const [urls, setUrls] = useState({})
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let cancelled = false
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    let q = supabase
      .from('labels')
      .select('id, locatie, unit, project, intern_order, datum, doos, notitie, photo_path, created_at')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: false })
      .limit(15)
    if (operator) q = q.eq('operator', operator)
    q.then(async ({ data }) => {
      if (cancelled) return
      const list = data || []
      setRows(list)
      const paths = list.map((r) => r.photo_path).filter(Boolean)
      if (!paths.length) return
      const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)
      if (cancelled || !signed) return
      setUrls(Object.fromEntries(signed.filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl])))
    })
    return () => { cancelled = true }
  }, [operator, reloadKey])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <section className="recent">
      <h2>{t('recent.title')} <span className="count">{t('recent.today')}</span></h2>
      {rows === null ? (
        <p className="hint">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="hint">{t('recent.empty')}</p>
      ) : (
        <ul>
          {rows.map((r) => {
            const url = r.photo_path && urls[r.photo_path]
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="r-thumb"
                  onClick={() => url && setOpen(r)}
                  disabled={!url}
                  aria-label={t('list.photo')}
                >
                  {url ? <img src={url} alt="" loading="lazy" /> : <span aria-hidden="true">—</span>}
                </button>
                <span className="r-main">
                  <span className="r-unit">{r.unit || r.project || '—'}</span>
                  <span className="r-sub">
                    {new Date(r.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    {r.locatie ? ` · ${r.locatie}` : ''}
                    {r.doos != null ? ` · ${t('field.doos')} ${r.doos}` : ''}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={t('list.photo')} onClick={() => setOpen(null)}>
          <img src={urls[open.photo_path]} alt={t('scan.photoAlt')} />
          <div className="lightbox-info" onClick={(e) => e.stopPropagation()}>
            <dl>
              {['locatie', 'project', 'intern_order', 'unit'].map((k) => open[k] && (
                <div key={k}><dt>{t(`field.${k}`)}</dt><dd>{open[k]}</dd></div>
              ))}
              {open.datum && <div><dt>{t('field.datum')}</dt><dd>{formatNlDate(open.datum)}</dd></div>}
              {open.doos != null && <div><dt>{t('field.doos')}</dt><dd>{open.doos}</dd></div>}
              {open.notitie && <div><dt>{t('field.notitie')}</dt><dd>{open.notitie}</dd></div>}
            </dl>
            <button className="primary" onClick={() => setOpen(null)}>{t('common.close')}</button>
          </div>
        </div>
      )}
    </section>
  )
}
