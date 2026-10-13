-- Preserve established OSM values such as tex-mex, including their hyphens.
create or replace function public.set_place_cuisines(org uuid, osm_place_id text, cuisines text[])
returns void language plpgsql security definer set search_path = '' as $$
declare normalized text[];
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if osm_place_id is null or osm_place_id !~ '^osm:(node|way|relation):[1-9][0-9]{0,18}$' then
    raise exception 'Select an OpenStreetMap place';
  end if;
  if not exists(select 1 from public.places where id=osm_place_id and provider='osm') or
    not (exists(select 1 from public.reviews where organization_id=org and place_id=osm_place_id)
      or exists(select 1 from public.osm_region_cache c, jsonb_array_elements(c.places) p
        where c.organization_id=org and p->>'id'=osm_place_id)) then
    raise exception 'Select a place reviewed or found by this organization';
  end if;
  if cuisines is null or cardinality(cuisines)>8 or exists(
    select 1 from unnest(cuisines) value where value is null or value !~ '^[a-z][a-z0-9_-]{0,39}$' or value='unknown'
  ) then raise exception 'Use up to 8 cuisines, with letters, numbers, underscores and hyphens'; end if;
  if cardinality(cuisines)=0 then
    delete from public.place_cuisine_overrides where organization_id=org and place_id=osm_place_id;
    return;
  end if;
  select array_agg(value order by first_index) into normalized from (
    select value,min(position) first_index from unnest(cuisines) with ordinality t(value,position) group by value
  ) unique_values;
  insert into public.place_cuisine_overrides(organization_id,place_id,cuisines,updated_by)
    values(org,osm_place_id,normalized,auth.uid())
    on conflict(organization_id,place_id) do update set cuisines=excluded.cuisines,
      updated_by=excluded.updated_by,updated_at=clock_timestamp();
end;
$$;
revoke all on function public.set_place_cuisines(uuid,text,text[]) from public,anon;
grant execute on function public.set_place_cuisines(uuid,text,text[]) to authenticated;
