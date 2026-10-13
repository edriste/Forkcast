alter table public.cooking_events add column signup_deadline timestamptz;
alter table public.cooking_events add constraint valid_signup_deadline check(
  signup_deadline is null or (isfinite(signup_deadline) and (signup_deadline at time zone 'Europe/Berlin')::date <= meal_date)
);

create function public.validate_signup_deadline(meal_date date, deadline timestamptz) returns void language plpgsql set search_path='' as $$
begin
  if deadline is null then return; end if;
  if not isfinite(deadline) or deadline <= clock_timestamp() then raise exception 'Choose a signup deadline in the future.'; end if;
  if (deadline at time zone 'Europe/Berlin')::date > meal_date then raise exception 'Signup deadline must be on or before the lunch date (Berlin time).'; end if;
end;
$$;
revoke all on function public.validate_signup_deadline(date,timestamptz) from public,anon,authenticated;

drop function public.create_cooking_event(uuid,date,text,text,integer,integer,text,text[]);
create function public.create_cooking_event(org uuid, event_date date, meal_title text default null, meal_description text default null, portion_limit integer default null, portion_price integer default 0, paypal text default null, meal_flags text[] default '{}'::text[], signup_until timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if event_date < (clock_timestamp() at time zone 'Europe/Berlin')::date then raise exception 'Choose today or a future date'; end if;
  perform public.validate_signup_deadline(event_date,signup_until);
  insert into public.cooking_events(organization_id,organizer_id,meal_date,title,description,max_portions,price_cents,paypal_handle,flags,signup_deadline)
  values(org,auth.uid(),event_date,nullif(trim(meal_title),''),nullif(trim(meal_description),''),portion_limit,portion_price,nullif(trim(paypal),''),public.normalize_meal_flags(meal_flags),signup_until) returning id into result;
  return result;
end;
$$;
revoke all on function public.create_cooking_event(uuid,date,text,text,integer,integer,text,text[],timestamptz) from public,anon;
grant execute on function public.create_cooking_event(uuid,date,text,text,integer,integer,text,text[],timestamptz) to authenticated;

create function public.set_cooking_signup_deadline(event uuid, deadline timestamptz default null, close_now boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare meal public.cooking_events;
begin
  select * into meal from public.cooking_events where id=event for update;
  if not found or not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  if meal.organizer_id<>auth.uid() then raise exception 'Only the organizer can change the signup deadline.'; end if;
  if meal.meal_date < (clock_timestamp() at time zone 'Europe/Berlin')::date then raise exception 'This lunch has already passed'; end if;
  if close_now is null then raise exception 'Choose whether to close signup now.'; end if;
  if close_now then
    if deadline is not null then raise exception 'Choose a deadline or close signup now.'; end if;
    deadline := clock_timestamp();
  else
    perform public.validate_signup_deadline(meal.meal_date,deadline);
  end if;
  update public.cooking_events set signup_deadline=deadline where id=event;
end;
$$;
revoke all on function public.set_cooking_signup_deadline(uuid,timestamptz,boolean) from public,anon;
grant execute on function public.set_cooking_signup_deadline(uuid,timestamptz,boolean) to authenticated;

create or replace function public.set_portions(event uuid, quantity integer) returns void language plpgsql security definer set search_path = '' as $$
declare meal public.cooking_events; reserved bigint; was_joined boolean; previous_portions integer;
begin
  select * into meal from public.cooking_events where id = event for update;
  if not found or not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  if meal.meal_date < (now() at time zone 'Europe/Berlin')::date then raise exception 'This lunch has already passed'; end if;
  if quantity is null or quantity < 0 or quantity > 10000 then raise exception 'Choose between 0 and 10000 portions'; end if;
  -- Cooking capacity keeps its event lock; attendance edits serialize on the group.
  perform 1 from public.organizations where id=meal.organization_id for update;
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
    paid = case when cooking_event_participants.portions = excluded.portions then cooking_event_participants.paid else false end;
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

create or replace function public.notification_inbox(org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  with visible as (
    select n.*,e.title,e.meal_date,e.signup_deadline,e.price_cents,a.display_name as actor_name,p.portions,p.paid
    from public.notifications n join public.cooking_events e on e.id=n.event_id
    join public.profiles a on a.id=n.actor_id
    left join public.cooking_event_participants p on p.event_id=n.event_id and p.user_id=n.actor_id
    where n.organization_id=org and n.recipient_id=auth.uid() and n.dismissed_at is null and
      ((n.kind='cooking_scheduled' and e.meal_date>=public.lunch_day() and not exists(select 1 from public.cooking_event_participants mine where mine.event_id=e.id and mine.user_id=auth.uid()))
       or (n.kind='payment_due' and p.paid=false and e.price_cents>0)
       or (n.kind='payment_received' and p.paid=true and e.price_cents>0 and e.organizer_id=auth.uid()))
  ) select jsonb_build_object('unread', (select count(*) from visible where read_at is null),
    'items',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id) from
      (select * from visible order by created_at desc,id limit 100) v),'[]'::jsonb)) into result;
  return result;
end;
$$;
notify pgrst,'reload schema';
