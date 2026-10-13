-- Daily choices share the app's Berlin calendar, independent of device timezone.
create function public.lunch_day() returns date language sql stable set search_path = '' as $$
  select (current_timestamp at time zone 'Europe/Berlin')::date;
$$;
create table public.daily_lunch_responses (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lunch_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  choice text not null check(choice in ('going_out','brought_food','no_lunch')),
  primary key(organization_id,lunch_date,user_id)
);
create table public.daily_lunch_options (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lunch_date date not null,
  place_id text not null references public.places(id),
  suggested_by uuid references public.profiles(id) on delete set null,
  primary key(organization_id,lunch_date,place_id)
);
create table public.daily_lunch_votes (
  organization_id uuid not null,
  lunch_date date not null,
  user_id uuid not null,
  place_id text not null,
  primary key(organization_id,lunch_date,user_id),
  foreign key(organization_id,lunch_date,user_id) references public.daily_lunch_responses on delete cascade,
  foreign key(organization_id,lunch_date,place_id) references public.daily_lunch_options on delete cascade
);
create table public.daily_lunch_picks (
  organization_id uuid not null,
  lunch_date date not null,
  place_id text not null,
  picked_by uuid references public.profiles(id) on delete set null,
  primary key(organization_id,lunch_date),
  foreign key(organization_id,lunch_date,place_id) references public.daily_lunch_options on delete cascade
);
alter table public.daily_lunch_responses enable row level security;
alter table public.daily_lunch_options enable row level security;
alter table public.daily_lunch_votes enable row level security;
alter table public.daily_lunch_picks enable row level security;
create policy member_daily_responses on public.daily_lunch_responses for select to authenticated using(public.is_member(organization_id));
create policy member_daily_options on public.daily_lunch_options for select to authenticated using(public.is_member(organization_id));
create policy member_daily_votes on public.daily_lunch_votes for select to authenticated using(public.is_member(organization_id));
create policy member_daily_picks on public.daily_lunch_picks for select to authenticated using(public.is_member(organization_id));
revoke all on public.daily_lunch_responses,public.daily_lunch_options,public.daily_lunch_votes,public.daily_lunch_picks from public,anon,authenticated;
grant select on public.daily_lunch_responses,public.daily_lunch_options,public.daily_lunch_votes,public.daily_lunch_picks to authenticated;

create function public.lunch_overview(org uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day(); result jsonb;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  insert into public.daily_lunch_options(organization_id,lunch_date,place_id)
    select distinct org,today,r.place_id from public.reviews r join public.places p on p.id=r.place_id
    where r.organization_id=org and p.provider='osm' on conflict do nothing;
  select jsonb_build_object(
    'day',today,
    'mine',(select choice from public.daily_lunch_responses where organization_id=org and lunch_date=today and user_id=auth.uid()),
    'myVote',(select place_id from public.daily_lunch_votes where organization_id=org and lunch_date=today and user_id=auth.uid()),
    'pickedPlaceId',(select place_id from public.daily_lunch_picks where organization_id=org and lunch_date=today),
    'counts',jsonb_build_object(
      'going_out',count(*) filter(where r.choice='going_out'),
      'brought_food',count(*) filter(where r.choice='brought_food'),
      'no_lunch',count(*) filter(where r.choice='no_lunch'),
      'unanswered',count(*) filter(where r.choice is null)),
    'options',coalesce((select jsonb_agg(jsonb_build_object(
      'place',p.metadata || jsonb_build_object('updatedAt',p.refreshed_at),
      'votes',(select count(*) from public.daily_lunch_votes v join public.organization_memberships m on m.organization_id=v.organization_id and m.user_id=v.user_id where v.organization_id=org and v.lunch_date=today and v.place_id=o.place_id),
      'override',case when c.place_id is not null then jsonb_build_object('cuisines',c.cuisines,'updatedAt',c.updated_at) else null end
    ) order by p.metadata->>'name',p.id) from public.daily_lunch_options o join public.places p on p.id=o.place_id
      left join public.place_cuisine_overrides c on c.organization_id=org and c.place_id=p.id
      where o.organization_id=org and o.lunch_date=today),'[]'::jsonb)
  ) into result from public.organization_memberships m left join public.daily_lunch_responses r
    on r.organization_id=m.organization_id and r.user_id=m.user_id and r.lunch_date=today where m.organization_id=org;
  return result;
end;
$$;
create function public.set_lunch_response(org uuid, answer text) returns void language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day();
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if answer is not null and answer not in ('going_out','brought_food','no_lunch') then raise exception 'Choose a valid lunch answer'; end if;
  if answer is null then
    delete from public.daily_lunch_responses where organization_id=org and lunch_date=today and user_id=auth.uid();
  else
    insert into public.daily_lunch_responses values(org,today,auth.uid(),answer)
      on conflict(organization_id,lunch_date,user_id) do update set choice=excluded.choice;
    if answer <> 'going_out' then delete from public.daily_lunch_votes where organization_id=org and lunch_date=today and user_id=auth.uid(); end if;
  end if;
end;
$$;
create function public.suggest_lunch_place(org uuid, osm_place_id text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if osm_place_id is null or not exists(select 1 from public.places p where p.id=osm_place_id and p.provider='osm') or
    not (exists(select 1 from public.reviews where organization_id=org and place_id=osm_place_id) or
      exists(select 1 from public.osm_region_cache c,jsonb_array_elements(c.places) p where c.organization_id=org and p->>'id'=osm_place_id)) then
    raise exception 'Suggest a restaurant reviewed or found by this organization';
  end if;
  insert into public.daily_lunch_options(organization_id,lunch_date,place_id,suggested_by)
    values(org,public.lunch_day(),osm_place_id,auth.uid()) on conflict do nothing;
end;
$$;
create function public.vote_lunch_place(org uuid, osm_place_id text) returns void language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day();
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if osm_place_id is null then
    delete from public.daily_lunch_votes where organization_id=org and lunch_date=today and user_id=auth.uid();
    return;
  end if;
  if not exists(select 1 from public.daily_lunch_responses where organization_id=org and lunch_date=today and user_id=auth.uid() and choice='going_out') then
    raise exception 'Choose going out before voting or spinning';
  end if;
  if not exists(select 1 from public.daily_lunch_options where organization_id=org and lunch_date=today and place_id=osm_place_id) then raise exception 'Choose a restaurant from today''s options'; end if;
  insert into public.daily_lunch_votes values(org,today,auth.uid(),osm_place_id)
    on conflict(organization_id,lunch_date,user_id) do update set place_id=excluded.place_id;
end;
$$;
create function public.spin_lunch_wheel(org uuid) returns text language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day(); chosen text;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if not exists(select 1 from public.daily_lunch_responses where organization_id=org and lunch_date=today and user_id=auth.uid() and choice='going_out') then raise exception 'Choose going out before voting or spinning'; end if;
  select place_id into chosen from public.daily_lunch_options where organization_id=org and lunch_date=today order by random() limit 1;
  if chosen is null then raise exception 'Suggest a restaurant before spinning'; end if;
  insert into public.daily_lunch_picks values(org,today,chosen,auth.uid())
    on conflict(organization_id,lunch_date) do update set place_id=excluded.place_id,picked_by=excluded.picked_by;
  return chosen;
end;
$$;
revoke all on function public.lunch_day(),public.lunch_overview(uuid),public.set_lunch_response(uuid,text),public.suggest_lunch_place(uuid,text),public.vote_lunch_place(uuid,text),public.spin_lunch_wheel(uuid) from public,anon;
grant execute on function public.lunch_day(),public.lunch_overview(uuid),public.set_lunch_response(uuid,text),public.suggest_lunch_place(uuid,text),public.vote_lunch_place(uuid,text),public.spin_lunch_wheel(uuid) to authenticated;

notify pgrst, 'reload schema';
