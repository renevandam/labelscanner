-- Al toegepast op 2026-10-16. Alleen voor de Edge Function manage-members (service_role).
create or replace function public.label_members_list()
returns table (user_id uuid, email text, role text, added_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.added_at, u.last_sign_in_at
  from public.label_members m join auth.users u on u.id = m.user_id
  order by lower(u.email);
$$;
revoke execute on function public.label_members_list() from public, anon, authenticated;
grant execute on function public.label_members_list() to service_role;

create or replace function public.label_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke execute on function public.label_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.label_user_id_by_email(text) to service_role;
