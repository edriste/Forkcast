alter table public.cooking_events add column flags text[] not null default '{}'::text[];
alter table public.cooking_events add constraint predefined_meal_flags check(
  flags <@ array['vegetarian','vegan','spicy','gluten_free','dairy_free']::text[]
  and array_position(flags,null) is null and cardinality(flags)<=5
);
create function public.normalize_meal_flags(values_to_check text[]) returns text[] language plpgsql immutable set search_path='' as $$
begin
  if values_to_check is null or array_position(values_to_check,null) is not null or
    not (values_to_check <@ array['vegetarian','vegan','spicy','gluten_free','dairy_free']::text[]) then
    raise exception 'Choose meal tags from the predefined options';
  end if;
  return array(select distinct value from unnest(values_to_check) as value order by value);
end;
$$;
revoke all on function public.normalize_meal_flags(text[]) from public,anon,authenticated;
drop function public.create_cooking_event(uuid,date,text,text,integer,integer,text);
create function public.create_cooking_event(org uuid, event_date date, meal_title text default null, meal_description text default null, portion_limit integer default null, portion_price integer default 0, paypal text default null, meal_flags text[] default '{}'::text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if event_date < (now() at time zone 'Europe/Berlin')::date then raise exception 'Choose today or a future date'; end if;
  insert into public.cooking_events(organization_id,organizer_id,meal_date,title,description,max_portions,price_cents,paypal_handle,flags)
  values(org,auth.uid(),event_date,nullif(trim(meal_title),''),nullif(trim(meal_description),''),portion_limit,portion_price,nullif(trim(paypal),''),public.normalize_meal_flags(meal_flags)) returning id into result;
  return result;
end;
$$;


revoke all on function public.create_cooking_event(uuid,date,text,text,integer,integer,text,text[]) from public,anon;
grant execute on function public.create_cooking_event(uuid,date,text,text,integer,integer,text,text[]) to authenticated;
create function public.set_cooking_flags(event uuid,meal_flags text[]) returns void language plpgsql security definer set search_path='' as $$
declare meal public.cooking_events;
begin
  select * into meal from public.cooking_events where id=event for update;
  if not found or not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  if meal.organizer_id<>auth.uid() then raise exception 'Only the organizer can edit meal tags'; end if;
  update public.cooking_events set flags=public.normalize_meal_flags(meal_flags) where id=event;
end;
$$;
revoke all on function public.set_cooking_flags(uuid,text[]) from public,anon;
grant execute on function public.set_cooking_flags(uuid,text[]) to authenticated;
notify pgrst,'reload schema';
