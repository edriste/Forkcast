-- Event discussions stay private to current organization members, including non-participants.
create table public.cooking_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.cooking_events(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 2000 and body ~ '[^[:space:]]'),
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz
);
create index cooking_comments_thread on public.cooking_comments(event_id,created_at desc,id desc);
alter table public.cooking_comments enable row level security;
create policy member_comments on public.cooking_comments for select to authenticated using (
  exists(select 1 from public.cooking_events e where e.id=event_id and public.is_member(e.organization_id))
);
revoke all on public.cooking_comments from anon,authenticated;
grant select on public.cooking_comments to authenticated;

create function public.save_cooking_comment(event uuid, comment_body text, comment_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid; result uuid;
begin
  select organization_id into org from public.cooking_events where id=event;
  if org is null or not public.is_member(org) then raise exception 'Event access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if not public.is_member(org) then raise exception 'Event access denied'; end if;
  comment_body := btrim(comment_body);
  if comment_body is null or char_length(comment_body) not between 1 and 2000 or comment_body !~ '[^[:space:]]' then
    raise exception 'Write a comment between 1 and 2000 characters.';
  end if;
  if comment_id is null then
    insert into public.cooking_comments(event_id,author_id,body) values(event,auth.uid(),comment_body) returning id into result;
  else
    update public.cooking_comments set body=comment_body,edited_at=clock_timestamp()
      where id=comment_id and event_id=event and author_id=auth.uid() returning id into result;
    if result is null then raise exception 'You can only change your own comments.'; end if;
  end if;
  return result;
end;
$$;
create function public.delete_cooking_comment(event uuid, comment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
  select organization_id into org from public.cooking_events where id=event;
  if org is null or not public.is_member(org) then raise exception 'Event access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if not public.is_member(org) then raise exception 'Event access denied'; end if;
  delete from public.cooking_comments where id=comment_id and event_id=event and author_id=auth.uid();
  if not found then raise exception 'You can only change your own comments.'; end if;
end;
$$;
revoke all on function public.save_cooking_comment(uuid,text,uuid),public.delete_cooking_comment(uuid,uuid) from public,anon;
grant execute on function public.save_cooking_comment(uuid,text,uuid),public.delete_cooking_comment(uuid,uuid) to authenticated;
create trigger live_comments after insert or update or delete on public.cooking_comments
  for each row execute function public.signal_organization_change('cooking');
