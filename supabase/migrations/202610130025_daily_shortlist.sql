-- Preserve existing day/history rows, but hide automatically seeded options unless
-- colleagues nominated, voted for or picked them. New days start with no options.
alter table public.daily_lunch_options add column is_shortlisted boolean not null default true;
update public.daily_lunch_options o set is_shortlisted=false
where o.suggested_by is null
  and not exists(select 1 from public.daily_lunch_votes v where v.organization_id=o.organization_id and v.lunch_date=o.lunch_date and v.place_id=o.place_id)
  and not exists(select 1 from public.daily_lunch_picks p where p.organization_id=o.organization_id and p.lunch_date=o.lunch_date and p.place_id=o.place_id);

create or replace function public.lunch_overview(org uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day(); result jsonb;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  select jsonb_build_object(
    'day',today,
    'mine',(select choice from public.daily_lunch_responses where organization_id=org and lunch_date=today and user_id=auth.uid()),
    'myVote',(select place_id from public.daily_lunch_votes where organization_id=org and lunch_date=today and user_id=auth.uid()),
    'pickedPlaceId',(select place_id from public.daily_lunch_picks where organization_id=org and lunch_date=today),
    'counts',jsonb_build_object(
      'going_out',count(*) filter(where r.choice='going_out'),
      'brought_food',count(*) filter(where r.choice='brought_food'),
      'no_lunch',count(*) filter(where r.choice='no_lunch'),
      'ordering_in',count(*) filter(where r.choice='ordering_in'),
      'unanswered',count(*) filter(where r.choice is null)),
    'options',coalesce((select jsonb_agg(jsonb_build_object(
      'nominated',true,
      'place',p.metadata || jsonb_build_object('updatedAt',p.refreshed_at),
      'votes',(select count(*) from public.daily_lunch_votes v join public.organization_memberships m on m.organization_id=v.organization_id and m.user_id=v.user_id where v.organization_id=org and v.lunch_date=today and v.place_id=o.place_id),
      'override',case when c.place_id is not null then jsonb_build_object('cuisines',c.cuisines,'updatedAt',c.updated_at) else null end
    ) order by p.metadata->>'name',p.id) from public.daily_lunch_options o join public.places p on p.id=o.place_id
      left join public.place_cuisine_overrides c on c.organization_id=org and c.place_id=p.id
      where o.organization_id=org and o.lunch_date=today and o.is_shortlisted),'[]'::jsonb)
  ) into result from public.organization_memberships m left join public.daily_lunch_responses r
    on r.organization_id=m.organization_id and r.user_id=m.user_id and r.lunch_date=today where m.organization_id=org;
  return result;
end;
$$;
create or replace function public.suggest_lunch_place(org uuid, osm_place_id text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if osm_place_id is null or not exists(select 1 from public.places p where p.id=osm_place_id and p.provider='osm') or
    not (exists(select 1 from public.reviews where organization_id=org and place_id=osm_place_id) or
      exists(select 1 from public.osm_region_cache c,jsonb_array_elements(c.places) p where c.organization_id=org and p->>'id'=osm_place_id)) then
    raise exception 'Suggest a restaurant reviewed or found by this organization';
  end if;
  insert into public.daily_lunch_options(organization_id,lunch_date,place_id,suggested_by)
    values(org,public.lunch_day(),osm_place_id,auth.uid()) on conflict(organization_id,lunch_date,place_id) do update set is_shortlisted=true,suggested_by=coalesce(public.daily_lunch_options.suggested_by,excluded.suggested_by);
end;
$$;

create or replace function public.vote_lunch_place(org uuid, osm_place_id text) returns void language plpgsql security definer set search_path = '' as $$
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
  if not exists(select 1 from public.daily_lunch_options where organization_id=org and lunch_date=today and place_id=osm_place_id and is_shortlisted) then raise exception 'Choose a restaurant from today''s options'; end if;
  insert into public.daily_lunch_votes values(org,today,auth.uid(),osm_place_id)
    on conflict(organization_id,lunch_date,user_id) do update set place_id=excluded.place_id;
end;
$$;
create or replace function public.spin_lunch_wheel(org uuid, candidate_ids text[] default null) returns text language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day(); chosen text;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if not exists(select 1 from public.daily_lunch_responses where organization_id=org and lunch_date=today and user_id=auth.uid() and choice='going_out') then raise exception 'Choose going out before voting or spinning'; end if;
  if exists(select 1 from public.daily_lunch_options where organization_id=org and lunch_date=today and is_shortlisted) then
    select place_id into chosen from public.daily_lunch_options where organization_id=org and lunch_date=today and is_shortlisted order by random() limit 1;
  else
    select p.id into chosen from public.places p where p.provider='osm'
      and (candidate_ids is null or p.id=any(candidate_ids))
      and exists(select 1 from public.current_reviews r where r.organization_id=org and r.place_id=p.id)
      order by random() limit 1;
  end if;
  if chosen is null then raise exception 'No eligible restaurants. Adjust your place filters or suggest a restaurant.'; end if;
  insert into public.daily_lunch_options(organization_id,lunch_date,place_id,suggested_by)
    values(org,today,chosen,auth.uid()) on conflict(organization_id,lunch_date,place_id)
    do update set is_shortlisted=true;
  insert into public.daily_lunch_picks values(org,today,chosen,auth.uid())
    on conflict(organization_id,lunch_date) do update set place_id=excluded.place_id,picked_by=excluded.picked_by;
  return chosen;
end;
$$;
notify pgrst, 'reload schema';
