import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './Login.jsx'
import Scanner from './Scanner.jsx'
import { useLang } from './lib/i18n.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Boot />
  if (!session) return <Login />
  return <Member session={session} />
}

// Haalt de rol op (scanner, beheerder of klant); wie geen lid is krijgt een duidelijke melding.
function Boot() {
  const { t } = useLang()
  return <div className="boot">{t('common.loading')}</div>
}

function Member({ session }) {
  const { t } = useLang()
  const [role, setRole] = useState(undefined)
  const [name, setName] = useState('')
  useEffect(() => {
    supabase
      .from('label_members')
      .select('role, name')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (data) {
          setRole(data.role)
          setName(data.name || '')
          return
        }
        // Geen medewerker? Kijk of het een klant is (alleen lezen).
        const { data: c } = await supabase.from('label_customers').select('name').eq('user_id', session.user.id).maybeSingle()
        setRole(c ? 'customer' : null)
        setName(c?.name || '')
      })
  }, [session.user.id])

  if (role === undefined) return <Boot />
  if (role === null)
    return (
      <main className="login">
        <div className="login-card">
          <h1>{t('access.title')}</h1>
          <p className="sub">{t('access.body', { email: session.user.email })}</p>
          <button onClick={() => supabase.auth.signOut()}>{t('common.logout')}</button>
        </div>
      </main>
    )
  return <Scanner session={session} role={role} name={name} />
}
