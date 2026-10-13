create table public.event_images (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.cooking_events(id) on delete cascade,
  kind text not null check(kind in ('receipt','meal')),
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check(split_part(storage_path,'/',1) = event_id::text),
  check(storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
);
create index images_event on public.event_images(event_id);
alter table public.event_images enable row level security;
create policy read_event_images on public.event_images for select to authenticated using(
  exists(select 1 from public.cooking_events e where e.id = event_id and public.is_member(e.organization_id))
);
create policy upload_event_images on public.event_images for insert to authenticated with check(
  uploaded_by = auth.uid() and exists(select 1 from public.cooking_events e where e.id=event_id and e.organizer_id=auth.uid() and public.is_member(e.organization_id))
);
create policy delete_event_images on public.event_images for delete to authenticated using(
  exists(select 1 from public.cooking_events e where e.id=event_id and e.organizer_id=auth.uid() and public.is_member(e.organization_id))
);
grant select,insert,delete on public.event_images to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lunch-images','lunch-images',false,5242880,array['image/jpeg']) on conflict(id) do nothing;

create function public.can_access_event_image(path text, organizer_only boolean default false) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare event uuid;
begin
  if path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then return false; end if;
  begin event := split_part(path,'/',1)::uuid; exception when invalid_text_representation then return false; end;
  return exists(select 1 from public.cooking_events e where e.id = event and public.is_member(e.organization_id) and (not organizer_only or e.organizer_id = auth.uid()));
end;
$$;
revoke all on function public.can_access_event_image(text,boolean) from public;
grant execute on function public.can_access_event_image(text,boolean) to authenticated;
create policy member_image_storage on storage.objects for select to authenticated using(bucket_id='lunch-images' and public.can_access_event_image(name));
create policy organizer_image_storage_insert on storage.objects for insert to authenticated with check(bucket_id='lunch-images' and public.can_access_event_image(name,true));
create policy organizer_image_storage_delete on storage.objects for delete to authenticated using(bucket_id='lunch-images' and public.can_access_event_image(name,true));
