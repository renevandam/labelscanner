import { useEffect, useRef, useState } from 'react'
import { supabase, PHOTO_BUCKET } from './lib/supabase.js'
import { FIELDS, emptyLabel, toRow } from './lib/labels.js'
import { shrinkImage, blobToBase64 } from './lib/image.js'
import { useLang } from './lib/i18n.jsx'

// Max. 3 labels tegelijk laten uitlezen; de rest wacht netjes op zijn beurt.
let active = 0
const waiting = []
async function limited(fn) {
  if (active >= 3) await new Promise((r) => waiting.push(r))
  active++
  try { return await fn() } finally { active--; waiting.shift()?.() }
}

// Foutcode van de leesfunctie → vertaalsleutel
function readError(body) {
  switch (body?.error) {
    case 'missing_api_key':
    case 'bad_api_key':
      return 'read.apiKey'
    case 'not_a_member':
      return 'read.notMember'
    case 'model_error':
      if (body.status === 401 || body.status === 403) return 'read.keyRefused'
      if (body.status === 429 || body.status === 529) return 'read.busy'
      if (body.status === 400) return 'read.refused'
      return 'read.modelError'
    case 'model_unreachable':
      return 'read.unreachable'
    default:
      return 'read.failed'
  }
}

// Eén gescande foto: verkleinen → uploaden + laten uitlezen → controleren → opslaan.
export default function ScanCard({ scan, userId, onDone, onToast, onReady, onStatus }) {
  const { t, lang, locale } = useLang()
  const [state, setState] = useState('busy') // busy | ready | check | error | wrong
  const [message, setMessage] = useState(() => t('scan.reading'))
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
        setMessage(t('scan.notImage'))
        return
      }
      const path = `${userId}/${crypto.randomUUID()}.jpg`
      const upload = supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg' })
        .then(({ error }) => { if (!error) photoPath.current = path })

      const image = await blobToBase64(blob)
      const read = limited(() => supabase.functions.invoke('read-label', { body: { image, mediaType: 'image/jpeg', lang } }))
        .then(async ({ data, error }) => {
          if (error) {
            let body = null
            try { body = await error.context?.json() } catch { /* geen json */ }
            throw new Error(readError(body))
          }
          if (!data?.fields) throw new Error('read.failed')
          const f = emptyLabel()
          for (const k of Object.keys(f)) f[k] = data.fields[k] == null ? '' : String(data.fields[k])
          // Locatie komt van de plank-scan, niet van de sticker; eventuele handmatige wijziging blijft staan.
          setForm((prev) => ({ ...f, locatie: prev.locatie }))
          setDoubt(new Set(Array.isArray(data.twijfel) ? data.twijfel : []))
          return { fields: f, status: data.status, reden: data.reden || '', twijfel: data.twijfel || [] }
        })
        .catch((e) => ({ failed: e.message?.startsWith('read.') ? e.message : 'read.failed' }))

      // Pas klaar als foto én uitlezen klaar zijn, zodat opslaan altijd de foto meeneemt.
      const [, result] = await Promise.all([upload, read])
      const res = result?.failed ? null : result
      const fields = res?.fields
      const filled = fields && ['project', 'intern_order', 'unit'].some((k) => fields[k])
      let kind, msg
      if (!res) {
        kind = 'error'; msg = t('scan.readFailed', { why: t(result?.failed || 'read.failed') })
      } else if (res.status === 'ander_label') {
        kind = 'wrong'; msg = t('scan.wrongLabel', { why: res.reden || t('scan.wrongDefault') })
      } else if (res.status === 'onleesbaar' || !filled) {
        kind = 'error'; msg = t('scan.unreadable', { why: res.reden ? ': ' + res.reden : '' })
      } else if (res.twijfel.length) {
        kind = 'check'; msg = t('scan.doubt')
      } else {
        kind = 'ready'; msg = t('scan.ok')
      }
      const found = fields?.unit ? await checkDupe(fields.unit) : null

      // Alles goed gelezen, locatie bekend en geen dubbele Unit#? Dan meteen opslaan.
      if (kind === 'ready') {
        const locatie = (scan.location || '').trim()
        if (!found && locatie) {
          if (await save(true, { ...fields, locatie }, true)) return
          return // save() heeft de fout al op de kaart gezet
        }
        // Niet mee met "Alles opslaan": eerst zelf bekijken.
        kind = 'check'
        msg = found ? t('scan.okDupe') : t('scan.okNoLoc')
      }
      setState(kind)
      setMessage(msg)
      onStatus?.(scan.id, kind, msg)
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
    setMessage(t('scan.readingNew'))
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
    if (!u) { setDupe(null); return null }
    const { data } = await supabase.from('labels').select('id, created_at').eq('unit', u).limit(1)
    const hit = data?.[0] ?? null
    setDupe(hit)
    return hit
  }

  // Geeft true terug als de regel is opgeslagen. silent: geen eigen melding (bij "Alles opslaan").
  // values: optioneel de waarden om op te slaan (bij automatisch opslaan, vóór de state is bijgewerkt).
  async function save(silent = false, values = null, auto = false) {
    const { row, error } = toRow(values || form, t)
    if (error) {
      if (!silent) onToast(error)
      else { setState('error'); setMessage(error) }
      return false
    }
    setSaving(true)
    const { error: dbErr } = await supabase.from('labels').insert({ ...row, photo_path: photoPath.current, operator: scan.operator || null })
    setSaving(false)
    if (dbErr) {
      if (!silent) onToast(t('scan.saveFailed', { msg: dbErr.message }))
      else { setState('error'); setMessage(t('scan.saveFailed', { msg: dbErr.message })) }
      return false
    }
    if (!silent) onToast(t('scan.saved'))
    onDone(scan.id, true, auto)
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
      {preview && <img src={preview} alt={t('scan.photoAlt')} />}
      <div className="card-body">
        <div className={`state ${state === 'busy' ? 'busy' : state === 'ready' ? 'ok' : state === 'check' ? 'warn' : 'err'}`}>{message}</div>
        {state !== 'busy' && (
          <>
            <div className="fields">
              {FIELDS.map((f) => (
                <label key={f.key} className={doubt.has(f.key) ? 'doubt' : undefined}>
                  {t(`field.${f.key}`)}
                  <input
                    className={doubt.has(f.key) ? 'doubt' : undefined}
                    id={`${scan.id}-${f.key}`}
                    value={form[f.key]}
                    onChange={set(f.key)}
                    onBlur={f.key === 'unit' ? (e) => checkDupe(e.target.value) : undefined}
                    inputMode={f.type === 'qty' ? 'decimal' : undefined}
                    placeholder={f.type === 'date' ? t('field.datePlaceholder') : ''}
                    autoComplete="off"
                  />
                </label>
              ))}
            </div>
            {dupe && (
              <p className="warn">
                {t('scan.dupe', { unit: form.unit, date: new Date(dupe.created_at).toLocaleDateString(locale) })}
              </p>
            )}
            <div className="row-actions">
              <label className={`btn retake ${state === 'error' || state === 'wrong' ? 'urgent' : ''}`}>
                <input type="file" id={`${scan.id}-retake`} accept="image/*" capture="environment" onChange={retake} disabled={saving} />
                {t('scan.retake')}
              </label>
              {state === 'wrong' ? (
                <>
                  <button className="primary" onClick={discard} disabled={saving}>{t('scan.discard')}</button>
                  <button onClick={() => save(false)} disabled={saving}>{t('scan.saveAnyway')}</button>
                </>
              ) : (
                <>
                  <button className="primary" onClick={() => save(false)} disabled={saving}>{saving ? t('common.saving') : t('scan.save')}</button>
                  <button onClick={discard} disabled={saving}>{t('scan.discard')}</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  )
}
