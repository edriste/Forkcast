-- Bulk reads apply to visible notifications; scheduled deadline alerts remain unread.
create or replace function public.read_all_notifications(org uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  update public.notifications set read_at=clock_timestamp()
    where organization_id=org and recipient_id=auth.uid() and read_at is null
      and created_at<=clock_timestamp() and kind not in ('payment_due','order_payment_due');
end;
$$;
notify pgrst,'reload schema';
