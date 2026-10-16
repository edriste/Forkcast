-- Browser push is opt-in. Endpoints/keys belong only to their user and the delivery worker.
create schema if not exists forkcast_private;
revoke all on schema forkcast_private from public;
create table public.web_push_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz not null default clock_timestamp(),
  locale text not null default 'en' check(locale in ('en','de')),
  timezone text not null default 'Europe/Berlin',
  quiet_start integer not null default 22 check(quiet_start between 0 and 23),
  quiet_end integer not null default 8 check(quiet_end between 0 and 23),
  daily_limit integer not null default 3 check(daily_limit between 1 and 3),
  cooking boolean not null default true,
  deadlines boolean not null default true,
  arrivals boolean not null default true,
  replies boolean not null default true,
  payments boolean not null default false,
  organizer boolean not null default false,
  last_active_at timestamptz,
  last_sent_at timestamptz,
  last_payment_at timestamptz,
  budget_day date,
  sent_today integer not null default 0
);
create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check(char_length(endpoint)<=2048 and endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com)/[^#[:space:]]+$'),
  p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null check(auth ~ '^[A-Za-z0-9_-]{22}$'),
  created_at timestamptz not null default now()
);
create index web_push_devices_user on public.web_push_subscriptions(user_id);
alter table public.web_push_preferences enable row level security;
alter table public.web_push_subscriptions enable row level security;
revoke all on public.web_push_preferences,public.web_push_subscriptions from public,anon,authenticated;
grant all on public.web_push_preferences,public.web_push_subscriptions to service_role;

create table forkcast_private.push_events (
  id uuid primary key default gen_random_uuid(),
  dedupe text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid references public.cooking_events(id) on delete cascade,
  order_id uuid references public.office_orders(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete cascade,
  deadline timestamptz,
  category text not null check(category in ('cooking','deadlines','arrivals','replies','payments','organizer')),
  available_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  handled_at timestamptz
);
revoke all on forkcast_private.push_events from public,anon,authenticated;
create index push_pending on forkcast_private.push_events(available_at,user_id) where handled_at is null;

create function public.web_push_settings() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.web_push_preferences(user_id) values(auth.uid()) on conflict do nothing;
  return jsonb_build_object('preferences',(select to_jsonb(p)-'enabled_at'-'user_id'-'last_sent_at'-'last_active_at'-'last_payment_at'-'budget_day'-'sent_today' from public.web_push_preferences p where user_id=auth.uid()),
    'endpoints',coalesce((select jsonb_agg(endpoint) from public.web_push_subscriptions where user_id=auth.uid()),'[]'::jsonb));
end;
$$;
create function public.set_web_push_preferences(settings jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists(select 1 from pg_timezone_names where name=settings->>'timezone') then raise exception 'Choose a valid notification time zone.'; end if;
  insert into public.web_push_preferences(user_id) values(auth.uid()) on conflict do nothing;
  update public.web_push_preferences set enabled_at=case when not enabled and (settings->>'enabled')::boolean then clock_timestamp() else enabled_at end,enabled=(settings->>'enabled')::boolean, locale=settings->>'locale', timezone=settings->>'timezone',
    quiet_start=(settings->>'quiet_start')::integer,quiet_end=(settings->>'quiet_end')::integer,daily_limit=(settings->>'daily_limit')::integer,
    cooking=(settings->>'cooking')::boolean,deadlines=(settings->>'deadlines')::boolean,arrivals=(settings->>'arrivals')::boolean,
    replies=(settings->>'replies')::boolean,payments=(settings->>'payments')::boolean,organizer=(settings->>'organizer')::boolean where user_id=auth.uid();
  if not (settings->>'enabled')::boolean then update forkcast_private.push_events set handled_at=clock_timestamp() where user_id=auth.uid() and handled_at is null; end if;
end;
$$;
create function public.register_web_push(device_endpoint text, device_key text, device_auth text, language text, zone text) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'Choose a valid notification time zone.'; end if;
  insert into public.web_push_preferences(user_id) values(auth.uid()) on conflict do nothing;
  perform 1 from public.web_push_preferences where user_id=auth.uid() for update;
  if exists(select 1 from public.web_push_subscriptions where endpoint=device_endpoint and user_id<>auth.uid()) then raise exception 'This browser is registered to another account. Subscribe again.'; end if;
  if not exists(select 1 from public.web_push_subscriptions where endpoint=device_endpoint) and (select count(*) from public.web_push_subscriptions where user_id=auth.uid())>=3 then raise exception 'Up to three devices can receive push notifications. Remove a device first.'; end if;
  insert into public.web_push_subscriptions(user_id,endpoint,p256dh,auth) values(auth.uid(),device_endpoint,device_key,device_auth)
    on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth where web_push_subscriptions.user_id=auth.uid();
  if not found then raise exception 'This browser is registered to another account. Subscribe again.'; end if;
  update public.web_push_preferences set enabled_at=case when not enabled then clock_timestamp() else enabled_at end,enabled=true,locale=language,timezone=zone where user_id=auth.uid();
end;
$$;
create function public.unregister_web_push(device_endpoint text default null) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform 1 from public.web_push_preferences where user_id=auth.uid() for update;
  delete from public.web_push_subscriptions where user_id=auth.uid() and (device_endpoint is null or endpoint=device_endpoint);
  if not exists(select 1 from public.web_push_subscriptions where user_id=auth.uid()) then
    update public.web_push_preferences set enabled=false where user_id=auth.uid();
    update forkcast_private.push_events set handled_at=clock_timestamp() where user_id=auth.uid() and handled_at is null;
  end if;
end;
$$;
create function public.touch_web_push(device_endpoint text, language text default null, zone text default null) returns void language sql security definer set search_path='' as $$
  update public.web_push_preferences set last_active_at=clock_timestamp(),locale=case when language in ('en','de') then language else locale end,
    timezone=case when exists(select 1 from pg_timezone_names where name=zone) then zone else timezone end
  where user_id=auth.uid() and enabled and exists(select 1 from public.web_push_subscriptions where user_id=auth.uid() and endpoint=device_endpoint);
$$;
revoke all on function public.web_push_settings(),public.set_web_push_preferences(jsonb),public.register_web_push(text,text,text,text,text),public.unregister_web_push(text),public.touch_web_push(text,text,text) from public,anon;
grant execute on function public.web_push_settings(),public.set_web_push_preferences(jsonb),public.register_web_push(text,text,text,text,text),public.unregister_web_push(text),public.touch_web_push(text,text,text) to authenticated;

alter table public.notifications add column comment_id uuid references public.cooking_comments(id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in ('cooking_scheduled','payment_due','payment_received','payment_confirmed','cooking_joined','cooking_reply','order_started','order_deadline','order_placed','order_arrived','order_payment_due','order_payment_received','order_payment_confirmed'));
alter function public.cooking_notification_inbox(uuid) rename to legacy_cooking_notification_inbox;
create function public.cooking_notification_inbox(org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous jsonb; replies jsonb; unread_count bigint;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  previous:=public.legacy_cooking_notification_inbox(org);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb),count(*) filter(where r.read_at is null) into replies,unread_count from (
    select n.*,e.title,e.meal_date,e.signup_deadline,e.price_cents,a.display_name as actor_name,null::integer as portions
    from public.notifications n join public.cooking_events e on e.id=n.event_id join public.profiles a on a.id=n.actor_id
    where n.organization_id=org and n.recipient_id=auth.uid() and n.kind='cooking_reply' and n.dismissed_at is null
  ) r;
  return jsonb_build_object('items',(previous->'items')||replies,'unread',(previous->>'unread')::bigint+unread_count);
end;
$$;
revoke all on function public.cooking_notification_inbox(uuid),public.legacy_cooking_notification_inbox(uuid) from public,anon,authenticated;

create function forkcast_private.queue_notification_push() returns trigger language plpgsql security definer set search_path='' as $$
declare category text;
begin
  category:=case when new.kind in ('cooking_scheduled','order_started') then 'cooking' when new.kind='order_arrived' then 'arrivals'
    when new.kind='order_deadline' then 'deadlines' when new.kind='cooking_reply' then 'replies' when new.kind in ('cooking_joined','payment_received','order_payment_received') then 'organizer' end;
  if category is null or not exists(select 1 from public.web_push_preferences where user_id=new.recipient_id and enabled) then return null; end if;
  insert into forkcast_private.push_events(dedupe,user_id,organization_id,event_id,order_id,notification_id,category,available_at,expires_at)
    values('notice:'||new.id||':'||new.created_at,new.recipient_id,new.organization_id,new.event_id,new.order_id,new.id,category,
      greatest(clock_timestamp(),new.created_at)+case when category='arrivals' then interval '0 seconds' else interval '5 minutes' end,
      greatest(clock_timestamp(),new.created_at)+case when category='arrivals' then interval '15 minutes' when category='deadlines' then interval '10 minutes' else interval '24 hours' end)
    on conflict(dedupe) do nothing;
  return null;
end;
$$;
create trigger web_push_notice after insert or update of created_at on public.notifications for each row execute function forkcast_private.queue_notification_push();
create function forkcast_private.queue_comment_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(organization_id,recipient_id,event_id,actor_id,kind,comment_id)
    select e.organization_id,m.user_id,e.id,new.author_id,'cooking_reply',new.id
    from public.cooking_events e join public.organization_memberships m on m.organization_id=e.organization_id
    where e.id=new.event_id and m.user_id<>new.author_id and (m.user_id=e.organizer_id or exists(select 1 from public.cooking_comments c where c.event_id=e.id and c.author_id=m.user_id and c.id<>new.id))
    on conflict(event_id,recipient_id,kind,actor_id) do update set comment_id=excluded.comment_id,created_at=clock_timestamp(),read_at=null,dismissed_at=null;
  return null;
end;
$$;
create trigger web_push_comment after insert on public.cooking_comments for each row execute function forkcast_private.queue_comment_push();
revoke all on function forkcast_private.queue_notification_push(),forkcast_private.queue_comment_push() from public,anon,authenticated;
notify pgrst,'reload schema';

create function public.mark_cooking_comments_seen(event uuid, last_comment uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.cooking_events e where e.id=event and public.is_member(e.organization_id)) then raise exception 'Event access denied'; end if;
  update public.notifications n set read_at=clock_timestamp() from public.cooking_comments c,public.cooking_comments latest
    where n.recipient_id=auth.uid() and n.kind='cooking_reply' and n.event_id=event and n.comment_id=c.id and latest.id=last_comment and latest.event_id=event
      and (c.created_at,c.id)<=(latest.created_at,latest.id) and n.read_at is null;
  update forkcast_private.push_events q set handled_at=clock_timestamp() from public.notifications n
    where q.notification_id=n.id and n.recipient_id=auth.uid() and n.kind='cooking_reply' and n.read_at is not null and q.event_id=event and q.handled_at is null;
end;
$$;
revoke all on function public.mark_cooking_comments_seen(uuid,uuid) from public,anon;
grant execute on function public.mark_cooking_comments_seen(uuid,uuid) to authenticated;

create index cooking_push_deadlines on public.cooking_events(signup_deadline) where signup_deadline is not null;
