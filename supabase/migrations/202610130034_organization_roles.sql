-- Organization ownership is historical; administrative access comes from membership roles.
alter table public.organization_memberships add column role text not null default 'member'
  check (role in ('admin','member'));
update public.organization_memberships m set role='admin'
from public.organizations o where o.id=m.organization_id and o.created_by=m.user_id;

create function public.is_organization_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_memberships
    where organization_id=org and user_id=auth.uid() and role='admin');
$$;
revoke all on function public.is_organization_admin(uuid) from public,anon;
grant execute on function public.is_organization_admin(uuid) to authenticated;
-- Role changes are only permitted through the validated RPC below.
revoke insert,update,delete on public.organization_memberships from public,anon,authenticated;

create function public.set_organization_member_role(org uuid, member uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- All administrative mutations serialize on this row. Recheck access AFTER locking,
  -- so a waiting administrator who was demoted cannot keep using stale privileges.
  perform 1 from public.organizations where id=org for update;
  if not found or not public.is_organization_admin(org) then
    raise exception 'Only organization administrators can manage member roles';
  end if;
  if new_role is null or new_role not in ('admin','member') then
    raise exception 'Choose admin or member';
  end if;
  if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=member) then
    raise exception 'This colleague is not a member of this organization';
  end if;
  if new_role='member'
    and exists(select 1 from public.organization_memberships where organization_id=org and user_id=member and role='admin')
    and (select count(*) from public.organization_memberships where organization_id=org and role='admin')<=1 then
    raise exception 'Keep at least one organization administrator';
  end if;
  update public.organization_memberships set role=new_role
    where organization_id=org and user_id=member and role<>new_role;
end;
$$;
revoke all on function public.set_organization_member_role(uuid,uuid,text) from public,anon;
grant execute on function public.set_organization_member_role(uuid,uuid,text) to authenticated;

create or replace function public.create_organization(org_name text, area text) returns uuid language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.organizations(name, search_area, created_by) values(trim(org_name), trim(area), auth.uid()) returning id into org;
  insert into public.organization_memberships(organization_id,user_id,role) values(org,auth.uid(),'admin');
  insert into public.organization_invites(organization_id) values(org);
  return org;
end;
$$;

create or replace function public.create_organization(org_name text, area text,
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
  insert into public.organization_memberships(organization_id,user_id,role) values(org,auth.uid(),'admin');
  insert into public.organization_invites(organization_id) values(org);
  return org;
end;
$$;

create or replace function public.organization_invite(org uuid, rotate boolean default false) returns text language plpgsql security definer set search_path = '' as $$
declare result text;
begin
  perform 1 from public.organizations where id=org for update;
  if not found or not public.is_organization_admin(org) then raise exception 'Only organization administrators can manage invitations'; end if;
  if rotate then update public.organization_invites set code = replace(gen_random_uuid()::text, '-', '') where organization_id = org; end if;
  select code into result from public.organization_invites where organization_id = org;
  return result;
end;
$$;

create or replace function public.set_organization_location(org uuid, area text,
  office_latitude double precision, office_longitude double precision, office_label text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.organizations where id=org for update;
  if not found or not public.is_organization_admin(org) then raise exception 'Only organization administrators can change the location'; end if;
  if office_latitude is null or office_longitude is null or office_label is null then
    raise exception 'Select an organization location';
  end if;
  update public.organizations set search_area=trim(area),latitude=office_latitude,
    longitude=office_longitude,location_label=trim(office_label) where id=org;
  delete from public.osm_region_cache where organization_id=org;
end;
$$;

create or replace function public.set_search_area(org uuid, area text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.organizations where id=org for update;
  if not found or not public.is_organization_admin(org) then raise exception 'Only organization administrators can change the search area'; end if;
  update public.organizations set search_area=trim(area),latitude=null,longitude=null,location_label=null where id=org;
  delete from public.osm_region_cache where organization_id=org;
end;
$$;

create or replace function public.link_legacy_place(org uuid, legacy_id text, osm_place_id text) returns integer language plpgsql security definer set search_path = '' as $$
declare moved integer;
begin
  perform 1 from public.organizations where id=org for update;
  if not found or not public.is_organization_admin(org) then raise exception 'Only organization administrators can match previous entries'; end if;
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

