-- Private in-app inbox. Cooking/payment writes deliver notifications transactionally.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.cooking_events(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('cooking_scheduled','payment_due','payment_received')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  unique(event_id,recipient_id,kind,actor_id)
);
create index notifications_inbox on public.notifications(organization_id,recipient_id,created_at desc);
alter table public.notifications enable row level security;
create policy own_notifications on public.notifications for select to authenticated
  using(recipient_id=auth.uid() and public.is_member(organization_id));
revoke all on public.notifications from public,anon,authenticated;
grant select on public.notifications to authenticated;

create function public.notify_cooking_scheduled() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(organization_id,recipient_id,event_id,actor_id,kind)
    select new.organization_id,m.user_id,new.id,new.organizer_id,'cooking_scheduled'
    from public.organization_memberships m where m.organization_id=new.organization_id and m.user_id<>new.organizer_id;
  return new;
end;
$$;
create trigger cooking_scheduled_notification after insert on public.cooking_events
  for each row execute function public.notify_cooking_scheduled();

create function public.notify_cooking_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare meal public.cooking_events;
begin
  if tg_op='DELETE' then
    delete from public.notifications where event_id=old.event_id and actor_id=old.user_id and kind in ('payment_due','payment_received');
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.paid=old.paid and new.portions=old.portions then return new; end if;
  end if;
  select * into meal from public.cooking_events where id=new.event_id;
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
create trigger cooking_payment_notification after insert or update or delete on public.cooking_event_participants
  for each row execute function public.notify_cooking_payment();

-- Include upcoming invitations and existing outstanding payments on upgrade.
insert into public.notifications(organization_id,recipient_id,event_id,actor_id,kind)
  select e.organization_id,m.user_id,e.id,e.organizer_id,'cooking_scheduled' from public.cooking_events e
  join public.organization_memberships m on m.organization_id=e.organization_id
  where e.meal_date>=public.lunch_day() and m.user_id<>e.organizer_id on conflict do nothing;
insert into public.notifications(organization_id,recipient_id,event_id,actor_id,kind)
  select e.organization_id,p.user_id,e.id,p.user_id,'payment_due' from public.cooking_events e
  join public.cooking_event_participants p on p.event_id=e.id where e.price_cents>0 and not p.paid on conflict do nothing;

create function public.notification_inbox(org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  with visible as (
    select n.*,e.title,e.meal_date,e.price_cents,a.display_name as actor_name,p.portions,p.paid
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
create function public.update_notification(org uuid, notice uuid, dismiss boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  update public.notifications set read_at=coalesce(read_at,now()),dismissed_at=case when dismiss then now() else dismissed_at end
    where id=notice and organization_id=org and recipient_id=auth.uid();
  if not found then raise exception 'Notification access denied'; end if;
end;
$$;
create function public.read_all_notifications(org uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  update public.notifications set read_at=now() where organization_id=org and recipient_id=auth.uid() and read_at is null;
end;
$$;
create function public.join_notification_lunch(org uuid, notice uuid) returns void language plpgsql security definer set search_path='' as $$
declare meal uuid;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  select event_id into meal from public.notifications where id=notice and organization_id=org and recipient_id=auth.uid() and kind='cooking_scheduled';
  if not found then raise exception 'Notification access denied'; end if;
  perform 1 from public.cooking_events where id=meal for update;
  -- Never overwrite an existing reservation or its payment status on a repeated quick join.
  if not exists(select 1 from public.cooking_event_participants where event_id=meal and user_id=auth.uid()) then
    perform public.set_portions(meal,1);
  end if;
  perform public.update_notification(org,notice,false);
end;
$$;
revoke all on function public.notify_cooking_scheduled(),public.notify_cooking_payment(),public.notification_inbox(uuid),public.update_notification(uuid,uuid,boolean),public.read_all_notifications(uuid),public.join_notification_lunch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.notification_inbox(uuid),public.update_notification(uuid,uuid,boolean),public.read_all_notifications(uuid),public.join_notification_lunch(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
