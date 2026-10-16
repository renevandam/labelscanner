import { useState } from 'react'
import { supabase } from './lib/supabase.js'
import { useLang } from './lib/i18n.jsx'

// Eigen wachtwoord wijzigen, bv. na een tijdelijk wachtwoord van de beheerder.
export default function PasswordPanel({ onClose, onToast }) {
  const { t } = useLang()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (pw.length < 8) return setError(t('pw.short'))
    if (pw !== pw2) return setError(t('pw.mismatch'))
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setError(error.message)
    onToast(t('pw.changed'))
    onClose()
  }

  return (
    <div className="panel-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="panel narrow" role="dialog" aria-modal="true" aria-labelledby="pw-title" onSubmit={submit}>
        <div className="panel-head">
          <h2 id="pw-title">{t('pw.title')}</h2>
          <button type="button" onClick={onClose}>{t('common.close')}</button>
        </div>
        <label className="field">
          {t('pw.new')}
          <input id="pw-new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="field">
          {t('pw.repeat')}
          <input id="pw-repeat" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
      </form>
    </div>
  )
}
