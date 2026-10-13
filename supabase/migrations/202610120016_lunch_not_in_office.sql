-- Add absence as a distinct daily response, preserving existing answers and votes.
alter table public.daily_lunch_responses drop constraint daily_lunch_responses_choice_check;
alter table public.daily_lunch_responses add constraint daily_lunch_responses_choice_check
  check(choice in ('going_out','brought_food','no_lunch','not_in_office'));

create or replace function public.lunch_overview(org uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
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
      'not_in_office',count(*) filter(where r.choice='not_in_office'),
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
create or replace function public.set_lunch_response(org uuid, answer text) returns void language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day();
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if answer is not null and answer not in ('going_out','brought_food','no_lunch','not_in_office') then raise exception 'Choose a valid lunch answer'; end if;
  if answer is null then
    delete from public.daily_lunch_responses where organization_id=org and lunch_date=today and user_id=auth.uid();
  else
    insert into public.daily_lunch_responses values(org,today,auth.uid(),answer)
      on conflict(organization_id,lunch_date,user_id) do update set choice=excluded.choice;
    if answer <> 'going_out' then delete from public.daily_lunch_votes where organization_id=org and lunch_date=today and user_id=auth.uid(); end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
