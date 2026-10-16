-- Al toegepast op 2026-10-16. Klanten (alleen lezen), klantnotities en import.
create table public.label_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text check (name is null or char_length(name) between 1 and 60),
  added_at timestamptz not null default now()
);
alter table public.label_customers enable row level security;
create policy "klant ziet zichzelf" on public.label_customers
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_label_customer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.label_customers where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_label_customer() from public, anon;
grant execute on function public.is_label_customer() to authenticated;

create policy "klanten lezen" on public.labels for select to authenticated using ((select public.is_label_customer()));
create policy "klanten zien fotos" on storage.objects for select to authenticated
  using (bucket_id = 'label-photos' and (select public.is_label_customer()));
create policy "klanten zien namen medewerkers" on public.label_members
  for select to authenticated using ((select public.is_label_customer()));

alter table public.labels add column klant_notitie text;

create or replace function public.label_import_customer_notes(p_rows jsonb, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_matched int; v_changed int; v_unknown int;
begin
  if not public.is_label_editor() then
    raise exception 'alleen beheerders' using errcode = '42501';
  end if;
  create temporary table _imp on commit drop as
    select distinct on (x.id) x.id, nullif(trim(x.note), '') as note
    from jsonb_to_recordset(p_rows) as x(id uuid, note text)
    where x.id is not null and nullif(trim(x.note), '') is not null;
  select count(*) into v_matched from _imp i join public.labels l on l.id = i.id;
  select count(*) into v_unknown from _imp i where not exists (select 1 from public.labels l where l.id = i.id);
  select count(*) into v_changed from _imp i join public.labels l on l.id = i.id where l.klant_notitie is distinct from i.note;
  if p_apply then
    update public.labels l set klant_notitie = i.note from _imp i
    where l.id = i.id and l.klant_notitie is distinct from i.note;
  end if;
  return jsonb_build_object('matched', v_matched, 'changed', v_changed, 'unknown', v_unknown, 'applied', p_apply);
end;
$$;
revoke execute on function public.label_import_customer_notes(jsonb, boolean) from public, anon;
grant execute on function public.label_import_customer_notes(jsonb, boolean) to authenticated;

create function public.label_people_overview()
returns table (user_id uuid, email text, name text, role text, added_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.name, m.role, m.added_at, u.last_sign_in_at
  from public.label_members m join auth.users u on u.id = m.user_id
  union all
  select c.user_id, u.email::text, c.name, 'customer', c.added_at, u.last_sign_in_at
  from public.label_customers c join auth.users u on u.id = c.user_id
  order by 3 nulls last, 2;
$$;
revoke execute on function public.label_people_overview() from public, anon, authenticated;
grant execute on function public.label_people_overview() to service_role;
