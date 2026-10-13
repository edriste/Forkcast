-- Personal, organization-scoped bookmarks. Restaurant facts remain shared OSM data.
create table public.restaurant_favorites (
  id uuid not null unique default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  place_id text not null references public.places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(organization_id,user_id,place_id)
);
alter table public.restaurant_favorites enable row level security;
create policy own_restaurant_favorites on public.restaurant_favorites for select to authenticated
  using(user_id=auth.uid() and public.is_member(organization_id));
revoke all on public.restaurant_favorites from public,anon,authenticated;
grant select on public.restaurant_favorites to authenticated;

create policy favorited_place_facts on public.places for select to authenticated using(
  exists(select 1 from public.restaurant_favorites f where f.place_id=places.id and f.user_id=auth.uid() and public.is_member(f.organization_id))
);
create policy shortlisted_place_facts on public.places for select to authenticated using(
  exists(select 1 from public.daily_lunch_options o where o.place_id=places.id and o.is_shortlisted and public.is_member(o.organization_id))
);

create function public.set_restaurant_favorite(org uuid, osm_place_id text, bookmarked boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if bookmarked is null then raise exception 'Choose whether to bookmark this restaurant.'; end if;
  if not bookmarked then
    delete from public.restaurant_favorites where organization_id=org and user_id=auth.uid() and place_id=osm_place_id;
    return;
  end if;
  if osm_place_id is null or not exists(select 1 from public.places p where p.id=osm_place_id and p.provider='osm') or
    not (exists(select 1 from public.reviews where organization_id=org and place_id=osm_place_id) or
      exists(select 1 from public.osm_region_cache c,jsonb_array_elements(c.places) p where c.organization_id=org and p->>'id'=osm_place_id) or
      exists(select 1 from public.restaurant_favorites f where f.organization_id=org and f.user_id=auth.uid() and f.place_id=osm_place_id) or
      exists(select 1 from public.daily_lunch_options o where o.organization_id=org and o.place_id=osm_place_id and o.is_shortlisted)) then
    raise exception 'Bookmark a restaurant reviewed or found by this organization.';
  end if;
  insert into public.restaurant_favorites(organization_id,user_id,place_id) values(org,auth.uid(),osm_place_id) on conflict do nothing;
end;
$$;
revoke all on function public.set_restaurant_favorite(uuid,text,boolean) from public,anon;
grant execute on function public.set_restaurant_favorite(uuid,text,boolean) to authenticated;

-- Reuse recipient-private refresh signals without creating an inbox notification.
create function public.bump_favorite_signal(org uuid, recipient uuid, favorite uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.inbox_signals as s(organization_id,recipient_id,notification_id)
    select org,recipient,favorite where exists(select 1 from public.organizations where id=org) and exists(select 1 from public.profiles where id=recipient)
    on conflict(organization_id,recipient_id,notification_id) do update set revision=s.revision+1;
end;
$$;
create function public.signal_favorite_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then perform public.bump_favorite_signal(old.organization_id,old.user_id,old.id);
  else perform public.bump_favorite_signal(new.organization_id,new.user_id,new.id); end if;
  return null;
end;
$$;
create trigger live_favorites after insert or delete on public.restaurant_favorites for each row execute function public.signal_favorite_change();
create function public.signal_favorite_fact_change() returns trigger language plpgsql security definer set search_path='' as $$
declare favorite record;
begin
  if old.metadata is distinct from new.metadata then
    for favorite in select id,organization_id,user_id from public.restaurant_favorites where place_id=new.id order by organization_id,user_id loop
      perform public.bump_favorite_signal(favorite.organization_id,favorite.user_id,favorite.id);
    end loop;
  end if;
  return null;
end;
$$;
create trigger live_favorite_facts after update of metadata on public.places for each row execute function public.signal_favorite_fact_change();
revoke all on function public.bump_favorite_signal(uuid,uuid,uuid),public.signal_favorite_change(),public.signal_favorite_fact_change() from public,anon,authenticated;

create or replace function public.suggest_lunch_place(org uuid, osm_place_id text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  perform 1 from public.organizations where id=org for update;
  if osm_place_id is null or not exists(select 1 from public.places p where p.id=osm_place_id and p.provider='osm') or
    not (exists(select 1 from public.reviews where organization_id=org and place_id=osm_place_id) or
      exists(select 1 from public.osm_region_cache c,jsonb_array_elements(c.places) p where c.organization_id=org and p->>'id'=osm_place_id) or
      exists(select 1 from public.restaurant_favorites f where f.organization_id=org and f.user_id=auth.uid() and f.place_id=osm_place_id) or
      exists(select 1 from public.daily_lunch_options o where o.organization_id=org and o.place_id=osm_place_id and o.is_shortlisted)) then
    raise exception 'Suggest a restaurant reviewed or found by this organization';
  end if;
  insert into public.daily_lunch_options(organization_id,lunch_date,place_id,suggested_by)
    values(org,public.lunch_day(),osm_place_id,auth.uid()) on conflict(organization_id,lunch_date,place_id) do update set is_shortlisted=true,suggested_by=coalesce(public.daily_lunch_options.suggested_by,excluded.suggested_by);
end;
$$;

notify pgrst,'reload schema';
