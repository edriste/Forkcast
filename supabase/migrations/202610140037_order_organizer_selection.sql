-- Preserve the original creation RPC for existing clients.
create function public.create_office_order_for_member(org uuid, meal_date date, restaurant_name text, menu text,
  deadline timestamptz, address text, instructions text, paypal text, organizer uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  perform 1 from public.organizations where id=org for update;
  if not found or not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=organizer) then
    raise exception 'Choose an organizer who belongs to this organization';
  end if;
  result:=public.create_office_order(org,meal_date,restaurant_name,menu,deadline,address,instructions,paypal);
  update public.office_orders set organizer_id=organizer where id=result;
  return result;
end;
$$;
revoke all on function public.create_office_order_for_member(uuid,date,text,text,timestamptz,text,text,text,uuid) from public,anon;
grant execute on function public.create_office_order_for_member(uuid,date,text,text,timestamptz,text,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
