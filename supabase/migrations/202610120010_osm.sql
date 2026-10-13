-- Additive provider migration: existing Google IDs and every review remain intact.
alter table public.places add column provider text not null default 'google_legacy' check(provider in ('osm','google_legacy'));
alter table public.places add column metadata jsonb;
alter table public.places add column refreshed_at timestamptz;
alter table public.places add constraint osm_place_metadata check(provider <> 'osm' or (id ~ '^osm:(node|way|relation):[1-9][0-9]{0,18}$' and metadata is not null and metadata->>'id' = id and metadata->>'provider' = 'osm'));

-- External OSM facts are cached separately from private reviews and ratings.
create table public.osm_region_cache (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  area_query text not null,
  latitude double precision,
  longitude double precision,
  places jsonb not null default '[]'::jsonb check(jsonb_typeof(places) = 'array'),
  refreshed_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  retry_after timestamptz
);
alter table public.osm_region_cache enable row level security;
create policy member_osm_region on public.osm_region_cache for select to authenticated using(public.is_member(organization_id));
revoke all on public.osm_region_cache from public,anon,authenticated;
grant select on public.osm_region_cache to authenticated;
grant all on public.osm_region_cache,public.places to service_role;

create table public.osm_request_gate(service text primary key, available_at timestamptz not null);
alter table public.osm_request_gate enable row level security;
revoke all on public.osm_request_gate from public,anon,authenticated;
-- Global gates prevent concurrent Edge Function instances exceeding public-service limits.
create function public.claim_osm_request(service_name text) returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed text;
begin
  if service_name not in ('nominatim','overpass') then raise exception 'Unknown OSM service'; end if;
  insert into public.osm_request_gate(service,available_at) values(service_name,clock_timestamp() + case when service_name='nominatim' then interval '1.1 seconds' else interval '10 seconds' end)
  on conflict(service) do update set available_at=clock_timestamp() + case when service_name='nominatim' then interval '1.1 seconds' else interval '10 seconds' end where osm_request_gate.available_at <= clock_timestamp() returning service into claimed;
  return claimed is not null;
end;
$$;
create function public.claim_osm_refresh(org uuid, area text) returns uuid language plpgsql security definer set search_path = '' as $$
declare token uuid := gen_random_uuid(); claimed uuid;
begin
  insert into public.osm_region_cache(organization_id,area_query,lease_until,lease_token) values(org,area,clock_timestamp()+interval '2 minutes',token)
  on conflict(organization_id) do update set lease_until=clock_timestamp()+interval '2 minutes',lease_token=excluded.lease_token
  where (osm_region_cache.lease_until is null or osm_region_cache.lease_until < clock_timestamp())
    and (osm_region_cache.retry_after is null or osm_region_cache.retry_after < clock_timestamp())
    and (osm_region_cache.refreshed_at is null or osm_region_cache.refreshed_at < now()-interval '30 days' or osm_region_cache.area_query <> area)
  returning lease_token into claimed;
  return claimed;
end;
$$;
revoke all on function public.claim_osm_request(text),public.claim_osm_refresh(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_osm_request(text),public.claim_osm_refresh(uuid,text) to service_role;

-- Clients can review only an OSM entry verified in their area's cache or already reviewed there.
drop function public.add_review(uuid,text,integer,text,text);
create function public.add_review(org uuid, osm_place_id text, rating integer, vote text, review_comment text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if not exists(select 1 from public.places p where p.id=osm_place_id and p.provider='osm') then raise exception 'Select a verified OpenStreetMap place'; end if;
  if not exists(select 1 from public.osm_region_cache c, jsonb_array_elements(c.places) item where c.organization_id=org and item->>'id'=osm_place_id)
    and not exists(select 1 from public.reviews where organization_id=org and place_id=osm_place_id) then raise exception 'Place is not available in this organization'; end if;
  insert into public.reviews(organization_id,place_id,author_id,stars,recommendation,comment)
  values(org,osm_place_id,auth.uid(),rating,vote,nullif(trim(review_comment),'')) returning id into result;
  return result;
end;
$$;
create function public.link_legacy_place(org uuid, legacy_id text, osm_place_id text) returns integer language plpgsql security definer set search_path = '' as $$
declare moved integer;
begin
  perform 1 from public.organizations where id=org and created_by=auth.uid() for update;
  if not found or not public.is_member(org) then raise exception 'Only the group creator can match previous entries'; end if;
  if not exists(select 1 from public.places where id=legacy_id and provider='google_legacy') then raise exception 'This entry has already been matched or is unavailable'; end if;
  if not exists(select 1 from public.places where id=osm_place_id and provider='osm')
    or (not exists(select 1 from public.osm_region_cache c,jsonb_array_elements(c.places) item where c.organization_id=org and item->>'id'=osm_place_id)
        and not exists(select 1 from public.reviews where organization_id=org and place_id=osm_place_id)) then raise exception 'Select an OpenStreetMap place from this group search'; end if;
  update public.reviews set place_id=osm_place_id where organization_id=org and place_id=legacy_id;
  get diagnostics moved = row_count;
  if moved=0 then raise exception 'No reviews remain to match'; end if;
  return moved;
end;
$$;
revoke all on function public.add_review(uuid,text,integer,text,text),public.link_legacy_place(uuid,text,text) from public,anon;
grant execute on function public.add_review(uuid,text,integer,text,text),public.link_legacy_place(uuid,text,text) to authenticated;

create function public.set_search_area(org uuid, area text) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.organizations set search_area=trim(area) where id=org and created_by=auth.uid() and public.is_member(org);
  if not found then raise exception 'Only the group creator can change the search area'; end if;
  delete from public.osm_region_cache where organization_id=org;
end;
$$;
revoke all on function public.set_search_area(uuid,text) from public,anon;
grant execute on function public.set_search_area(uuid,text) to authenticated;
