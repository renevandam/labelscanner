import { useEffect, useRef, useState } from 'react'
import { openCamera, watchForBarcode, cameraError } from './lib/barcode.js'

// Live camerabeeld dat stopt zodra er een barcode is gevonden.
export default function BarcodeScanner({ onResult, onClose }) {
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
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        video.current.srcObject = stream
        await video.current.play()
        setReady(true)
        stopWatch = watchForBarcode(video.current, onResult)
      } catch (e) {
        setError(cameraError(e) + ' Typ de locatie handmatig in.')
      }
    })()
    return () => {
      cancelled = true
      stopWatch()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onResult])

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Locatie scannen">
      <div className="scanner-inner">
        <div className="viewfinder">
          <video ref={video} playsInline muted />
          {ready && <div className="aim" aria-hidden="true" />}
        </div>
        <p className="scanner-msg">{error || (ready ? 'Richt op de barcode van de plank' : 'Camera starten…')}</p>
        <button onClick={onClose}>Annuleren</button>
      </div>
    </div>
  )
}
