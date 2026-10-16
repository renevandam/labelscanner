-- Al toegepast op 2026-10-16.
alter table public.label_members add column role text not null default 'scanner' check (role in ('scanner','editor'));

create or replace function public.is_label_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.label_members where user_id = (select auth.uid()) and role = 'editor');
$$;
revoke execute on function public.is_label_editor() from public, anon;
grant execute on function public.is_label_editor() to authenticated;

alter policy "leden wijzigen" on public.labels
  using ((select public.is_label_editor())) with check ((select public.is_label_editor()));
alter policy "leden wijzigen" on public.labels rename to "beheerders wijzigen";
alter policy "leden verwijderen" on public.labels
  using ((select public.is_label_editor()));
alter policy "leden verwijderen" on public.labels rename to "beheerders verwijderen";
