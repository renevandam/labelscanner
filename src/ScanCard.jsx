import { useEffect, useRef, useState } from 'react'
import { supabase, PHOTO_BUCKET } from './lib/supabase.js'
import { FIELDS, emptyLabel, toRow } from './lib/labels.js'
import { shrinkImage, blobToBase64 } from './lib/image.js'

// Eén gescande foto: verkleinen → uploaden + laten uitlezen → controleren → opslaan.
export default function ScanCard({ scan, userId, onDone, onToast }) {
  const [state, setState] = useState('busy') // busy | ready | error
  const [message, setMessage] = useState('Label lezen')
  const [form, setForm] = useState(emptyLabel)
  const [preview, setPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [dupe, setDupe] = useState(null)
  const photoPath = useRef(null)
  const started = useRef(false)

  useEffect(() => {
    const url = URL.createObjectURL(scan.file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [scan.file])

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      let blob
      try {
        blob = await shrinkImage(scan.file)
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

      const read = supabase.functions
        .invoke('read-label', { body: { image: await blobToBase64(blob), mediaType: 'image/jpeg' } })
        .then(({ data, error }) => {
          if (error || !data?.fields) throw error || new Error('leeg antwoord')
          const f = emptyLabel()
          for (const k of Object.keys(f)) f[k] = data.fields[k] == null ? '' : String(data.fields[k])
          setForm(f)
          const filled = FIELDS.some((x) => f[x.key])
          setState('ready')
          setMessage(filled ? 'Gelezen. Controleer de velden en sla op.' : 'Niets herkend. Vul de velden zelf in.')
          return f
        })
        .catch(() => {
          setState('error')
          setMessage('Automatisch lezen mislukt. Vul de velden zelf in.')
          return null
        })

      const [, fields] = await Promise.all([upload, read])
      if (fields?.unit) checkDupe(fields.unit)
    })()
  }, [scan.file, userId])

  async function checkDupe(unit) {
    const u = unit.trim()
    if (!u) return setDupe(null)
    const { data } = await supabase.from('labels').select('id, created_at').eq('unit', u).limit(1)
    setDupe(data?.[0] ?? null)
  }

  async function save() {
    const { row, error } = toRow(form)
    if (error) return onToast(error)
    setSaving(true)
    const { error: dbErr } = await supabase.from('labels').insert({ ...row, photo_path: photoPath.current })
    setSaving(false)
    if (dbErr) return onToast('Opslaan mislukt: ' + dbErr.message)
    onToast('Opgeslagen')
    onDone(scan.id, true)
  }

  async function discard() {
    if (photoPath.current) await supabase.storage.from(PHOTO_BUCKET).remove([photoPath.current])
    onDone(scan.id, false)
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <article className="card">
      {preview && <img src={preview} alt="Foto van het label" />}
      <div className="card-body">
        <div className={`state ${state === 'busy' ? 'busy' : state === 'error' ? 'err' : 'ok'}`}>{message}</div>
        {state !== 'busy' && (
          <>
            <div className="fields">
              {FIELDS.map((f) => (
                <label key={f.key}>
                  {f.label}
                  <input
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
              <button className="primary" onClick={save} disabled={saving}>{saving ? 'Opslaan…' : 'Opslaan in lijst'}</button>
              <button onClick={discard} disabled={saving}>Weggooien</button>
            </div>
          </>
        )}
      </div>
    </article>
  )
}
