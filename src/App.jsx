import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './Login.jsx'
import Scanner from './Scanner.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="boot">Laden…</div>
  if (!session) return <Login />
  return <Scanner session={session} />
}
