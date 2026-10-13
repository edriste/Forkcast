alter table public.cooking_event_participants add column payment_confirmed_at timestamptz;
alter table public.cooking_event_participants add constraint confirmed_payment_is_paid
  check(payment_confirmed_at is null or paid);
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check(kind in ('cooking_scheduled','payment_due','payment_received','payment_confirmed','cooking_joined'));

create function public.confirm_cooking_payment(event uuid, participant uuid, expected_portions integer) returns void language plpgsql security definer set search_path='' as $$
declare meal public.cooking_events; booking public.cooking_event_participants;
begin
  select * into meal from public.cooking_events where id=event for update;
  if not found or not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  if meal.organizer_id<>auth.uid() then raise exception 'Only the organizer can confirm payment.'; end if;
  if meal.price_cents=0 then raise exception 'No payment is needed for this lunch.'; end if;
  select * into booking from public.cooking_event_participants where event_id=event and user_id=participant for update;
  if not found then raise exception 'This colleague is no longer signed up.'; end if;
  if expected_portions is null or expected_portions<>booking.portions then
    raise exception 'Portions changed. Review the current amount before confirming payment.';
  end if;
  if booking.payment_confirmed_at is not null then return; end if;
  update public.cooking_event_participants set paid=true,payment_confirmed_at=clock_timestamp()
    where event_id=event and user_id=participant;
end;
$$;
revoke all on function public.confirm_cooking_payment(uuid,uuid,integer) from public,anon;
grant execute on function public.confirm_cooking_payment(uuid,uuid,integer) to authenticated;

create or replace function public.mark_payment(event uuid, is_paid boolean) returns void language plpgsql security definer set search_path='' as $$
declare meal public.cooking_events; booking public.cooking_event_participants;
begin
  select * into meal from public.cooking_events where id=event for update;
  if not found or not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  select * into booking from public.cooking_event_participants where event_id=event and user_id=auth.uid() for update;
  if not found then raise exception 'Join this lunch before marking payment'; end if;
  if is_paid is null then raise exception 'Choose a payment status'; end if;
  if booking.payment_confirmed_at is not null and not is_paid then raise exception 'Payment has been confirmed by the organizer.'; end if;
  update public.cooking_event_participants set paid=is_paid where event_id=event and user_id=auth.uid();
end;
$$;

create or replace function public.notify_cooking_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare meal public.cooking_events;
begin
  if tg_op='DELETE' then
    delete from public.notifications where event_id=old.event_id and
      ((actor_id=old.user_id and kind in ('payment_due','payment_received')) or (recipient_id=old.user_id and kind='payment_confirmed'));
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.paid=old.paid and new.portions=old.portions and new.payment_confirmed_at is not distinct from old.payment_confirmed_at then return new; end if;
  end if;
  select * into meal from public.cooking_events where id=new.event_id;
  if new.payment_confirmed_at is not null then
    delete from public.notifications where event_id=new.event_id and actor_id=new.user_id and kind in ('payment_due','payment_received');
    insert into public.notifications(organization_id,recipient_id,event_id,actor_id,kind)
      values(meal.organization_id,new.user_id,meal.id,meal.organizer_id,'payment_confirmed')
      on conflict(event_id,recipient_id,kind,actor_id) do update set created_at=now(),read_at=null,dismissed_at=null;
    return new;
  end if;
  delete from public.notifications where event_id=new.event_id and recipient_id=new.user_id and kind='payment_confirmed';
  delete from public.notifications where event_id=new.event_id and actor_id=new.user_id
    and kind=case when new.paid then 'payment_due' else 'payment_received' end;
  if meal.price_cents>0 then
    if not new.paid then
      insert into public.notifications(organization_id,recipient_id,event_id,actor_id,kind)
        values(meal.organization_id,new.user_id,meal.id,new.user_id,'payment_due')
        on conflict(event_id,recipient_id,kind,actor_id) do update set created_at=now(),read_at=null,dismissed_at=null;
    elsif new.user_id<>meal.organizer_id then
      insert into public.notifications(organization_id,recipient_id,event_id,actor_id,kind)
        values(meal.organization_id,meal.organizer_id,meal.id,new.user_id,'payment_received')
        on conflict(event_id,recipient_id,kind,actor_id) do update set created_at=now(),read_at=null,dismissed_at=null;
    end if;
  end if;
  return new;
end;
$$;

create function public.notify_cooking_signup() returns trigger language plpgsql security definer set search_path='' as $$
declare meal public.cooking_events;
begin
  if tg_op='DELETE' then
    delete from public.notifications where event_id=old.event_id and actor_id=old.user_id and kind='cooking_joined';
    return old;
  end if;
  select * into meal from public.cooking_events where id=new.event_id;
  if new.user_id<>meal.organizer_id then
    insert into public.notifications(organization_id,recipient_id,event_id,actor_id,kind)
      values(meal.organization_id,meal.organizer_id,meal.id,new.user_id,'cooking_joined')
      on conflict(event_id,recipient_id,kind,actor_id) do update set created_at=now(),read_at=null,dismissed_at=null;
  end if;
  return new;
end;
$$;
create trigger cooking_signup_notification after insert or delete on public.cooking_event_participants
  for each row execute function public.notify_cooking_signup();
revoke all on function public.notify_cooking_signup() from public,anon,authenticated;

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

create or replace function public.notification_inbox(org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  with visible as (
    select n.*,e.title,e.meal_date,e.signup_deadline,e.price_cents,a.display_name as actor_name,p.portions,p.paid
    from public.notifications n join public.cooking_events e on e.id=n.event_id
    join public.profiles a on a.id=n.actor_id
    left join public.cooking_event_participants p on p.event_id=n.event_id and
      p.user_id=case when n.kind='payment_confirmed' then n.recipient_id else n.actor_id end
    where n.organization_id=org and n.recipient_id=auth.uid() and n.dismissed_at is null and
      ((n.kind='cooking_scheduled' and e.meal_date>=public.lunch_day() and not exists(select 1 from public.cooking_event_participants mine where mine.event_id=e.id and mine.user_id=auth.uid()))
       or (n.kind='payment_due' and p.paid=false and e.price_cents>0)
       or (n.kind='payment_received' and p.paid=true and p.payment_confirmed_at is null and e.price_cents>0 and e.organizer_id=auth.uid())
       or (n.kind='payment_confirmed' and p.paid=true and p.payment_confirmed_at is not null and e.price_cents>0)
       or (n.kind='cooking_joined' and p.portions>0 and e.organizer_id=auth.uid()))
  ) select jsonb_build_object('unread', (select count(*) from visible where read_at is null),
    'items',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id) from
      (select * from visible order by created_at desc,id limit 100) v),'[]'::jsonb)) into result;
  return result;
end;
$$;
notify pgrst,'reload schema';
