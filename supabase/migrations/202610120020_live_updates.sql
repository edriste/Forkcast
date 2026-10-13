-- Publish small access-controlled signals, never private DELETE payloads.
create table public.organization_signals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  topic text not null check(topic in ('organization','places','cooking','lunch','images')),
  revision bigint not null default 1,
  primary key(organization_id,topic)
);
create table public.inbox_signals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  revision bigint not null default 1,
  primary key(organization_id,recipient_id)
);
alter table public.organization_signals enable row level security;
alter table public.inbox_signals enable row level security;
create policy member_live_signals on public.organization_signals for select to authenticated using(public.is_member(organization_id));
create policy own_inbox_signals on public.inbox_signals for select to authenticated using(recipient_id=auth.uid() and public.is_member(organization_id));
revoke all on public.organization_signals,public.inbox_signals from public,anon,authenticated;
grant select on public.organization_signals,public.inbox_signals to authenticated;
insert into public.organization_signals(organization_id,topic)
  select id,topic from public.organizations cross join unnest(array['organization','places','cooking','lunch','images']) topic;
create function public.bump_organization_signal(org uuid, subject text) returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.organization_signals as s(organization_id,topic) select org,subject where exists(select 1 from public.organizations where id=org)
  on conflict(organization_id,topic) do update set revision=s.revision+1;
end;
$$;
create function public.signal_organization_change() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb; org uuid;
begin
  item := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='organizations' then org := (item->>'id')::uuid;
  elsif item ? 'organization_id' then org := (item->>'organization_id')::uuid;
  else select organization_id into org from public.cooking_events where id=(item->>'event_id')::uuid;
  end if;
  if org is not null then perform public.bump_organization_signal(org,tg_argv[0]); end if;
  return null;
end;
$$;
create function public.signal_inbox_change() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
  item := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.inbox_signals as s(organization_id,recipient_id)
    select (item->>'organization_id')::uuid,(item->>'recipient_id')::uuid
    where exists(select 1 from public.organizations where id=(item->>'organization_id')::uuid)
      and exists(select 1 from public.profiles where id=(item->>'recipient_id')::uuid)
  on conflict(organization_id,recipient_id) do update set revision=s.revision+1;
  return null;
end;
$$;
create function public.signal_place_fact_change() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
  if old.metadata is distinct from new.metadata then
    for org in select distinct organization_id from public.reviews where place_id=new.id loop
      perform public.bump_organization_signal(org,'places');
    end loop;
  end if;
  return null;
end;
$$;
create trigger live_organization after update on public.organizations for each row execute function public.signal_organization_change('organization');
create trigger live_membership after insert or update or delete on public.organization_memberships for each row execute function public.signal_organization_change('organization');
create trigger live_reviews after insert or update or delete on public.reviews for each row execute function public.signal_organization_change('places');
create trigger live_cuisines after insert or update or delete on public.place_cuisine_overrides for each row execute function public.signal_organization_change('places');
create trigger live_catalogue after update of places,area_query,latitude,longitude on public.osm_region_cache for each row execute function public.signal_organization_change('places');
create trigger live_place_facts after update of metadata on public.places for each row execute function public.signal_place_fact_change();
create trigger live_cooking after insert or update or delete on public.cooking_events for each row execute function public.signal_organization_change('cooking');
create trigger live_portions after insert or update or delete on public.cooking_event_participants for each row execute function public.signal_organization_change('cooking');
create trigger live_images after insert or update or delete on public.event_images for each row execute function public.signal_organization_change('images');
create trigger live_answers after insert or update or delete on public.daily_lunch_responses for each row execute function public.signal_organization_change('lunch');
create trigger live_options after insert or update or delete on public.daily_lunch_options for each row execute function public.signal_organization_change('lunch');
create trigger live_votes after insert or update or delete on public.daily_lunch_votes for each row execute function public.signal_organization_change('lunch');
create trigger live_picks after insert or update or delete on public.daily_lunch_picks for each row execute function public.signal_organization_change('lunch');
create trigger live_inbox after insert or update or delete on public.notifications for each row execute function public.signal_inbox_change();
revoke all on function public.bump_organization_signal(uuid,text),public.signal_organization_change(),public.signal_inbox_change(),public.signal_place_fact_change() from public,anon,authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.organization_signals,public.inbox_signals;
  end if;
end $$;
notify pgrst,'reload schema';
