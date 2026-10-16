import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL en VITE_SUPABASE_ANON_KEY ontbreken (zie .env.example)')
}

export const supabase = createClient(url, key)

export const PHOTO_BUCKET = 'label-photos'
