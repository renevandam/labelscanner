import { useEffect, useRef, useState } from 'react'
import { supabase, PHOTO_BUCKET } from './lib/supabase.js'
import { FIELDS, emptyLabel, toRow } from './lib/labels.js'
import { shrinkImage, blobToBase64 } from './lib/image.js'

// Max. 3 labels tegelijk laten uitlezen; de rest wacht netjes op zijn beurt.
let active = 0
const waiting = []
async function limited(fn) {
  if (active >= 3) await new Promise((r) => waiting.push(r))
  active++
  try { return await fn() } finally { active--; waiting.shift()?.() }
}

function readError(body) {
  switch (body?.error) {
    case 'missing_api_key':
    case 'bad_api_key':
      return 'API-sleutel in Supabase ontbreekt of klopt niet'
    case 'not_a_member':
      return 'Je account mag geen labels laten uitlezen'
    case 'model_error':
      if (body.status === 401 || body.status === 403) return 'API-sleutel wordt geweigerd door Anthropic'
      if (body.status === 429 || body.status === 529) return 'Claude is even druk, probeer het zo opnieuw'
      if (body.status === 400) return 'Anthropic weigert het verzoek (tegoed of model controleren)'
      return 'Claude gaf een fout'
    case 'model_unreachable':
      return 'Claude is niet bereikbaar'
    default:
      return 'Automatisch lezen mislukt'
  }
}

// Eén gescande foto: verkleinen → uploaden + laten uitlezen → controleren → opslaan.
export default function ScanCard({ scan, userId, onDone, onToast, onReady, onStatus }) {
  const [state, setState] = useState('busy') // busy | ready | error
  const [message, setMessage] = useState('Label lezen')
  const [form, setForm] = useState(() => ({ ...emptyLabel(), locatie: scan.location || '' }))
  const [preview, setPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [dupe, setDupe] = useState(null)
  const [doubt, setDoubt] = useState(() => new Set())
  const photoPath = useRef(null)
  const processed = useRef(null)
  // De foto van deze kaart; wordt vervangen bij "Opnieuw fotograferen".
  const [file, setFile] = useState(scan.file)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (processed.current === file) return
    processed.current = file
    ;(async () => {
      let blob
      try {
        blob = await shrinkImage(file)
      } catch {
        setState('error')
        setMessage('Dit bestand is geen leesbare foto')
        return
      }
      const path = `${userId}/${crypto.randomUUID()}.jpg`
      const upload = supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg' })
        .then(({ error }) => { if (!error) photoPath.current = path })

      const image = await blobToBase64(blob)
      const read = limited(() => supabase.functions.invoke('read-label', { body: { image, mediaType: 'image/jpeg' } }))
        .then(async ({ data, error }) => {
          if (error) {
            let body = null
            try { body = await error.context?.json() } catch { /* geen json */ }
            throw new Error(readError(body))
          }
          if (!data?.fields) throw new Error('Automatisch lezen mislukt')
          const f = emptyLabel()
          for (const k of Object.keys(f)) f[k] = data.fields[k] == null ? '' : String(data.fields[k])
          // Locatie komt van de plank-scan, niet van de sticker; eventuele handmatige wijziging blijft staan.
          setForm((prev) => ({ ...f, locatie: prev.locatie }))
          setDoubt(new Set(Array.isArray(data.twijfel) ? data.twijfel : []))
          return { fields: f, status: data.status, reden: data.reden || '', twijfel: data.twijfel || [] }
        })
        .catch((e) => ({ failed: e.message || 'Automatisch lezen mislukt' }))

      // Pas klaar als foto én uitlezen klaar zijn, zodat opslaan altijd de foto meeneemt.
      const [, result] = await Promise.all([upload, read])
      const res = result?.failed ? null : result
      const fields = res?.fields
      const filled = fields && ['project', 'intern_order', 'unit'].some((k) => fields[k])
      let kind, msg
      if (!res) {
        kind = 'error'; msg = `${result?.failed || 'Automatisch lezen mislukt'}. Vul de velden zelf in.`
      } else if (res.status === 'ander_label') {
        kind = 'wrong'; msg = `Verkeerd label: ${res.reden || 'dit is geen TKE/SLS-doossticker'}.`
      } else if (res.status === 'onleesbaar' || !filled) {
        kind = 'error'; msg = `Niet leesbaar${res.reden ? ': ' + res.reden : ''}. Maak een nieuwe foto of vul zelf in.`
      } else if (res.twijfel.length) {
        kind = 'check'; msg = 'Gelezen, maar controleer de oranje velden.'
      } else {
        kind = 'ready'; msg = 'Gelezen. Controleer de velden en sla op.'
      }
      setState(kind)
      setMessage(msg)
      onStatus?.(scan.id, kind, msg)
      if (fields?.unit) checkDupe(fields.unit)
    })()
  }, [file, userId]) // eslint-disable-line react-hooks/exhaustive-deps -- bewust één keer per foto

  // Nieuwe foto voor dezelfde kaart: oude foto weg, opnieuw uitlezen. Locatie blijft staan.
  function retake(e) {
    const next = e.target.files?.[0]
    e.target.value = ''
    if (!next) return
    const old = photoPath.current
    photoPath.current = null
    if (old) supabase.storage.from(PHOTO_BUCKET).remove([old])
    setDupe(null)
    setDoubt(new Set())
    setState('busy')
    setMessage('Nieuwe foto lezen')
    setFile(next)
  }

  // Meld bruikbare kaarten aan bij "Alles opslaan"; altijd met de laatste formulierwaarden.
  const saveRef = useRef(null)
  saveRef.current = () => save(true)
  useEffect(() => {
    if (state !== 'ready') return
    onReady(scan.id, () => saveRef.current())
    return () => onReady(scan.id, null)
  }, [state, scan.id, onReady])

  async function checkDupe(unit) {
    const u = unit.trim()
    if (!u) return setDupe(null)
    const { data } = await supabase.from('labels').select('id, created_at').eq('unit', u).limit(1)
    setDupe(data?.[0] ?? null)
  }

  // Geeft true terug als de regel is opgeslagen. silent: geen eigen melding (bij "Alles opslaan").
  async function save(silent = false) {
    const { row, error } = toRow(form)
    if (error) {
      if (!silent) onToast(error)
      else { setState('error'); setMessage(error) }
      return false
    }
    setSaving(true)
    const { error: dbErr } = await supabase.from('labels').insert({ ...row, photo_path: photoPath.current, operator: scan.operator || null })
    setSaving(false)
    if (dbErr) {
      if (!silent) onToast('Opslaan mislukt: ' + dbErr.message)
      else { setState('error'); setMessage('Opslaan mislukt: ' + dbErr.message) }
      return false
    }
    if (!silent) onToast('Opgeslagen')
    onDone(scan.id, true)
    return true
  }

  async function discard() {
    if (photoPath.current) await supabase.storage.from(PHOTO_BUCKET).remove([photoPath.current])
    onDone(scan.id, false)
  }

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (doubt.has(k)) setDoubt((d) => { const n = new Set(d); n.delete(k); return n })
  }

  return (
    <article className={`card ${state}`}>
      {preview && <img src={preview} alt="Foto van het label" />}
      <div className="card-body">
        <div className={`state ${state === 'busy' ? 'busy' : state === 'ready' ? 'ok' : state === 'check' ? 'warn' : 'err'}`}>{message}</div>
        {state !== 'busy' && (
          <>
            <div className="fields">
              {FIELDS.map((f) => (
                <label key={f.key} className={doubt.has(f.key) ? 'doubt' : undefined}>
                  {f.label}
                  <input
                    className={doubt.has(f.key) ? 'doubt' : undefined}
                    id={`${scan.id}-${f.key}`}
                    value={form[f.key]}
                    onChange={set(f.key)}
                    onBlur={f.key === 'unit' ? (e) => checkDupe(e.target.value) : undefined}
                    inputMode={f.type === 'qty' ? 'decimal' : undefined}
                    placeholder={f.type === 'date' ? 'd-m-jjjj' : ''}
                    autoComplete="off"
                  />
                </label>
              ))}
            </div>
            {dupe && (
              <p className="warn">
                Unit# {form.unit} staat al in de lijst (gescand {new Date(dupe.created_at).toLocaleDateString('nl-NL')}). Opslaan maakt een tweede regel.
              </p>
            )}
            <div className="row-actions">
              <label className={`btn retake ${state === 'error' || state === 'wrong' ? 'urgent' : ''}`}>
                <input type="file" id={`${scan.id}-retake`} accept="image/*" capture="environment" onChange={retake} disabled={saving} />
                Opnieuw fotograferen
              </label>
              {state === 'wrong' ? (
                <>
                  <button className="primary" onClick={discard} disabled={saving}>Weggooien</button>
                  <button onClick={() => save(false)} disabled={saving}>Toch opslaan</button>
                </>
              ) : (
                <>
                  <button className="primary" onClick={() => save(false)} disabled={saving}>{saving ? 'Opslaan…' : 'Opslaan in lijst'}</button>
                  <button onClick={discard} disabled={saving}>Weggooien</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  )
}
