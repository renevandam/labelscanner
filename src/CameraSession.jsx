import { useEffect, useRef, useState } from 'react'
import { openCamera, watchForBarcode, cameraError } from './lib/barcode.js'
import { useLang } from './lib/i18n.jsx'

// Doorlopende camera: elke tik op de knop is een foto, de camera blijft open.
// "Andere plank" schakelt hetzelfde beeld tijdelijk naar barcode-scannen.
export default function CameraSession({ location, onLocation, onCapture, onClose, problem, onDismissProblem, saved = 0, pending = 0 }) {
  const { t } = useLang()
  const video = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState(location ? 'photo' : 'barcode')
  const [count, setCount] = useState(0)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    let stream
    let cancelled = false
    ;(async () => {
      try {
        stream = await openCamera()
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        video.current.srcObject = stream
        await video.current.play()
        setReady(true)
      } catch (e) {
        setError(cameraError(e))
      }
    })()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  useEffect(() => {
    if (!ready || mode !== 'barcode') return
    return watchForBarcode(video.current, (code) => {
      onLocation(code)
      setMode('photo')
    })
  }, [ready, mode, onLocation])

  function shoot() {
    const v = video.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    c.toBlob((blob) => {
      if (!blob) return
      onCapture(new File([blob], `label-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      setCount((n) => n + 1)
    }, 'image/jpeg', 0.9)
    setFlash(true)
    setTimeout(() => setFlash(false), 120)
    try { navigator.vibrate?.(30) } catch { /* niet ondersteund */ }
  }

  return (
    <div className="session" role="dialog" aria-modal="true" aria-label={t('cam.title')}>
      <div className="session-top">
        <div>
          <div className="loc-label">{t('loc.label')}</div>
          <div className="session-loc">{location || t('loc.notSet')}</div>
        </div>
        <button onClick={() => setMode(mode === 'barcode' ? 'photo' : 'barcode')}>
          {mode === 'barcode' ? t('cam.cancelShelf') : t('cam.otherShelf')}
        </button>
      </div>

      <div className="session-view">
        <video ref={video} playsInline muted />
        {ready && mode === 'barcode' && <div className="aim" aria-hidden="true" />}
        {flash && <div className="flash" aria-hidden="true" />}
        {problem && (
          <div className={`session-problem ${problem.kind}`} role="alert">
            <span>{problem.msg}</span>
            <button onClick={onDismissProblem}>OK</button>
          </div>
        )}
        <p className="session-hint">
          {error ? t(error) : !ready ? t('cam.starting') : mode === 'barcode' ? t('cam.aimShelf') : t('cam.aimLabel')}
        </p>
      </div>

      <div className="session-bottom">
        <div className="session-count">
          <b>{count}</b> {t('cam.photos', { n: count }).replace(/^\d+\s*/, '')}
          <small>{t('cam.savedPending', { s: saved })}{pending ? t('cam.pending', { n: pending }) : ''}</small>
        </div>
        <button
          className="shutter"
          onClick={shoot}
          disabled={!ready || mode !== 'photo'}
          aria-label={t('cam.shoot')}
        />
        <button className="done" onClick={onClose}>{t('common.done')}</button>
      </div>
    </div>
  )
}
