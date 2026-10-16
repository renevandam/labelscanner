-- Al toegepast op 2026-10-16.
alter table public.label_members add column name text check (name is null or char_length(name) between 1 and 60);

create policy "leden zien elkaar" on public.label_members
  for select to authenticated using ((select public.is_label_member()));

-- Vervangt label_members_list() (die blijft bestaan maar wordt niet meer gebruikt).
create function public.label_members_overview()
returns table (user_id uuid, email text, name text, role text, added_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.name, m.role, m.added_at, u.last_sign_in_at
  from public.label_members m join auth.users u on u.id = m.user_id
  order by lower(coalesce(m.name, u.email));
$$;
revoke execute on function public.label_members_overview() from public, anon, authenticated;
grant execute on function public.label_members_overview() to service_role;
