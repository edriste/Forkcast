alter table public.organizations
  add column latitude double precision,
  add column longitude double precision,
  add column location_label text,
  add constraint organization_coordinates check (
    (latitude is null and longitude is null and location_label is null) or
    (latitude is not null and longitude is not null and location_label is not null
      and latitude between -90 and 90 and longitude between -180 and 180
      and char_length(trim(location_label)) between 1 and 500)
  );

-- Reuse known centers for older groups; never invent a location.
update public.organizations o set latitude=c.latitude, longitude=c.longitude,
  location_label=o.search_area from public.osm_region_cache c
where c.organization_id=o.id and c.area_query=o.search_area
  and c.latitude between -90 and 90 and c.longitude between -180 and 180;

create table public.osm_location_cache (
  query text primary key,
  locations jsonb not null,
  refreshed_at timestamptz not null default now()
);
alter table public.osm_location_cache enable row level security;
revoke all on public.osm_location_cache from public, anon, authenticated;
grant all on public.osm_location_cache to service_role;

-- Keep the old two-argument RPC for older installed clients.
create function public.create_organization(org_name text, area text,
  office_latitude double precision, office_longitude double precision, office_label text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if office_latitude is null or office_longitude is null or office_label is null then
    raise exception 'Select an organization location';
  end if;
  insert into public.organizations(name,search_area,created_by,latitude,longitude,location_label)
    values(trim(org_name),trim(area),auth.uid(),office_latitude,office_longitude,trim(office_label)) returning id into org;
  insert into public.organization_memberships values(org,auth.uid(),now());
  insert into public.organization_invites(organization_id) values(org);
  return org;
end;
$$;
revoke all on function public.create_organization(text,text,double precision,double precision,text) from public,anon;
grant execute on function public.create_organization(text,text,double precision,double precision,text) to authenticated;

create function public.set_organization_location(org uuid, area text,
  office_latitude double precision, office_longitude double precision, office_label text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.organizations where id=org and created_by=auth.uid() for update;
  if not found then raise exception 'Only the group creator can change the location'; end if;
  if office_latitude is null or office_longitude is null or office_label is null then
    raise exception 'Select an organization location';
  end if;
  update public.organizations set search_area=trim(area),latitude=office_latitude,
    longitude=office_longitude,location_label=trim(office_label) where id=org;
  delete from public.osm_region_cache where organization_id=org;
end;
$$;
revoke all on function public.set_organization_location(uuid,text,double precision,double precision,text) from public,anon;
grant execute on function public.set_organization_location(uuid,text,double precision,double precision,text) to authenticated;

-- Older clients changing a text-only search area must not retain a stale office pin.
create or replace function public.set_search_area(org uuid, area text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.organizations where id=org and created_by=auth.uid() for update;
  if not found then raise exception 'Only the group creator can change the search area'; end if;
  update public.organizations set search_area=trim(area),latitude=null,longitude=null,location_label=null where id=org;
  delete from public.osm_region_cache where organization_id=org;
end;
$$;
