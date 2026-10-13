-- Global source-fact leases are separate from organization-private reviews/overrides.
create table public.osm_place_refresh (
  place_id text primary key references public.places(id) on delete cascade,
  lease_token uuid,
  lease_until timestamptz,
  checked_at timestamptz,
  retry_after timestamptz
);
alter table public.osm_place_refresh enable row level security;
revoke all on public.osm_place_refresh from public,anon,authenticated;
grant all on public.osm_place_refresh to service_role;
create function public.claim_osm_place_refresh(ids text[], force_refresh boolean default false)
returns table(place_id text, token uuid) language plpgsql security definer set search_path='' as $$
declare batch uuid := gen_random_uuid();
begin
  if cardinality(ids)>100 then raise exception 'Too many place identifiers'; end if;
  return query
    insert into public.osm_place_refresh as target(place_id,lease_token,lease_until)
      select p.id,batch,clock_timestamp()+interval '2 minutes' from public.places p
      where p.id=any(ids) and p.provider='osm'
      and (force_refresh or p.refreshed_at is null or p.refreshed_at<now()-interval '1 day') order by p.id
    on conflict on constraint osm_place_refresh_pkey do update set lease_token=batch,lease_until=clock_timestamp()+interval '2 minutes'
      where (target.lease_until is null or target.lease_until<clock_timestamp())
      and (target.retry_after is null or target.retry_after<clock_timestamp())
      and (target.checked_at is null or target.checked_at<now()-case when force_refresh then interval '5 minutes' else interval '1 day' end)
    returning target.place_id,target.lease_token;
end;
$$;
create function public.finish_osm_place_refresh(batch uuid, updates jsonb, succeeded boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if succeeded then
    update public.places p set metadata=item,refreshed_at=now()
      from jsonb_array_elements(updates) item,public.osm_place_refresh r
      where p.id=item->>'id' and r.place_id=p.id and r.lease_token=batch and p.provider='osm';
    -- Merge fresh facts into cached search catalogues without extending their discovery lifetime.
    update public.osm_region_cache c set places=(
      select jsonb_agg(case when p.id is not null then p.metadata else item end order by position)
      from jsonb_array_elements(c.places) with ordinality as entries(item,position)
      left join (public.places p join public.osm_place_refresh r on r.place_id=p.id and r.lease_token=batch)
        on p.id=item->>'id'
    ) where exists(select 1 from jsonb_array_elements(c.places) item join public.osm_place_refresh r on r.place_id=item->>'id' where r.lease_token=batch);
  end if;
  update public.osm_place_refresh set lease_until=null,lease_token=null,
    checked_at=case when succeeded then now() else checked_at end,
    retry_after=case when succeeded then null else now()+interval '1 minute' end where lease_token=batch;
end;
$$;
revoke all on function public.claim_osm_place_refresh(text[],boolean),public.finish_osm_place_refresh(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.claim_osm_place_refresh(text[],boolean),public.finish_osm_place_refresh(uuid,jsonb,boolean) to service_role;
notify pgrst,'reload schema';
