import { useState } from 'react'

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
          <h2 id="op-title">Wie scant er?</h2>
          {onCancel && <button type="button" onClick={onCancel}>Annuleren</button>}
        </div>
        <p className="hint">Je bent ingelogd met het gedeelde account <b>{account}</b>. Vul je eigen naam in; die komt bij elke scan te staan.</p>
        {recent.length > 0 && (
          <div className="chips" aria-label="Eerder gebruikt">
            {recent.map((n) => (
              <button type="button" key={n} className="chip" onClick={() => choose(n)}>{n}</button>
            ))}
          </div>
        )}
        <label className="field">
          Naam operator
          <input id="operator-name" autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} autoComplete="off" placeholder="bv. Gert" />
        </label>
        <button className="primary" disabled={!value.trim()}>Start scannen</button>
        <button type="button" className="link" onClick={onLogout}>Uitloggen</button>
      </form>
    </div>
  )
}
