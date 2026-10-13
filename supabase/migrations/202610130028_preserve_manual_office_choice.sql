-- A pre-existing explicit office answer remains manual when joining cooking.
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
      on conflict(organization_id,lunch_date,user_id) do update set choice='brought_food',
        from_cooking=case when public.daily_lunch_responses.choice='brought_food' and not public.daily_lunch_responses.from_cooking then false else true end;
    delete from public.daily_lunch_votes where organization_id=meal.organization_id
      and lunch_date=meal.meal_date and user_id=auth.uid();
  end if;
end;
$$;
