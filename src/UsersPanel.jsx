import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'

const ROLE_LABEL = { scanner: 'Scanner', editor: 'Beheerder' }

const ERRORS = {
  not_an_editor: 'Alleen beheerders kunnen gebruikers beheren.',
  bad_email: 'Dit e-mailadres klopt niet.',
  not_yourself: 'Je kunt je eigen rol of toegang niet wijzigen.',
  create_failed: 'Account aanmaken lukte niet.',
  reset_failed: 'Nieuw wachtwoord instellen lukte niet.',
}

async function call(body) {
  const { data, error } = await supabase.functions.invoke('manage-members', { body })
  if (error) {
    let info = null
    try { info = await error.context?.json() } catch { /* geen json */ }
    throw new Error(ERRORS[info?.error] || info?.message || 'Er ging iets mis. Probeer het opnieuw.')
  }
  return data
}

// Beheerders geven hier mensen toegang, wisselen rollen en zetten een nieuw wachtwoord.
export default function UsersPanel({ me, onClose }) {
  const [members, setMembers] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('scanner')
  const [secret, setSecret] = useState(null) // { email, password }
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [copied, setCopied] = useState(false)

  const run = useCallback(async (body) => {
    setBusy(true)
    setError('')
    try {
      const data = await call(body)
      if (data.members) setMembers(data.members)
      return data
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { run({ action: 'list' }) }, [run])

  async function add(e) {
    e.preventDefault()
    const addr = email.trim()
    const data = await run({ action: 'add', email: addr, role })
    if (!data) return
    setEmail('')
    setSecret(data.password ? { email: addr.toLowerCase(), password: data.password, isNew: true } : null)
  }

  async function resetPassword(m) {
    const data = await run({ action: 'reset_password', user_id: m.user_id })
    if (data?.password) setSecret({ email: m.email, password: data.password, isNew: false })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${secret.email}\n${secret.password}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* kopiëren niet toegestaan; tekst staat zichtbaar */ }
  }

  return (
    <div className="panel-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="panel" role="dialog" aria-modal="true" aria-labelledby="users-title">
        <div className="panel-head">
          <h2 id="users-title">Gebruikers</h2>
          <button onClick={onClose}>Sluiten</button>
        </div>

        <form className="add-user" onSubmit={add}>
          <label>
            E-mailadres
            <input id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="naam@bedrijf.nl" autoComplete="off" />
          </label>
          <label>
            Rol
            <select id="new-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="scanner">Scanner</option>
              <option value="editor">Beheerder</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>Toegang geven</button>
        </form>
        <p className="hint">Scanner: scannen en de lijst bekijken. Beheerder: ook wijzigen, verwijderen en gebruikers beheren.</p>

        {secret && (
          <div className="secret" role="status">
            <p>
              {secret.isNew ? 'Account aangemaakt.' : 'Nieuw wachtwoord ingesteld.'} Geef deze gegevens door; het wachtwoord is maar één keer zichtbaar.
            </p>
            <div className="secret-box">
              <span>{secret.email}</span>
              <b>{secret.password}</b>
            </div>
            <div className="row-actions">
              <button onClick={copy}>{copied ? 'Gekopieerd' : 'Kopieer'}</button>
              <button onClick={() => setSecret(null)}>Klaar</button>
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="tablebox">
          <table className="users">
            <thead>
              <tr><th>E-mail</th><th>Rol</th><th>Laatst ingelogd</th><th></th></tr>
            </thead>
            <tbody>
              {members === null && <tr><td colSpan={4} className="empty">Laden…</td></tr>}
              {members?.map((m) => {
                const self = m.user_id === me
                return (
                  <tr key={m.user_id}>
                    <td>{m.email}{self && <span className="you"> (jij)</span>}</td>
                    <td>
                      {self ? ROLE_LABEL[m.role] : (
                        <select
                          id={`role-${m.user_id}`}
                          aria-label={`Rol van ${m.email}`}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => run({ action: 'set_role', user_id: m.user_id, role: e.target.value })}
                        >
                          <option value="scanner">Scanner</option>
                          <option value="editor">Beheerder</option>
                        </select>
                      )}
                    </td>
                    <td>{m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleDateString('nl-NL') : 'nog niet'}</td>
                    <td className="row-btns">
                      <button disabled={busy} onClick={() => resetPassword(m)}>Nieuw wachtwoord</button>
                      {!self && (confirmRemove === m.user_id ? (
                        <>
                          <button className="danger-fill" disabled={busy} onClick={() => { setConfirmRemove(null); run({ action: 'remove', user_id: m.user_id }) }}>Ja, toegang weg</button>
                          <button onClick={() => setConfirmRemove(null)}>Nee</button>
                        </>
                      ) : (
                        <button className="danger" disabled={busy} onClick={() => setConfirmRemove(m.user_id)}>Toegang intrekken</button>
                      ))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
