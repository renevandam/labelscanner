const FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'qr_code', 'data_matrix']

let detectorPromise = null

// Eén gedeelde detector; de .wasm wordt meegeleverd met de app i.p.v. van een CDN gehaald.
export function getDetector() {
  if (!detectorPromise) {
    detectorPromise = Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ]).then(([{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }]) => {
      prepareZXingModule({ overrides: { locateFile: (p, prefix) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) } })
      return new BarcodeDetector({ formats: FORMATS })
    })
    detectorPromise.catch(() => { detectorPromise = null })
  }
  return detectorPromise
}

// Scant het video-element tot er een barcode is of tot stop() wordt aangeroepen.
export function watchForBarcode(video, onHit) {
  let stopped = false
  let timer
  getDetector().then((detector) => {
    const tick = async () => {
      if (stopped) return
      try {
        const codes = await detector.detect(video)
        const hit = codes.find((c) => c.rawValue?.trim())
        if (hit && !stopped) {
          stopped = true
          try { navigator.vibrate?.(80) } catch { /* niet ondersteund */ }
          onHit(hit.rawValue.trim())
          return
        }
      } catch { /* frame niet bruikbaar */ }
      timer = setTimeout(tick, 150)
    }
    tick()
  })
  return () => { stopped = true; clearTimeout(timer) }
}

export async function openCamera(width = 1920, height = 1080) {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: width }, height: { ideal: height } },
    audio: false,
  })
}

// Geeft een vertaalsleutel terug (zie i18n.jsx).
export function cameraError(e) {
  return e?.name === 'NotAllowedError' ? 'cam.denied' : 'cam.failed'
}
