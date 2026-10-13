create function public.mark_payment(event uuid, is_paid boolean) returns void language plpgsql security definer set search_path = '' as $$
declare meal public.cooking_events;
begin
  select * into meal from public.cooking_events where id=event for update;
  if not found or not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  if is_paid is null then raise exception 'Choose a payment status'; end if;
  update public.cooking_event_participants set paid=is_paid where event_id=event and user_id=auth.uid();
  if not found then raise exception 'Join this lunch before marking payment'; end if;
end;
$$;
revoke all on function public.mark_payment(uuid,boolean) from public;
grant execute on function public.mark_payment(uuid,boolean) to authenticated;
