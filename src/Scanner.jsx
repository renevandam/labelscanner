import { useCallback, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import LabelTable from './LabelTable.jsx'
import UsersPanel from './UsersPanel.jsx'
import PasswordPanel from './PasswordPanel.jsx'
import ScanCard from './ScanCard.jsx'
import LocationBar from './LocationBar.jsx'
import CameraSession from './CameraSession.jsx'

export default function Scanner({ session, role }) {
  const isEditor = role === 'editor'
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
    if (!location) showToast('Let op: geen locatie ingesteld. Vul hem in bij de doos of scan eerst de plank.')
    setScans((s) => [...files.map((file) => ({ id: crypto.randomUUID(), file, location })), ...s])
  }

  // Na opslaan één keer herladen, ook als er (via "Alles opslaan") veel tegelijk binnenkomen.
  const reloadTimer = useRef()
  function onScanDone(id, saved) {
    setScans((s) => s.filter((x) => x.id !== id))
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
    showToast(ok === total ? `${ok} opgeslagen` : `${ok} van ${total} opgeslagen; controleer de overige`)
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
    setScans((s) => [{ id: crypto.randomUUID(), file, location }, ...s])
  }

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Labelscanner</h1>
          <p className="sub">Fotografeer een doossticker, controleer de velden, exporteer naar Excel.</p>
        </div>
        <div className="who">
          <span>{session.user.email}{isEditor ? ' · beheerder' : ''}</span>
          {isEditor && <button className="link" onClick={() => setPanel('users')}>Gebruikers</button>}
          <button className="link" onClick={() => setPanel('password')}>Wachtwoord</button>
          <button className="link" onClick={() => supabase.auth.signOut()}>Uitloggen</button>
        </div>
      </header>

      <LocationBar location={location} onChange={setLocation} />

      <div className="actions">
        <button className="scan" onClick={() => setCamera(true)}>Doorlopend fotograferen</button>
        <label className="scan alt">
          <input type="file" id="cam" accept="image/*" capture="environment" multiple onChange={onFiles} />
          Losse foto
        </label>
        <label className="scan alt">
          <input type="file" id="gallery" accept="image/*" multiple onChange={onFiles} />
          Uit galerij kiezen
        </label>
      </div>

      {scans.length > 0 && (
        <section className="queue" aria-live="polite">
          <div className="queue-head">
            <span>{scans.length} te controleren{readyCount < scans.length ? ` · ${scans.length - readyCount} bezig of handmatig` : ''}</span>
            {readyCount > 0 && (
              <button className="primary" onClick={saveAll} disabled={savingAll}>
                {savingAll ? 'Opslaan…' : `Alles opslaan (${readyCount})`}
              </button>
            )}
          </div>
          {scans.map((s) => (
            <ScanCard key={s.id} scan={s} userId={session.user.id} onDone={onScanDone} onToast={showToast} onReady={onReady} onStatus={onStatus} />
          ))}
        </section>
      )}

      <LabelTable isEditor={isEditor} reloadKey={reloadKey} showToast={showToast} />

      {camera && (
        <CameraSession problem={lastProblem} onDismissProblem={() => setLastProblem(null)} location={location} onLocation={setLocation} onCapture={onCapture} onClose={() => { setCamera(false); setLastProblem(null) }} />
      )}

      {panel === 'users' && <UsersPanel me={session.user.id} onClose={() => setPanel(null)} />}
      {panel === 'password' && <PasswordPanel onClose={() => setPanel(null)} onToast={showToast} />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
