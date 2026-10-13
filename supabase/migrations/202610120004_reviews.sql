create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  place_id text not null references public.places(id),
  author_id uuid not null references public.profiles(id),
  stars smallint not null check (stars between 1 and 5),
  recommendation text not null check (recommendation in ('recommend', 'neutral', 'avoid')),
  comment text check (char_length(comment) <= 2000),
  created_at timestamptz not null default now()
);
create index reviews_org_place_date on public.reviews(organization_id, place_id, created_at desc);
alter table public.reviews enable row level security;
create policy member_reviews on public.reviews for select to authenticated using (public.is_member(organization_id));
drop policy read_place_ids on public.places;
create policy reviewed_place_ids on public.places for select to authenticated using (
  exists(select 1 from public.reviews where place_id = places.id and public.is_member(organization_id))
);
grant select on public.reviews to authenticated;
create function public.add_review(org uuid, google_place_id text, rating integer, vote text, review_comment text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not public.is_member(org) then raise exception 'Organization access denied'; end if;
  if google_place_id is null or google_place_id !~ '^[A-Za-z0-9_-]{1,255}$' then raise exception 'Invalid Google Place ID'; end if;
  insert into public.places(id) values(google_place_id) on conflict do nothing;
  insert into public.reviews(organization_id, place_id, author_id, stars, recommendation, comment)
  values(org, google_place_id, auth.uid(), rating, vote, nullif(trim(review_comment), '')) returning id into result;
  return result;
end;
$$;
revoke all on function public.add_review(uuid,text,integer,text,text) from public;
grant execute on function public.add_review(uuid,text,integer,text,text) to authenticated;
create view public.place_ratings with (security_invoker = true) as
select organization_id, place_id,
  round(avg(stars), 2) as average, count(*)::integer as count,
  count(*) filter(where recommendation = 'recommend')::integer as recommend,
  count(*) filter(where recommendation = 'neutral')::integer as neutral,
  count(*) filter(where recommendation = 'avoid')::integer as avoid
from public.reviews group by organization_id, place_id;
grant select on public.place_ratings to authenticated;
