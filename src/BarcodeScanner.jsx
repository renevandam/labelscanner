import { useEffect, useRef, useState } from 'react'
import { openCamera, watchForBarcode, cameraError } from './lib/barcode.js'
import { useLang } from './lib/i18n.jsx'

// Live camerabeeld dat stopt zodra er een barcode is gevonden.
export default function BarcodeScanner({ onResult, onClose }) {
  const { t } = useLang()
  const video = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stream
    let stopWatch = () => {}
    let cancelled = false
    ;(async () => {
      try {
        stream = await openCamera(1280, 720)
        if (cancelled) return stream.getTracks().forEach((tr) => tr.stop())
        video.current.srcObject = stream
        await video.current.play()
        setReady(true)
        stopWatch = watchForBarcode(video.current, onResult)
      } catch (e) {
        setError(cameraError(e))
      }
    })()
    return () => {
      cancelled = true
      stopWatch()
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [onResult])

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t('cam.shelfTitle')}>
      <div className="scanner-inner">
        <div className="viewfinder">
          <video ref={video} playsInline muted />
          {ready && <div className="aim" aria-hidden="true" />}
        </div>
        <p className="scanner-msg">{error ? t(error) + t('cam.typeInstead') : ready ? t('cam.aimShelf') : t('cam.starting')}</p>
        <button onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  )
}
