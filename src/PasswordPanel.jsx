import { useState } from 'react'
import { supabase } from './lib/supabase.js'

// Eigen wachtwoord wijzigen, bv. na een tijdelijk wachtwoord van de beheerder.
export default function PasswordPanel({ onClose, onToast }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (pw.length < 8) return setError('Gebruik minstens 8 tekens.')
    if (pw !== pw2) return setError('De twee wachtwoorden zijn niet gelijk.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setError(error.message)
    onToast('Wachtwoord gewijzigd')
    onClose()
  }

  return (
    <div className="panel-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="panel narrow" role="dialog" aria-modal="true" aria-labelledby="pw-title" onSubmit={submit}>
        <div className="panel-head">
          <h2 id="pw-title">Wachtwoord wijzigen</h2>
          <button type="button" onClick={onClose}>Sluiten</button>
        </div>
        <label className="field">
          Nieuw wachtwoord
          <input id="pw-new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="field">
          Herhaal wachtwoord
          <input id="pw-repeat" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Opslaan…' : 'Opslaan'}</button>
      </form>
    </div>
  )
}
