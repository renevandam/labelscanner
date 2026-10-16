import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { useLang } from './lib/i18n.jsx'

const KNOWN_ERRORS = ['not_an_editor', 'bad_email', 'not_yourself', 'create_failed', 'reset_failed']

async function call(body, t) {
  const { data, error } = await supabase.functions.invoke('manage-members', { body })
  if (error) {
    let info = null
    try { info = await error.context?.json() } catch { /* geen json */ }
    throw new Error(KNOWN_ERRORS.includes(info?.error) ? t(`users.err.${info.error}`) : info?.message || t('common.wrong'))
  }
  return data
}

// Beheerders geven hier mensen toegang, wisselen rollen en zetten een nieuw wachtwoord.
export default function UsersPanel({ me, onClose }) {
  const { t, locale } = useLang()
  const [members, setMembers] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [role, setRole] = useState('scanner')
  const [secret, setSecret] = useState(null) // { email, password }
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [copied, setCopied] = useState(false)

  const run = useCallback(async (body) => {
    setBusy(true)
    setError('')
    try {
      const data = await call(body, t)
      if (data.members) setMembers(data.members)
      return data
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }, [t])

  useEffect(() => { run({ action: 'list' }) }, []) // eslint-disable-line react-hooks/exhaustive-deps -- één keer laden

  async function add(e) {
    e.preventDefault()
    const addr = email.trim()
    const data = await run({ action: 'add', email: addr, role, name: newName })
    if (!data) return
    setEmail('')
    setNewName('')
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
          <h2 id="users-title">{t('users.title')}</h2>
          <button onClick={onClose}>{t('common.close')}</button>
        </div>

        <form className="add-user" onSubmit={add}>
          <label className="name-field">
            {t('users.name')}
            <input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('users.namePh')} maxLength={60} autoComplete="off" />
          </label>
          <label>
            {t('users.email')}
            <input id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('users.emailPh')} autoComplete="off" />
          </label>
          <label>
            {t('users.role')}
            <select id="new-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="scanner">{t('role.scanner')}</option>
              <option value="editor">{t('role.editor')}</option>
              <option value="customer">{t('role.customer')}</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>{t('users.add')}</button>
        </form>
        <p className="hint">{t('users.help')}</p>

        {secret && (
          <div className="secret" role="status">
            <p>
              {secret.isNew ? t('users.created') : t('users.reset')} {t('users.passOnce')}
            </p>
            <div className="secret-box">
              <span>{secret.email}</span>
              <b>{secret.password}</b>
            </div>
            <div className="row-actions">
              <button onClick={copy}>{copied ? t('common.copied') : t('common.copy')}</button>
              <button onClick={() => setSecret(null)}>{t('common.done')}</button>
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="tablebox">
          <table className="users">
            <thead>
              <tr><th>{t('users.name')}</th><th>{t('users.colEmail')}</th><th>{t('users.role')}</th><th>{t('users.lastLogin')}</th><th></th></tr>
            </thead>
            <tbody>
              {members === null && <tr><td colSpan={5} className="empty">{t('common.loading')}</td></tr>}
              {members?.map((m) => {
                const self = m.user_id === me
                return (
                  <tr key={m.user_id}>
                    <td>
                      <input
                        key={m.name || ''}
                        id={`name-${m.user_id}`}
                        className="name-input"
                        aria-label={t('users.nameOf', { email: m.email })}
                        defaultValue={m.name || ''}
                        placeholder={t('users.fillName')}
                        maxLength={60}
                        disabled={busy}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v !== (m.name || '')) run({ action: 'set_name', user_id: m.user_id, name: v })
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      />
                    </td>
                    <td>{m.email}{self && <span className="you"> {t('users.you')}</span>}</td>
                    <td>
                      {self ? t(`role.${m.role}`) : (
                        <select
                          id={`role-${m.user_id}`}
                          aria-label={t('users.roleOf', { email: m.email })}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => run({ action: 'set_role', user_id: m.user_id, role: e.target.value })}
                        >
                          <option value="scanner">{t('role.scanner')}</option>
                          <option value="editor">{t('role.editor')}</option>
                          <option value="customer">{t('role.customer')}</option>
                        </select>
                      )}
                    </td>
                    <td>{m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleDateString(locale) : t('users.never')}</td>
                    <td className="row-btns">
                      <button disabled={busy} onClick={() => resetPassword(m)}>{t('users.newPassword')}</button>
                      {!self && (confirmRemove === m.user_id ? (
                        <>
                          <button className="danger-fill" disabled={busy} onClick={() => { setConfirmRemove(null); run({ action: 'remove', user_id: m.user_id }) }}>{t('users.confirmRevoke')}</button>
                          <button onClick={() => setConfirmRemove(null)}>{t('common.no')}</button>
                        </>
                      ) : (
                        <button className="danger" disabled={busy} onClick={() => setConfirmRemove(m.user_id)}>{t('users.revoke')}</button>
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
