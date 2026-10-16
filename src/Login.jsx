import { useState } from 'react'
import { supabase } from './lib/supabase.js'
import { useLang, LangSwitch } from './lib/i18n.jsx'

export default function Login() {
  const { t } = useLang()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(error.message === 'Invalid login credentials' ? t('login.bad') : error.message)
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="login-card">
        <div className="login-head">
          <h1>{t('app.name')}</h1>
          <LangSwitch />
        </div>
        <p className="sub">{t('login.sub')}</p>
        <label>
          {t('login.email')}
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t('login.password')}
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? t('login.busy') : t('login.submit')}</button>
        <p className="hint">{t('login.noAccount')}</p>
      </form>
    </main>
  )
}
