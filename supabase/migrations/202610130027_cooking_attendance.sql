-- Record provenance so leaving a booking cannot remove a later manual answer.
alter table public.daily_lunch_responses add column from_cooking boolean not null default false;
alter table public.daily_lunch_responses add constraint cooking_response_choice check(not from_cooking or choice='brought_food');
-- Existing bookings fill unanswered days only; retain all explicitly chosen answers.
insert into public.daily_lunch_responses(organization_id,lunch_date,user_id,choice,from_cooking)
select distinct e.organization_id,e.meal_date,p.user_id,'brought_food',true
from public.cooking_event_participants p join public.cooking_events e on e.id=p.event_id
join public.organization_memberships m on m.organization_id=e.organization_id and m.user_id=p.user_id
where e.meal_date>=public.lunch_day()
on conflict(organization_id,lunch_date,user_id) do nothing;

create or replace function public.set_portions(event uuid, quantity integer) returns void language plpgsql security definer set search_path = '' as $$
declare meal public.cooking_events; reserved bigint; was_joined boolean;
begin
  select * into meal from public.cooking_events where id = event for update;
  if not found or not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  if meal.meal_date < (now() at time zone 'Europe/Berlin')::date then raise exception 'This lunch has already passed'; end if;
  if quantity is null or quantity < 0 or quantity > 10000 then raise exception 'Choose between 0 and 10000 portions'; end if;
  -- Cooking capacity keeps its event lock; attendance edits serialize on the group.
  perform 1 from public.organizations where id=meal.organization_id for update;
  select exists(select 1 from public.cooking_event_participants where event_id=event and user_id=auth.uid()) into was_joined;
  if quantity = 0 then
    delete from public.cooking_event_participants where event_id=event and user_id=auth.uid();
    if was_joined and not exists(
      select 1 from public.cooking_event_participants p join public.cooking_events e on e.id=p.event_id
      where e.organization_id=meal.organization_id and e.meal_date=meal.meal_date and p.user_id=auth.uid()
    ) then
      delete from public.daily_lunch_responses where organization_id=meal.organization_id
        and lunch_date=meal.meal_date and user_id=auth.uid() and from_cooking and choice='brought_food';
    end if;
    return;
  end if;
  select coalesce(sum(portions),0) into reserved from public.cooking_event_participants where event_id = event and user_id <> auth.uid();
  if meal.max_portions is not null and reserved + quantity > meal.max_portions then raise exception 'Not enough portions remaining. Refresh and choose a smaller quantity.'; end if;
  insert into public.cooking_event_participants(event_id,user_id,portions) values(event,auth.uid(),quantity)
  on conflict(event_id,user_id) do update set portions = excluded.portions,
    paid = case when cooking_event_participants.portions = excluded.portions then cooking_event_participants.paid else false end;
  if not was_joined then
    insert into public.daily_lunch_responses(organization_id,lunch_date,user_id,choice,from_cooking)
      values(meal.organization_id,meal.meal_date,auth.uid(),'brought_food',true)
      on conflict(organization_id,lunch_date,user_id) do update set choice='brought_food',from_cooking=true;
    delete from public.daily_lunch_votes where organization_id=meal.organization_id
      and lunch_date=meal.meal_date and user_id=auth.uid();
  end if;
end;
$$;
create or replace function public.set_lunch_response(org uuid, answer text) returns void language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day();
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if answer = 'not_in_office' then answer := 'no_lunch'; end if;
  if answer is not null and answer not in ('going_out','brought_food','no_lunch','ordering_in') then raise exception 'Choose a valid lunch answer'; end if;
  if answer is null then
    delete from public.daily_lunch_responses where organization_id=org and lunch_date=today and user_id=auth.uid();
  else
    insert into public.daily_lunch_responses(organization_id,lunch_date,user_id,choice,from_cooking) values(org,today,auth.uid(),answer,false)
      on conflict(organization_id,lunch_date,user_id) do update set choice=excluded.choice,from_cooking=false;
    if answer <> 'going_out' then delete from public.daily_lunch_votes where organization_id=org and lunch_date=today and user_id=auth.uid(); end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
create or replace function public.lunch_overview(org uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day(); result jsonb;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  select jsonb_build_object(
    'day',today,
    'mine',(select choice from public.daily_lunch_responses where organization_id=org and lunch_date=today and user_id=auth.uid()),
    'joinedCooking',exists(select 1 from public.cooking_event_participants p join public.cooking_events e on e.id=p.event_id
      where e.organization_id=org and e.meal_date=today and p.user_id=auth.uid()),
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

notify pgrst, 'reload schema';
