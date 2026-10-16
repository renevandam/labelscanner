import { useCallback, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import LabelTable from './LabelTable.jsx'
import UsersPanel from './UsersPanel.jsx'
import PasswordPanel from './PasswordPanel.jsx'
import OperatorPrompt from './OperatorPrompt.jsx'
import ScanCard from './ScanCard.jsx'
import LocationBar from './LocationBar.jsx'
import CameraSession from './CameraSession.jsx'
import RecentScans from './RecentScans.jsx'
import { useLang, LangSwitch } from './lib/i18n.jsx'

export default function Scanner({ session, role, name }) {
  const { t } = useLang()
  const isEditor = role === 'editor'
  // Scanners (gedeeld account) krijgen een eenvoudig scherm: locatie, grote startknop, eigen laatste scans.
  const simple = role === 'scanner'
  const isCustomer = role === 'customer'
  // Scanner-accounts zijn gedeeld: vraag bij het openen wie er scant (geldt tot de app/tab sluit).
  const needsOperator = role === 'scanner'
  const [operator, setOperatorState] = useState(() => {
    try { return sessionStorage.getItem('labelscanner.operator') || '' } catch { return '' }
  })
  const [askOperator, setAskOperator] = useState(false)
  const setOperator = useCallback((v) => {
    setOperatorState(v)
    try { sessionStorage.setItem('labelscanner.operator', v) } catch { /* privé-modus */ }
  }, [])
  const [reloadKey, setReloadKey] = useState(0)
  const [panel, setPanel] = useState(null) // 'users' | 'password'
  const [scans, setScans] = useState([])
  const [toast, setToast] = useState('')
  const toastTimer = useRef()
  const [location, setLocationState] = useState(() => {
    try { return localStorage.getItem('labelscanner.locatie') || '' } catch { return '' }
  })
  const setLocation = useCallback((v) => {
    setLocationState(v)
    try { localStorage.setItem('labelscanner.locatie', v) } catch { /* privé-modus */ }
  }, [])

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3500)
  }, [])

  function onFiles(e) {
    const files = [...e.target.files]
    e.target.value = ''
    if (!location) showToast(t('loc.missingToast'))
    setScans((s) => [...files.map((file) => ({ id: crypto.randomUUID(), file, location, operator })), ...s])
  }

  // Na opslaan één keer herladen, ook als er (via "Alles opslaan") veel tegelijk binnenkomen.
  const reloadTimer = useRef()
  const [autoSaved, setAutoSaved] = useState(0)
  function onScanDone(id, saved, auto) {
    setScans((s) => s.filter((x) => x.id !== id))
    if (auto) setAutoSaved((n) => n + 1)
    if (saved) {
      clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(() => setReloadKey((k) => k + 1), 800)
    }
  }

  const savers = useRef(new Map())
  const [readyCount, setReadyCount] = useState(0)
  const onReady = useCallback((id, fn) => {
    if (fn) savers.current.set(id, fn)
    else savers.current.delete(id)
    setReadyCount(savers.current.size)
  }, [])
  const [savingAll, setSavingAll] = useState(false)
  async function saveAll() {
    setSavingAll(true)
    let ok = 0
    const total = savers.current.size
    for (const fn of [...savers.current.values()]) if (await fn()) ok++
    setSavingAll(false)
    showToast(ok === total ? t('queue.savedAll', { n: ok }) : t('queue.savedSome', { ok, n: total }))
  }

  const [camera, setCamera] = useState(false)
  // Laatste probleem tijdens doorlopend fotograferen, zodat je bij de plank meteen opnieuw kunt fotograferen.
  const [lastProblem, setLastProblem] = useState(null)
  const onStatus = useCallback((id, kind, msg) => {
    if (kind === 'error' || kind === 'wrong') {
      setLastProblem({ id, kind, msg, at: Date.now() })
      try { navigator.vibrate?.([120, 80, 120]) } catch { /* niet ondersteund */ }
    }
  }, [])
  function onCapture(file) {
    setScans((s) => [{ id: crypto.randomUUID(), file, location, operator }, ...s])
  }

  const logout = () => { try { sessionStorage.removeItem('labelscanner.operator') } catch { /* */ } supabase.auth.signOut() }

  return (
    <div className={`wrap${simple ? ' simple' : ''}`}>
      <header className="top">
        <div>
          <h1>{t('app.name')}</h1>
          <p className="sub">{t(isCustomer ? 'top.subCustomer' : simple ? 'top.subScanner' : 'top.subStaff')}</p>
        </div>
        <div className="who">
          {needsOperator && operator && (
            <span className="operator">{t('top.operator')}: <b>{operator}</b> <button className="link" onClick={() => setAskOperator(true)}>{t('top.switch')}</button></span>
          )}
          {!simple && (
            <span title={session.user.email}>{name || session.user.email}{isEditor ? ` · ${t('top.editor')}` : isCustomer ? ` · ${t('top.customer')}` : ''}</span>
          )}
          {isEditor && <button className="link" onClick={() => setPanel('users')}>{t('top.users')}</button>}
          {!simple && <button className="link" onClick={() => setPanel('password')}>{t('top.password')}</button>}
          <LangSwitch />
          <button className="link" onClick={logout}>{t('common.logout')}</button>
        </div>
      </header>

      {!isCustomer && (
        <>
      <LocationBar location={location} onChange={setLocation} />

      <div className={`actions${simple ? ' big' : ''}`}>
        <button className="scan" onClick={() => setCamera(true)}>{simple ? t('act.start') : t('act.continuous')}</button>
        <div className="actions-alt">
          <label className="scan alt">
            <input type="file" id="cam" accept="image/*" capture="environment" multiple onChange={onFiles} />
            {t('act.single')}
          </label>
          {!simple && (
            <label className="scan alt">
              <input type="file" id="gallery" accept="image/*" multiple onChange={onFiles} />
              {t('act.gallery')}
            </label>
          )}
        </div>
      </div>

      {autoSaved > 0 && (
        <p className="autosaved" role="status">
          {t('auto.saved', { n: autoSaved })}
          {scans.length > 0 ? t('auto.check') : ''}
        </p>
      )}

      {scans.length > 0 && (
        <section className="queue" aria-live="polite">
          <div className="queue-head">
            <span>{t('queue.count', { n: scans.length })}{readyCount < scans.length ? t('queue.busy', { n: scans.length - readyCount }) : ''}</span>
            {readyCount > 0 && (
              <button className="primary" onClick={saveAll} disabled={savingAll}>
                {savingAll ? t('common.saving') : t('queue.saveAll', { n: readyCount })}
              </button>
            )}
          </div>
          {scans.map((s) => (
            <ScanCard key={s.id} scan={s} userId={session.user.id} onDone={onScanDone} onToast={showToast} onReady={onReady} onStatus={onStatus} />
          ))}
        </section>
      )}

        </>
      )}

      {simple ? (
        <RecentScans operator={operator} reloadKey={reloadKey} />
      ) : (
        <LabelTable isEditor={isEditor} isCustomer={isCustomer} reloadKey={reloadKey} showToast={showToast} />
      )}

      {camera && (
        <CameraSession saved={autoSaved} pending={scans.length} problem={lastProblem} onDismissProblem={() => setLastProblem(null)} location={location} onLocation={setLocation} onCapture={onCapture} onClose={() => { setCamera(false); setLastProblem(null) }} />
      )}

      {needsOperator && (!operator || askOperator) && (
        <OperatorPrompt
          current={operator}
          account={name || session.user.email}
          onSet={(v) => { setOperator(v); setAskOperator(false) }}
          onCancel={operator ? () => setAskOperator(false) : null}
          onLogout={logout}
        />
      )}

      {panel === 'users' && <UsersPanel me={session.user.id} onClose={() => setPanel(null)} />}
      {panel === 'password' && <PasswordPanel onClose={() => setPanel(null)} onToast={showToast} />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
