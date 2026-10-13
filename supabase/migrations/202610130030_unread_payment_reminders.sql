-- Outstanding payment reminders stay alerts until the underlying payment is resolved.
update public.notifications set read_at=null where kind='payment_due' and read_at is not null;
alter table public.notifications add constraint payment_reminders_cannot_be_read
  check(kind<>'payment_due' or read_at is null);

create or replace function public.update_notification(org uuid, notice uuid, dismiss boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare notice_kind text;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  select kind into notice_kind from public.notifications
    where id=notice and organization_id=org and recipient_id=auth.uid() for update;
  if not found then raise exception 'Notification access denied'; end if;
  if dismiss and notice_kind='payment_due' then
    raise exception 'Unpaid reminders cannot be dismissed. Mark payment or leave the lunch.';
  end if;
  if notice_kind='payment_due' then return; end if;
  update public.notifications set read_at=coalesce(read_at,now()),dismissed_at=case when dismiss then now() else dismissed_at end
    where id=notice and organization_id=org and recipient_id=auth.uid();
end;
$$;

create or replace function public.read_all_notifications(org uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  update public.notifications set read_at=now()
    where organization_id=org and recipient_id=auth.uid() and read_at is null and kind<>'payment_due';
end;
$$;
notify pgrst,'reload schema';
