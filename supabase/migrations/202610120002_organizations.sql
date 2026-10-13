create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  search_area text not null check (char_length(trim(search_area)) between 1 and 120),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user on public.organization_memberships(user_id);
create table public.organization_invites (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  code text not null unique default replace(gen_random_uuid()::text, '-', '')
);
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invites enable row level security;

create function public.is_member(org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_memberships where organization_id = org and user_id = auth.uid());
$$;
revoke all on function public.is_member(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;
create policy member_organizations on public.organizations for select to authenticated using (public.is_member(id));
create policy member_memberships on public.organization_memberships for select to authenticated using (public.is_member(organization_id));
create policy colleague_profiles on public.profiles for select to authenticated using (
  exists(select 1 from public.organization_memberships m where m.user_id = profiles.id and public.is_member(m.organization_id))
);
grant select on public.organizations, public.organization_memberships to authenticated;

create function public.create_organization(org_name text, area text) returns uuid language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.organizations(name, search_area, created_by) values(trim(org_name), trim(area), auth.uid()) returning id into org;
  insert into public.organization_memberships values(org, auth.uid(), now());
  insert into public.organization_invites(organization_id) values(org);
  return org;
end;
$$;
create function public.join_organization(invite_code text) returns uuid language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select organization_id into org from public.organization_invites where code = lower(trim(invite_code));
  if org is null then raise exception 'This invite is invalid or has been rotated'; end if;
  insert into public.organization_memberships(organization_id, user_id) values(org, auth.uid()) on conflict do nothing;
  return org;
end;
$$;
create function public.organization_invite(org uuid, rotate boolean default false) returns text language plpgsql security definer set search_path = '' as $$
declare result text;
begin
  if not exists(select 1 from public.organizations where id = org and created_by = auth.uid()) then raise exception 'Only the group creator can manage invitations'; end if;
  if rotate then update public.organization_invites set code = replace(gen_random_uuid()::text, '-', '') where organization_id = org; end if;
  select code into result from public.organization_invites where organization_id = org;
  return result;
end;
$$;
revoke all on function public.create_organization(text,text), public.join_organization(text), public.organization_invite(uuid,boolean) from public;
grant execute on function public.create_organization(text,text), public.join_organization(text), public.organization_invite(uuid,boolean) to authenticated;
