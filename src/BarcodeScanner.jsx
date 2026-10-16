import { useEffect, useRef, useState } from 'react'

const FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'qr_code', 'data_matrix']

// Live camerabeeld dat stopt zodra er een barcode is gevonden.
export default function BarcodeScanner({ onResult, onClose }) {
  const video = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stream
    let stopped = false
    let timer

    ;(async () => {
      try {
        const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
          import('barcode-detector/ponyfill'),
          import('zxing-wasm/reader/zxing_reader.wasm?url'),
        ])
        // .wasm meeleveren met de app i.p.v. van een CDN te halen
        prepareZXingModule({ overrides: { locateFile: (p, prefix) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) } })
        const detector = new BarcodeDetector({ formats: FORMATS })
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (stopped) return
        video.current.srcObject = stream
        await video.current.play()
        setReady(true)

        const tick = async () => {
          if (stopped) return
          try {
            const codes = await detector.detect(video.current)
            const hit = codes.find((c) => c.rawValue?.trim())
            if (hit) {
              navigator.vibrate?.(80)
              stopped = true
              onResult(hit.rawValue.trim())
              return
            }
          } catch {
            /* frame niet bruikbaar, volgende proberen */
          }
          timer = setTimeout(tick, 150)
        }
        tick()
      } catch (e) {
        setError(
          e?.name === 'NotAllowedError'
            ? 'Geen toegang tot de camera. Sta camera-toegang toe voor deze site in je browserinstellingen.'
            : 'Camera starten mislukt. Typ de locatie handmatig in.',
        )
      }
    })()

    return () => {
      stopped = true
      clearTimeout(timer)
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
