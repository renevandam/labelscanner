import { useState } from 'react'
import { supabase } from './lib/supabase.js'

export default function Login() {
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
    if (error) setError(error.message === 'Invalid login credentials' ? 'E-mail of wachtwoord klopt niet.' : error.message)
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="login-card">
        <h1>Labelscanner</h1>
        <p className="sub">Log in om doosstickers te scannen.</p>
        <label>
          E-mail
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Wachtwoord
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Inloggen…' : 'Inloggen'}</button>
        <p className="hint">Geen account? Vraag de beheerder om je toe te voegen.</p>
      </form>
    </main>
  )
}
