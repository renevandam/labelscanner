-- Al toegepast op project yoyuwhhkonkggoscpofq (Mobilient) op 2026-10-16.
create table public.label_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.label_members enable row level security;
create policy "leden zien zichzelf" on public.label_members
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_label_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.label_members where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_label_member() from public, anon;
grant execute on function public.is_label_member() to authenticated;

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  project text, intern_order text, unit text, datum date, coordinator text,
  doos numeric check (doos >= 0), lengte numeric check (lengte >= 0), pallet numeric check (pallet >= 0),
  rol numeric check (rol >= 0), kabel numeric check (kabel >= 0),
  notitie text, photo_path text,
  scanned_by uuid default auth.uid() references auth.users(id) on delete set null,
  scanned_by_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index labels_created_at_idx on public.labels (created_at desc);
create index labels_unit_idx on public.labels (unit);
create index labels_scanned_by_idx on public.labels (scanned_by);

alter table public.labels enable row level security;
create policy "leden lezen" on public.labels for select to authenticated using ((select public.is_label_member()));
create policy "leden voegen toe" on public.labels for insert to authenticated
  with check ((select public.is_label_member()) and scanned_by = (select auth.uid()));
create policy "leden wijzigen" on public.labels for update to authenticated
  using ((select public.is_label_member())) with check ((select public.is_label_member()));
create policy "leden verwijderen" on public.labels for delete to authenticated using ((select public.is_label_member()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('label-photos', 'label-photos', false, 5242880, array['image/jpeg']);
create policy "leden lezen fotos" on storage.objects for select to authenticated
  using (bucket_id = 'label-photos' and (select public.is_label_member()));
create policy "leden uploaden in eigen map" on storage.objects for insert to authenticated
  with check (bucket_id = 'label-photos' and (select public.is_label_member())
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "leden verwijderen fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'label-photos' and (select public.is_label_member()));
