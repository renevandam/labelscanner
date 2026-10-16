import { useCallback, useState } from 'react'
import BarcodeScanner from './BarcodeScanner.jsx'
import { useLang } from './lib/i18n.jsx'

// Huidige plaklocatie. Blijft staan tot hij gewijzigd wordt; elke nieuwe scan neemt hem over.
// Werkt ook met een handscanner in toetsenbordmodus: veld focussen, barcode scannen (eindigt op Enter).
export default function LocationBar({ location, onChange }) {
  const { t } = useLang()
  const [scanning, setScanning] = useState(false)
  const [draft, setDraft] = useState(location)
  const [editing, setEditing] = useState(!location)

  const onResult = useCallback((code) => {
    setScanning(false)
    setDraft(code)
    setEditing(false)
    onChange(code)
  }, [onChange])

  function commit(e) {
    e?.preventDefault()
    const v = draft.trim()
    onChange(v)
    setEditing(!v)
  }

  return (
    <section className={`locbar ${location ? 'set' : ''}`}>
      <div className="loc-label">{t('loc.label')}</div>
      {editing ? (
        <form className="loc-edit" onSubmit={commit}>
          <input
            id="locatie"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('loc.placeholder')}
            autoComplete="off"
            autoCapitalize="characters"
          />
          <button type="submit" disabled={!draft.trim()}>{t('common.ok')}</button>
        </form>
      ) : (
        <div className="loc-value">{location}</div>
      )}
      <div className="loc-actions">
        <button className="primary" onClick={() => setScanning(true)}>{t('loc.scan')}</button>
        {!editing && <button onClick={() => { setDraft(location); setEditing(true) }}>{t('loc.change')}</button>}
      </div>
      {scanning && <BarcodeScanner onResult={onResult} onClose={() => setScanning(false)} />}
    </section>
  )
}
