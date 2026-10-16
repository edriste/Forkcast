-- Routing credentials and writes remain server-only. Cache coordinates are part of validity.
create table public.walking_distance_cache (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  place_id text not null,
  origin_latitude double precision not null check (origin_latitude between -90 and 90),
  origin_longitude double precision not null check (origin_longitude between -180 and 180),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  meters double precision check (meters >= 0 and meters < 'Infinity'::float8),
  seconds double precision check (seconds >= 0 and seconds < 'Infinity'::float8),
  refreshed_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,place_id)
);
alter table public.walking_distance_cache enable row level security;
revoke all on public.walking_distance_cache from public,anon,authenticated;
grant all on public.walking_distance_cache to service_role;

-- Shared across Edge instances: at most 29 calls/minute and 400 per rolling day.
-- Reservations count failed requests too; cache hits never reserve quota.
create table public.walking_request_gate (
  id boolean primary key default true check(id),
  available_at timestamptz not null,
  window_end timestamptz not null,
  requests integer not null
);
alter table public.walking_request_gate enable row level security;
revoke all on public.walking_request_gate from public,anon,authenticated;
grant all on public.walking_request_gate to service_role;
create function public.claim_walking_request() returns boolean
language plpgsql security definer set search_path='' as $$
declare claimed boolean;
begin
  insert into public.walking_request_gate as g(id,available_at,window_end,requests)
    values(true,clock_timestamp()+interval '2.1 seconds',clock_timestamp()+interval '24 hours',1)
  on conflict(id) do update set available_at=clock_timestamp()+interval '2.1 seconds',
    window_end=case when g.window_end <= clock_timestamp() then clock_timestamp()+interval '24 hours' else g.window_end end,
    requests=case when g.window_end <= clock_timestamp() then 1 else g.requests+1 end
  where g.available_at <= clock_timestamp() and (g.window_end <= clock_timestamp() or g.requests < 400)
  returning id into claimed;
  return coalesce(claimed,false);
end;
$$;
create function public.pause_walking_requests() returns void
language sql security definer set search_path='' as $$
  update public.walking_request_gate set available_at=greatest(available_at,clock_timestamp()+interval '1 hour') where id;
$$;
revoke all on function public.claim_walking_request(),public.pause_walking_requests() from public,anon,authenticated;
grant execute on function public.claim_walking_request(),public.pause_walking_requests() to service_role;
create trigger live_walking_distances after insert or update or delete on public.walking_distance_cache
  for each row execute function public.signal_organization_change('places');
