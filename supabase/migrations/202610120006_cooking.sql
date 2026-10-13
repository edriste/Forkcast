create table public.cooking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  organizer_id uuid not null references public.profiles(id),
  meal_date date not null,
  title text check (char_length(title) <= 120),
  description text check (char_length(description) <= 4000),
  max_portions integer check (max_portions between 1 and 10000),
  price_cents integer not null default 0 check (price_cents between 0 and 10000000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  paypal_handle text check (paypal_handle ~ '^[A-Za-z0-9]{1,20}$'),
  created_at timestamptz not null default now(),
  check (price_cents = 0 or paypal_handle is not null)
);
create index events_org_date on public.cooking_events(organization_id,meal_date);
create table public.cooking_event_participants (
  event_id uuid not null references public.cooking_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  portions integer not null check (portions between 1 and 10000),
  paid boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key(event_id,user_id)
);
alter table public.cooking_events enable row level security;
alter table public.cooking_event_participants enable row level security;
create policy member_events on public.cooking_events for select to authenticated using(public.is_member(organization_id));
create policy member_participants on public.cooking_event_participants for select to authenticated using(
  exists(select 1 from public.cooking_events e where e.id = event_id and public.is_member(e.organization_id))
);
grant select on public.cooking_events,public.cooking_event_participants to authenticated;

create function public.create_cooking_event(org uuid, event_date date, meal_title text default null, meal_description text default null, portion_limit integer default null, portion_price integer default 0, paypal text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if event_date < (now() at time zone 'Europe/Berlin')::date then raise exception 'Choose today or a future date'; end if;
  insert into public.cooking_events(organization_id,organizer_id,meal_date,title,description,max_portions,price_cents,paypal_handle)
  values(org,auth.uid(),event_date,nullif(trim(meal_title),''),nullif(trim(meal_description),''),portion_limit,portion_price,nullif(trim(paypal),'')) returning id into result;
  return result;
end;
$$;

-- All participation writes acquire this same event-row lock. Table DML is not exposed.
create function public.set_portions(event uuid, quantity integer) returns void language plpgsql security definer set search_path = '' as $$
declare meal public.cooking_events; reserved bigint;
begin
  select * into meal from public.cooking_events where id = event for update;
  if not found or not public.is_member(meal.organization_id) then raise exception 'Event access denied'; end if;
  if meal.meal_date < (now() at time zone 'Europe/Berlin')::date then raise exception 'This lunch has already passed'; end if;
  if quantity is null or quantity < 0 or quantity > 10000 then raise exception 'Choose between 0 and 10000 portions'; end if;
  if quantity = 0 then delete from public.cooking_event_participants where event_id = event and user_id = auth.uid(); return; end if;
  select coalesce(sum(portions),0) into reserved from public.cooking_event_participants where event_id = event and user_id <> auth.uid();
  if meal.max_portions is not null and reserved + quantity > meal.max_portions then raise exception 'Not enough portions remaining. Refresh and choose a smaller quantity.'; end if;
  insert into public.cooking_event_participants(event_id,user_id,portions) values(event,auth.uid(),quantity)
  on conflict(event_id,user_id) do update set portions = excluded.portions,
    paid = case when cooking_event_participants.portions = excluded.portions then cooking_event_participants.paid else false end;
end;
$$;
revoke all on function public.create_cooking_event(uuid,date,text,text,integer,integer,text),public.set_portions(uuid,integer) from public;
grant execute on function public.create_cooking_event(uuid,date,text,text,integer,integer,text),public.set_portions(uuid,integer) to authenticated;
