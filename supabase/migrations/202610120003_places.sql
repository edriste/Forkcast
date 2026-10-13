create table public.places (
  id text primary key check (char_length(id) between 1 and 255)
);
alter table public.places enable row level security;
-- A Place is only an external identifier. All business information comes from Google.
create policy read_place_ids on public.places for select to authenticated using (true);
grant select on public.places to authenticated;
