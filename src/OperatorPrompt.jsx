import { useState } from 'react'
import { useLang, LangSwitch } from './lib/i18n.jsx'

const RECENT_KEY = 'labelscanner.recentOperators'

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => typeof x === 'string') } catch { return [] }
}
function saveRecent(name) {
  try {
    const list = [name, ...loadRecent().filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch { /* privé-modus */ }
}

// Gedeeld scanner-account: eerst vragen wie er scant. Die naam gaat mee met elke scan.
export default function OperatorPrompt({ current, account, onSet, onCancel, onLogout }) {
  const { t } = useLang()
  const [value, setValue] = useState(current || '')
  const [recent] = useState(loadRecent)

  function choose(name) {
    const n = name.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (!n) return
    saveRecent(n)
    onSet(n)
  }

  return (
    <div className="panel-backdrop">
      <form
        className="panel narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="op-title"
        onSubmit={(e) => { e.preventDefault(); choose(value) }}
      >
        <div className="panel-head">
          <h2 id="op-title">{t('op.title')}</h2>
          {onCancel ? <button type="button" onClick={onCancel}>{t('common.cancel')}</button> : <LangSwitch />}
        </div>
        <p className="hint">{t('op.body', { account })}</p>
        {recent.length > 0 && (
          <div className="chips" aria-label={t('op.recent')}>
            {recent.map((n) => (
              <button type="button" key={n} className="chip" onClick={() => choose(n)}>{n}</button>
            ))}
          </div>
        )}
        <label className="field">
          {t('op.name')}
          <input id="operator-name" autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} autoComplete="off" placeholder={t('op.placeholder')} />
        </label>
        <button className="primary" disabled={!value.trim()}>{t('op.start')}</button>
        <button type="button" className="link" onClick={onLogout}>{t('common.logout')}</button>
      </form>
    </div>
  )
}
