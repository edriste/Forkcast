-- Historical recommendation fields remain as archived data, but new reviews
-- need only stars and an optional comment. Legacy add_review stays compatible.
alter table public.reviews alter column recommendation drop not null;
drop view public.place_ratings;
create view public.place_ratings with (security_invoker=true) as
select organization_id,place_id,round(avg(stars),2) as average,count(*)::integer as count
from public.current_reviews group by organization_id,place_id;
revoke all on public.place_ratings from public,anon,authenticated;
grant select on public.place_ratings to authenticated;

create function public.save_review(org uuid, osm_place_id text, rating integer, review_comment text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; previous public.reviews;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if not exists(select 1 from public.places p where p.id=osm_place_id and p.provider='osm') then raise exception 'Select a verified OpenStreetMap place'; end if;
  if not exists(select 1 from public.osm_region_cache c, jsonb_array_elements(c.places) item where c.organization_id=org and item->>'id'=osm_place_id)
    and not exists(select 1 from public.reviews where organization_id=org and place_id=osm_place_id) then raise exception 'Place is not available in this organization'; end if;
  -- Serialize edits to this person's opinion; callers cannot choose another author.
  perform pg_advisory_xact_lock(hashtextextended(org::text || ':' || osm_place_id || ':' || auth.uid()::text, 0));
  select * into previous from public.reviews where organization_id=org and place_id=osm_place_id and author_id=auth.uid() order by created_at desc,id desc limit 1;
  if previous.id is not null and previous.stars=rating and previous.comment is not distinct from nullif(trim(review_comment),'') then
    return previous.id;
  end if;
  insert into public.reviews(organization_id,place_id,author_id,stars,recommendation,comment,created_at)
  values(org,osm_place_id,auth.uid(),rating,null,nullif(trim(review_comment),''),greatest(clock_timestamp(), previous.created_at + interval '1 microsecond')) returning id into result;
  return result;
end;
$$;

revoke all on function public.save_review(uuid,text,integer,text) from public,anon;
grant execute on function public.save_review(uuid,text,integer,text) to authenticated;
notify pgrst, 'reload schema';
