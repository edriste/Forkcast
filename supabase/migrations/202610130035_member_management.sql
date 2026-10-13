-- A private account signal remains readable after membership revocation.
create table public.membership_signals (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  revision bigint not null default 1
);
alter table public.membership_signals enable row level security;
create policy own_membership_signal on public.membership_signals for select to authenticated
  using(user_id=auth.uid());
revoke all on public.membership_signals from public,anon,authenticated;
grant select on public.membership_signals to authenticated;
create function public.signal_membership_access_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare colleague uuid;
begin
  colleague := case when tg_op='DELETE' then old.user_id else new.user_id end;
  insert into public.membership_signals as s(user_id)
    select colleague where exists(select 1 from public.profiles where id=colleague)
    on conflict(user_id) do update set revision=s.revision+1;
  return null;
end;
$$;
revoke all on function public.signal_membership_access_change() from public,anon,authenticated;
create trigger membership_access_changed after insert or update or delete on public.organization_memberships
  for each row execute function public.signal_membership_access_change();
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.membership_signals;
  end if;
end $$;

-- This helper is internal; callers lock the organization and validate authority first.
create function public.delete_organization_membership(org uuid, member uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=member) then
    raise exception 'This colleague is not a member of this organization';
  end if;
  if exists(select 1 from public.organization_memberships where organization_id=org and user_id=member and role='admin')
    and (select count(*) from public.organization_memberships where organization_id=org and role='admin')<=1 then
    raise exception 'Keep at least one organization administrator';
  end if;
  -- Retain authored reviews, cooking bookings and payment history; revoke access only.
  delete from public.organization_memberships where organization_id=org and user_id=member;
end;
$$;
revoke all on function public.delete_organization_membership(uuid,uuid) from public,anon,authenticated;

create function public.remove_organization_member(org uuid, member uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.organizations where id=org for update;
  if not found or not public.is_organization_admin(org) then
    raise exception 'Only organization administrators can remove members';
  end if;
  if member=auth.uid() then raise exception 'Use Leave organization to leave yourself'; end if;
  perform public.delete_organization_membership(org,member);
  -- An expelled member must not regain access using the previous shared invitation.
  update public.organization_invites set code=replace(gen_random_uuid()::text,'-','') where organization_id=org;
end;
$$;
create function public.leave_organization(org uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.organizations where id=org for update;
  if not found or not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform public.delete_organization_membership(org,auth.uid());
end;
$$;
revoke all on function public.remove_organization_member(uuid,uuid),public.leave_organization(uuid) from public,anon;
grant execute on function public.remove_organization_member(uuid,uuid),public.leave_organization(uuid) to authenticated;

create or replace function public.join_organization(invite_code text) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select organization_id into org from public.organization_invites where code=lower(trim(invite_code));
  if org is null then raise exception 'This invite is invalid or has been rotated'; end if;
  perform 1 from public.organizations where id=org for update;
  -- Recheck after locking: removal/rotation may have invalidated a queued invitation.
  if not found or not exists(select 1 from public.organization_invites where organization_id=org and code=lower(trim(invite_code))) then
    raise exception 'This invite is invalid or has been rotated';
  end if;
  insert into public.organization_memberships(organization_id,user_id) values(org,auth.uid()) on conflict do nothing;
  return org;
end;
$$;
notify pgrst,'reload schema';

-- Existing lunch mutations must recheck membership after a queued organization lock.
create or replace function public.set_lunch_response(org uuid, answer text) returns void language plpgsql security definer set search_path = '' as $$
declare today date := public.lunch_day();
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
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

create or replace function public.suggest_lunch_place(org uuid, osm_place_id text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if osm_place_id is null or not exists(select 1 from public.places p where p.id=osm_place_id and p.provider='osm') or
    not (exists(select 1 from public.reviews where organization_id=org and place_id=osm_place_id) or
      exists(select 1 from public.osm_region_cache c,jsonb_array_elements(c.places) p where c.organization_id=org and p->>'id'=osm_place_id) or
      exists(select 1 from public.restaurant_favorites f where f.organization_id=org and f.user_id=auth.uid() and f.place_id=osm_place_id) or
      exists(select 1 from public.daily_lunch_options o where o.organization_id=org and o.place_id=osm_place_id and o.is_shortlisted)) then
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
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
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
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
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

create or replace function public.set_portions(event uuid, quantity integer) returns void language plpgsql security definer set search_path = '' as $$
declare meal public.cooking_events; reserved bigint; was_joined boolean; previous_portions integer;
begin
  select * into meal from public.cooking_events where id = event for update;
  if not found or not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  if meal.meal_date < (now() at time zone 'Europe/Berlin')::date then raise exception 'This lunch has already passed'; end if;
  if quantity is null or quantity < 0 or quantity > 10000 then raise exception 'Choose between 0 and 10000 portions'; end if;
  -- Cooking capacity keeps its event lock; attendance edits serialize on the group.
  perform 1 from public.organizations where id=meal.organization_id for update;
  if not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  select coalesce(max(portions),0) into previous_portions from public.cooking_event_participants where event_id=event and user_id=auth.uid();
  was_joined := previous_portions > 0;
  -- Check the actual time after both locks, including requests queued before the deadline.
  if meal.meal_date < (clock_timestamp() at time zone 'Europe/Berlin')::date then raise exception 'This lunch has already passed'; end if;
  if meal.signup_deadline is not null and clock_timestamp() >= meal.signup_deadline and quantity > previous_portions then
    raise exception 'Signup is closed. You can reduce portions or leave this lunch.';
  end if;
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
    paid = case when cooking_event_participants.portions = excluded.portions then cooking_event_participants.paid else false end,
    payment_confirmed_at = case when cooking_event_participants.portions = excluded.portions then cooking_event_participants.payment_confirmed_at else null end;
  if not was_joined then
    insert into public.daily_lunch_responses(organization_id,lunch_date,user_id,choice,from_cooking)
      values(meal.organization_id,meal.meal_date,auth.uid(),'brought_food',true)
      on conflict(organization_id,lunch_date,user_id) do update set choice='brought_food',
        from_cooking=case when public.daily_lunch_responses.choice='brought_food' and not public.daily_lunch_responses.from_cooking then false else true end;
    delete from public.daily_lunch_votes where organization_id=meal.organization_id
      and lunch_date=meal.meal_date and user_id=auth.uid();
  end if;
end;
$$;

