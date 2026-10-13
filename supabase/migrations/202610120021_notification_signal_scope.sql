-- Each notification owns its signal row, so unrelated notifications never share a write lock.
alter table public.inbox_signals add column notification_id uuid not null default gen_random_uuid();
alter table public.inbox_signals drop constraint inbox_signals_pkey;
alter table public.inbox_signals add primary key(organization_id,recipient_id,notification_id);
create or replace function public.signal_inbox_change() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
  item := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.inbox_signals as s(organization_id,recipient_id,notification_id)
    select (item->>'organization_id')::uuid,(item->>'recipient_id')::uuid,(item->>'id')::uuid
    where exists(select 1 from public.organizations where id=(item->>'organization_id')::uuid)
      and exists(select 1 from public.profiles where id=(item->>'recipient_id')::uuid)
  on conflict(organization_id,recipient_id,notification_id) do update set revision=s.revision+1;
  return null;
end;
$$;
notify pgrst,'reload schema';
