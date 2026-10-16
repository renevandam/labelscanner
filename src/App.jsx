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
  return <Member session={session} />
}

// Haalt de rol op (scanner of beheerder); wie geen lid is krijgt een duidelijke melding.
function Member({ session }) {
  const [role, setRole] = useState(undefined)
  const [name, setName] = useState('')
  useEffect(() => {
    supabase
      .from('label_members')
      .select('role, name')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setRole(data?.role ?? null)
        setName(data?.name || '')
      })
  }, [session.user.id])

  if (role === undefined) return <div className="boot">Laden…</div>
  if (role === null)
    return (
      <main className="login">
        <div className="login-card">
          <h1>Geen toegang</h1>
          <p className="sub">Je bent ingelogd als {session.user.email}, maar dit account heeft nog geen toegang tot de labelscanner. Vraag de beheerder om je toe te voegen.</p>
          <button onClick={() => supabase.auth.signOut()}>Uitloggen</button>
        </div>
      </main>
    )
  return <Scanner session={session} role={role} name={name} />
}
