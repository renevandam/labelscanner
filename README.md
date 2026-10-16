# Labelscanner

Fotografeer TKE-doosstickers; Claude leest Project#, Intern order#, Unit#, Datum, Coordinator en Verpakking uit. Na controle gaat de regel in Supabase en is de lijst als Excel te downloaden.

Stack: React + Vite, Supabase (Postgres, Auth, Storage, Edge Function), Vercel.
Supabase-project: `yoyuwhhkonkggoscpofq` (voorheen Mobilient).

## Eenmalige setup

1. **API-key**: Supabase → Edge Functions → Secrets → `ANTHROPIC_API_KEY`.
   Optioneel `LABEL_MODEL` (standaard `claude-sonnet-5-5`; `claude-haiku-5-5` is goedkoper).
2. **Inschrijven uitzetten**: Authentication → Sign In / Providers → "Allow new users to sign up" uit.
3. **Gebruikers**: beheerders doen dit in de app via **Gebruikers** (toegang geven, rol wisselen, nieuw wachtwoord, toegang intrekken). Handmatig kan ook:
   
   **Gebruiker toevoegen**: Authentication → Users → Add user (e-mail + wachtwoord, "Auto confirm"). Daarna in de SQL editor:
   ```sql
   insert into public.label_members (user_id)
   select id from auth.users where email = 'naam@bedrijf.nl';
   ```
   Alleen accounts in `label_members` kunnen labels zien, opslaan of laten uitlezen.
   Nieuwe leden zijn **scanner** (scannen en lijst bekijken). Beheerder maken (wijzigen en verwijderen):
   ```sql
   update public.label_members set role = 'editor'
   where user_id = (select id from auth.users where email = 'naam@bedrijf.nl');
   ```
4. **Vercel**: importeer deze repo, framework Vite, en zet de env vars uit `.env.example`.

## Lokaal

```
npm install
cp .env.example .env.local
npm run dev
```

Edge Function staat in `supabase/functions/read-label`; deployen met `supabase functions deploy read-label`.
