-- Al toegepast op 2026-10-16.
alter table public.labels add column locatie text;
create index labels_locatie_idx on public.labels (locatie);
