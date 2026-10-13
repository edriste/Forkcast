create table public.office_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  organizer_id uuid not null references public.profiles(id),
  order_date date not null,
  restaurant text not null check(char_length(trim(restaurant)) between 1 and 120),
  menu_url text not null check(menu_url ~ '^https?://[^[:space:]]+$' and char_length(menu_url)<=2000),
  signup_deadline timestamptz not null,
  delivery_address text not null check(char_length(trim(delivery_address)) between 1 and 500),
  delivery_notes text not null default '' check(char_length(delivery_notes)<=1000),
  paypal_handle text check(paypal_handle ~ '^[A-Za-z0-9]{1,20}$'),
  status text not null default 'open' check(status in ('open','closed','placed','arrived','cancelled')),
  delivery_fee_cents integer not null default 0 check(delivery_fee_cents between 0 and 100000),
  arrival_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index office_orders_org_date on public.office_orders(organization_id,order_date,id);
create table public.office_order_members (
  order_id uuid not null references public.office_orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  ready boolean not null default false,
  revision integer not null default 1,
  total_cents integer check(total_cents between 0 and 501000000),
  paid boolean not null default false,
  payment_confirmed_at timestamptz,
  primary key(order_id,user_id),
  check(payment_confirmed_at is null or paid)
);
create table public.office_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  user_id uuid not null,
  item_name text not null check(char_length(trim(item_name)) between 1 and 120),
  quantity integer not null check(quantity between 1 and 100),
  unit_cents integer not null check(unit_cents between 0 and 100000),
  notes text not null default '' check(char_length(notes)<=500),
  foreign key(order_id,user_id) references public.office_order_members(order_id,user_id) on delete cascade
);
create index office_order_items_lookup on public.office_order_items(order_id,user_id,id);
alter table public.office_orders enable row level security;
alter table public.office_order_members enable row level security;
alter table public.office_order_items enable row level security;
create policy member_office_orders on public.office_orders for select to authenticated using(public.is_member(organization_id));
create policy member_office_order_members on public.office_order_members for select to authenticated using(exists(select 1 from public.office_orders o where o.id=order_id and public.is_member(o.organization_id)));
create policy member_office_order_items on public.office_order_items for select to authenticated using(exists(select 1 from public.office_orders o where o.id=order_id and public.is_member(o.organization_id)));
revoke all on public.office_orders,public.office_order_members,public.office_order_items from public,anon,authenticated;
grant select on public.office_orders,public.office_order_members,public.office_order_items to authenticated;
alter table public.organization_signals drop constraint organization_signals_topic_check;
alter table public.organization_signals add constraint organization_signals_topic_check check(topic in ('organization','places','cooking','lunch','images','orders'));
create trigger live_orders after insert or update or delete on public.office_orders for each row execute function public.signal_organization_change('orders');

alter table public.daily_lunch_responses add column from_order uuid references public.office_orders(id) on delete set null;
create function public.clear_order_attendance(order_key uuid, colleague uuid) returns void language plpgsql security definer set search_path='' as $$
declare meal public.office_orders; replacement uuid;
begin
  select * into meal from public.office_orders where id=order_key;
  select o.id into replacement from public.office_order_members m join public.office_orders o on o.id=m.order_id
    where m.user_id=colleague and o.id<>order_key and o.organization_id=meal.organization_id and o.order_date=meal.order_date and o.status<>'cancelled' order by o.id limit 1;
  if replacement is not null then
    update public.daily_lunch_responses set from_order=replacement where organization_id=meal.organization_id and lunch_date=meal.order_date and user_id=colleague and from_order=order_key and choice='ordering_in';
  else
    delete from public.daily_lunch_responses where organization_id=meal.organization_id and lunch_date=meal.order_date and user_id=colleague and from_order=order_key and choice='ordering_in';
  end if;
end;
$$;
revoke all on function public.clear_order_attendance(uuid,uuid) from public,anon,authenticated;

create function public.lock_office_order(order_key uuid) returns public.office_orders language plpgsql security definer set search_path='' as $$
declare meal public.office_orders;
begin
  select * into meal from public.office_orders where id=order_key for update;
  if not found then raise exception 'Order access denied'; end if;
  perform 1 from public.organizations where id=meal.organization_id for update;
  if not public.is_member(meal.organization_id) then raise exception 'Order access denied'; end if;
  return meal;
end;
$$;
revoke all on function public.lock_office_order(uuid) from public,anon,authenticated;
create function public.create_office_order(org uuid, meal_date date, restaurant_name text, menu text, deadline timestamptz, address text, instructions text default '', paypal text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  perform 1 from public.organizations where id=org for update;
  if not found or not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if meal_date is null or meal_date<public.lunch_day() or deadline is null or deadline<=clock_timestamp() or (deadline at time zone 'Europe/Berlin')::date>meal_date then raise exception 'Choose a future order deadline on or before the order date'; end if;
  insert into public.office_orders(organization_id,organizer_id,order_date,restaurant,menu_url,signup_deadline,delivery_address,delivery_notes,paypal_handle)
    values(org,auth.uid(),meal_date,trim(restaurant_name),trim(menu),deadline,trim(address),coalesce(trim(instructions),''),nullif(trim(paypal),'')) returning id into result;
  return result;
end;
$$;
create function public.save_office_order_items(order_key uuid, items jsonb, is_ready boolean, expected_revision integer default 0) returns void language plpgsql security definer set search_path='' as $$
declare meal public.office_orders; previous_revision integer;
begin
  meal:=public.lock_office_order(order_key);
  if meal.status<>'open' or meal.order_date<public.lunch_day() or meal.signup_deadline<=clock_timestamp() then raise exception 'This order is closed for changes'; end if;
  if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 50 or is_ready is null then raise exception 'Add between 1 and 50 order items'; end if;
  select revision into previous_revision from public.office_order_members where order_id=order_key and user_id=auth.uid();
  if coalesce(previous_revision,0) is distinct from expected_revision then raise exception 'Your order changed. Reload before saving.'; end if;
  insert into public.office_order_members(order_id,user_id,ready) values(order_key,auth.uid(),is_ready)
    on conflict(order_id,user_id) do update set ready=is_ready,revision=public.office_order_members.revision+1;
  delete from public.office_order_items where order_id=order_key and user_id=auth.uid();
  insert into public.office_order_items(order_id,user_id,item_name,quantity,unit_cents,notes)
    select order_key,auth.uid(),trim(x.item_name),x.quantity,x.unit_cents,coalesce(trim(x.notes),'')
      from jsonb_to_recordset(items) as x(item_name text,quantity integer,unit_cents integer,notes text);
  update public.office_orders set version=version+1 where id=order_key;
  insert into public.daily_lunch_responses(organization_id,lunch_date,user_id,choice,from_cooking,from_order)
    values(meal.organization_id,meal.order_date,auth.uid(),'ordering_in',false,order_key)
    on conflict(organization_id,lunch_date,user_id) do update set choice='ordering_in',from_cooking=false,
      from_order=case when public.daily_lunch_responses.choice='ordering_in' and public.daily_lunch_responses.from_order is null then null else order_key end;
  delete from public.daily_lunch_votes where organization_id=meal.organization_id and lunch_date=meal.order_date and user_id=auth.uid();
end;
$$;
create function public.leave_office_order(order_key uuid, expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare meal public.office_orders;
begin
  meal:=public.lock_office_order(order_key);
  if meal.status<>'open' or meal.signup_deadline<=clock_timestamp() then raise exception 'This order is closed for changes'; end if;
  if not exists(select 1 from public.office_order_members where order_id=order_key and user_id=auth.uid() and revision=expected_revision) then raise exception 'Your order changed. Reload before saving.'; end if;
  delete from public.office_order_members where order_id=order_key and user_id=auth.uid();
  perform public.clear_order_attendance(order_key,auth.uid());
  update public.office_orders set version=version+1 where id=order_key;
end;
$$;
create function public.update_office_order(order_key uuid, expected_version integer, new_status text, fee_cents integer default 0, eta timestamptz default null, new_deadline timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
declare meal public.office_orders; member_count integer; colleague uuid;
begin
  meal:=public.lock_office_order(order_key);
  if meal.organizer_id<>auth.uid() then raise exception 'Only the order organizer can manage this order'; end if;
  if meal.version is distinct from expected_version then raise exception 'The order changed. Review the latest order before continuing.'; end if;
  if new_status is null or new_status not in ('open','closed','placed','arrived','cancelled') then raise exception 'Choose a valid order status'; end if;
  if new_status='cancelled' and meal.status not in ('open','closed') then raise exception 'A placed order cannot be cancelled in the app'; end if;
  if not (new_status='cancelled' or (meal.status in ('open','closed') and new_status in ('open','closed')) or (meal.status='closed' and new_status='placed') or (meal.status='placed' and new_status in ('placed','arrived'))) then raise exception 'This order status change is unavailable'; end if;
  if new_status='open' and coalesce(new_deadline,meal.signup_deadline)<=clock_timestamp() then raise exception 'Choose a future deadline to reopen this order'; end if;
  if new_deadline is not null and (meal.status not in ('open','closed') or new_deadline<=clock_timestamp() or (new_deadline at time zone 'Europe/Berlin')::date>meal.order_date) then raise exception 'Choose a future order deadline on or before the order date'; end if;
  if eta is not null and (eta at time zone 'Europe/Berlin')::date<>meal.order_date then raise exception 'Choose an arrival time on the order date'; end if;
  if new_status='placed' and meal.status='closed' then
    if fee_cents is null or fee_cents not between 0 and 100000 then raise exception 'Delivery fee must be between 0 and 1000 euros'; end if;
    select count(*) into member_count from public.office_order_members where order_id=order_key;
    if member_count=0 then raise exception 'Add participants before placing an order'; end if;
    with totals as (
      select m.user_id,coalesce(sum(i.quantity::bigint*i.unit_cents),0) as subtotal,row_number() over(order by m.user_id) as position
      from public.office_order_members m left join public.office_order_items i on i.order_id=m.order_id and i.user_id=m.user_id where m.order_id=order_key group by m.user_id
    ) update public.office_order_members m set total_cents=t.subtotal+fee_cents/member_count+case when t.position<=fee_cents%member_count then 1 else 0 end,
      paid=(m.user_id=auth.uid() or t.subtotal+fee_cents/member_count+case when t.position<=fee_cents%member_count then 1 else 0 end=0),
      payment_confirmed_at=case when m.user_id=auth.uid() then clock_timestamp() else null end
      from totals t where m.order_id=order_key and m.user_id=t.user_id;
  end if;
  update public.office_orders set status=new_status,delivery_fee_cents=case when meal.status='closed' and new_status='placed' then fee_cents else delivery_fee_cents end,
    arrival_at=coalesce(eta,arrival_at),signup_deadline=coalesce(new_deadline,signup_deadline),version=version+1 where id=order_key;
  if new_status='cancelled' then
    for colleague in select user_id from public.office_order_members where order_id=order_key loop perform public.clear_order_attendance(order_key,colleague); end loop;
  end if;
end;
$$;
create function public.set_office_order_payment(order_key uuid, is_paid boolean, expected_total integer) returns void language plpgsql security definer set search_path='' as $$
declare meal public.office_orders; booking public.office_order_members;
begin
  meal:=public.lock_office_order(order_key);
  if meal.status not in ('placed','arrived') then raise exception 'Payment amounts are finalized after the order is placed'; end if;
  select * into booking from public.office_order_members where order_id=order_key and user_id=auth.uid();
  if not found or booking.total_cents is distinct from expected_total or is_paid is null then raise exception 'Payment amount changed. Reload the order.'; end if;
  if booking.payment_confirmed_at is not null and not is_paid then raise exception 'The organizer already confirmed this payment'; end if;
  update public.office_order_members set paid=is_paid where order_id=order_key and user_id=auth.uid() and paid<>is_paid;
  update public.office_orders set version=version+1 where id=order_key;
end;
$$;
create function public.confirm_office_order_payment(order_key uuid, participant uuid, expected_total integer) returns void language plpgsql security definer set search_path='' as $$
declare meal public.office_orders; booking public.office_order_members;
begin
  meal:=public.lock_office_order(order_key);
  if meal.organizer_id<>auth.uid() then raise exception 'Only the order organizer can confirm payments'; end if;
  if meal.status not in ('placed','arrived') then raise exception 'Payment amounts are finalized after the order is placed'; end if;
  select * into booking from public.office_order_members where order_id=order_key and user_id=participant;
  if not found or booking.total_cents is distinct from expected_total then raise exception 'Payment amount changed. Reload the order.'; end if;
  if booking.payment_confirmed_at is not null then return; end if;
  update public.office_order_members set paid=true,payment_confirmed_at=clock_timestamp() where order_id=order_key and user_id=participant;
  update public.office_orders set version=version+1 where id=order_key;
end;
$$;
revoke all on function public.create_office_order(uuid,date,text,text,timestamptz,text,text,text),public.save_office_order_items(uuid,jsonb,boolean,integer),public.leave_office_order(uuid,integer),public.update_office_order(uuid,integer,text,integer,timestamptz,timestamptz),public.set_office_order_payment(uuid,boolean,integer),public.confirm_office_order_payment(uuid,uuid,integer) from public,anon;
grant execute on function public.create_office_order(uuid,date,text,text,timestamptz,text,text,text),public.save_office_order_items(uuid,jsonb,boolean,integer),public.leave_office_order(uuid,integer),public.update_office_order(uuid,integer,text,integer,timestamptz,timestamptz),public.set_office_order_payment(uuid,boolean,integer),public.confirm_office_order_payment(uuid,uuid,integer) to authenticated;

alter table public.notifications alter column event_id drop not null;
alter table public.notifications add column order_id uuid references public.office_orders(id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in ('cooking_scheduled','payment_due','payment_received','payment_confirmed','cooking_joined','order_started','order_deadline','order_placed','order_arrived','order_payment_due','order_payment_received','order_payment_confirmed'));
alter table public.notifications add constraint notification_target check((event_id is not null and order_id is null and kind not like 'order_%') or (event_id is null and order_id is not null and kind like 'order_%'));
create unique index order_notice_unique on public.notifications(order_id,recipient_id,kind,actor_id) where order_id is not null;
alter table public.notifications drop constraint payment_reminders_cannot_be_read;
alter table public.notifications drop constraint payment_reminders_cannot_be_dismissed;
alter table public.notifications add constraint payment_reminders_cannot_be_read check(kind not in ('payment_due','order_payment_due') or read_at is null);
alter table public.notifications add constraint payment_reminders_cannot_be_dismissed check(kind not in ('payment_due','order_payment_due') or dismissed_at is null);
create function public.office_order_notice(meal public.office_orders, recipient uuid, actor uuid, subject text, scheduled timestamptz default now()) returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.organization_memberships where organization_id=meal.organization_id and user_id=recipient) then return; end if;
  insert into public.notifications(organization_id,recipient_id,order_id,actor_id,kind,created_at)
    values(meal.organization_id,recipient,meal.id,actor,subject,scheduled)
    on conflict(order_id,recipient_id,kind,actor_id) where order_id is not null do update set created_at=excluded.created_at,read_at=null,dismissed_at=null;
end;
$$;
revoke all on function public.office_order_notice(public.office_orders,uuid,uuid,text,timestamptz) from public,anon,authenticated;
create function public.notify_office_order() returns trigger language plpgsql security definer set search_path='' as $$
declare booking public.office_order_members; colleague uuid;
begin
  if tg_op='INSERT' then
    for colleague in select user_id from public.organization_memberships where organization_id=new.organization_id and user_id<>new.organizer_id loop
      perform public.office_order_notice(new,colleague,new.organizer_id,'order_started');
    end loop;
  elsif old.status is distinct from new.status then
    if new.status in ('placed','arrived') then
      for booking in select * from public.office_order_members where order_id=new.id and user_id<>new.organizer_id loop
        perform public.office_order_notice(new,booking.user_id,new.organizer_id,'order_'||new.status);
        if new.status='placed' and not booking.paid and booking.total_cents>0 then perform public.office_order_notice(new,booking.user_id,new.organizer_id,'order_payment_due'); end if;
      end loop;
    end if;
    if new.status in ('placed','cancelled') then delete from public.notifications where order_id=new.id and kind in ('order_deadline','order_started'); end if;
  end if;
  if new.status='open' and (tg_op='INSERT' or old.signup_deadline is distinct from new.signup_deadline or old.status<>'open') then
    for booking in select * from public.office_order_members where order_id=new.id and not ready loop
      perform public.office_order_notice(new,booking.user_id,new.organizer_id,'order_deadline',greatest(new.created_at,new.signup_deadline-interval '10 minutes'));
    end loop;
  end if;
  return null;
end;
$$;
create trigger notify_office_order after insert or update on public.office_orders for each row execute function public.notify_office_order();
create function public.notify_office_order_member() returns trigger language plpgsql security definer set search_path='' as $$
declare meal public.office_orders;
begin
  select * into meal from public.office_orders where id=case when tg_op='DELETE' then old.order_id else new.order_id end;
  if meal.id is null then return null; end if;
  if tg_op='DELETE' then
    delete from public.notifications where order_id=old.order_id and recipient_id=old.user_id;
    return null;
  end if;
  if new.ready then delete from public.notifications where order_id=new.order_id and recipient_id=new.user_id and kind='order_deadline';
  elsif meal.status='open' then perform public.office_order_notice(meal,new.user_id,meal.organizer_id,'order_deadline',greatest(meal.created_at,meal.signup_deadline-interval '10 minutes')); end if;
  if meal.status in ('placed','arrived') and new.total_cents>0 then
    if new.paid then
      delete from public.notifications where order_id=new.order_id and recipient_id=new.user_id and kind='order_payment_due';
      if new.payment_confirmed_at is not null then
        delete from public.notifications where order_id=new.order_id and actor_id=new.user_id and kind='order_payment_received';
        if (tg_op='INSERT' or old.payment_confirmed_at is null) and new.user_id<>meal.organizer_id then perform public.office_order_notice(meal,new.user_id,meal.organizer_id,'order_payment_confirmed'); end if;
      elsif (tg_op='INSERT' or not old.paid) and new.user_id<>meal.organizer_id then perform public.office_order_notice(meal,meal.organizer_id,new.user_id,'order_payment_received'); end if;
    else
      delete from public.notifications where order_id=new.order_id and actor_id=new.user_id and kind='order_payment_received';
      perform public.office_order_notice(meal,new.user_id,meal.organizer_id,'order_payment_due');
    end if;
  end if;
  return null;
end;
$$;
create trigger notify_office_order_member after insert or update or delete on public.office_order_members for each row execute function public.notify_office_order_member();
revoke all on function public.notify_office_order(),public.notify_office_order_member() from public,anon,authenticated;

alter function public.notification_inbox(uuid) rename to cooking_notification_inbox;
revoke all on function public.cooking_notification_inbox(uuid) from public,anon,authenticated;
create function public.notification_inbox(org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cooking jsonb; ordering jsonb; unread_count bigint; next_change timestamptz; combined jsonb;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  cooking:=public.cooking_notification_inbox(org);
  with visible as (
    select n.*,o.restaurant as title,o.order_date as meal_date,o.signup_deadline,o.arrival_at,a.display_name as actor_name,
      coalesce(m.total_cents,0) as price_cents,1 as portions
    from public.notifications n join public.office_orders o on o.id=n.order_id join public.profiles a on a.id=n.actor_id
    left join public.office_order_members m on m.order_id=o.id and m.user_id=case when n.kind='order_payment_received' then n.actor_id else n.recipient_id end
    where n.organization_id=org and n.recipient_id=auth.uid() and n.dismissed_at is null and o.status<>'cancelled'
      and n.created_at<=clock_timestamp() and (
        (n.kind='order_started' and o.status='open' and o.signup_deadline>clock_timestamp() and o.order_date>=public.lunch_day() and m.user_id is null)
        or (n.kind='order_deadline' and o.status='open' and not m.ready and o.order_date>=public.lunch_day())
        or (n.kind in ('order_placed','order_arrived') and m.user_id is not null)
        or (n.kind='order_payment_due' and m.total_cents>0 and not m.paid)
        or (n.kind='order_payment_received' and m.paid and m.payment_confirmed_at is null and o.organizer_id=auth.uid())
        or (n.kind='order_payment_confirmed' and m.paid and m.payment_confirmed_at is not null))
  ) select count(*) filter(where read_at is null),coalesce(jsonb_agg(to_jsonb(visible) order by created_at desc,id),'[]'::jsonb) into unread_count,ordering from visible;
  select min(moment) into next_change from (
    select n.created_at as moment from public.notifications n join public.office_orders o on o.id=n.order_id
      join public.office_order_members m on m.order_id=o.id and m.user_id=n.recipient_id
      where n.organization_id=org and n.recipient_id=auth.uid() and n.kind='order_deadline' and not m.ready and o.status='open' and n.created_at>clock_timestamp()
    union all select o.signup_deadline from public.office_orders o where o.organization_id=org and o.status='open' and o.signup_deadline>clock_timestamp()
  ) future;
  select coalesce(jsonb_agg(item order by item->>'created_at' desc,item->>'id'),'[]'::jsonb) into combined from (
    select item from jsonb_array_elements((cooking->'items')||ordering) item order by item->>'created_at' desc,item->>'id' limit 100
  ) capped;
  return jsonb_build_object('unread',(cooking->>'unread')::bigint+unread_count,'items',combined,'next_update_at',next_change);
end;
$$;
revoke all on function public.notification_inbox(uuid) from public,anon;
grant execute on function public.notification_inbox(uuid) to authenticated;

create or replace function public.update_notification(org uuid, notice uuid, dismiss boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare notice_kind text;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  select kind into notice_kind from public.notifications
    where id=notice and organization_id=org and recipient_id=auth.uid() for update;
  if not found then raise exception 'Notification access denied'; end if;
  if dismiss and notice_kind in ('payment_due','order_payment_due') then
    raise exception 'Unpaid reminders cannot be dismissed. Mark payment or leave the lunch.';
  end if;
  if notice_kind in ('payment_due','order_payment_due') then return; end if;
  update public.notifications set read_at=coalesce(read_at,now()),dismissed_at=case when dismiss then now() else dismissed_at end
    where id=notice and organization_id=org and recipient_id=auth.uid();
end;
$$;

create or replace function public.read_all_notifications(org uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  update public.notifications set read_at=now()
    where organization_id=org and recipient_id=auth.uid() and read_at is null and kind not in ('payment_due','order_payment_due');
end;
$$;

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
      on conflict(organization_id,lunch_date,user_id) do update set choice=excluded.choice,from_cooking=false,from_order=null;
    if answer <> 'going_out' then delete from public.daily_lunch_votes where organization_id=org and lunch_date=today and user_id=auth.uid(); end if;
  end if;
end;
$$;

create function public.normalize_order_attendance() returns trigger language plpgsql set search_path='' as $$
begin
  if new.choice<>'ordering_in' or new.from_cooking then new.from_order:=null; end if;
  return new;
end;
$$;
revoke all on function public.normalize_order_attendance() from public,anon,authenticated;
create trigger normalize_order_attendance before insert or update on public.daily_lunch_responses for each row execute function public.normalize_order_attendance();
notify pgrst,'reload schema';
