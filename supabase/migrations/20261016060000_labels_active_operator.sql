-- Al toegepast op 2026-10-16.
alter table public.labels add column actief boolean not null default true;
alter table public.labels add column operator text check (operator is null or char_length(operator) between 1 and 60);

create or replace function public.label_set_active(p_ids uuid[], p_active boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not (public.is_label_editor() or public.is_label_customer()) then
    raise exception 'geen rechten' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 1000 then
    raise exception 'maximaal 1000 regels tegelijk' using errcode = '22023';
  end if;
  update public.labels set actief = p_active
  where id = any(p_ids) and actief is distinct from p_active;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.label_set_active(uuid[], boolean) from public, anon;
grant execute on function public.label_set_active(uuid[], boolean) to authenticated;
