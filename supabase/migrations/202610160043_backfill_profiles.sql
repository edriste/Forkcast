-- Accounts may predate Forkcast's auth.users insert trigger, especially when
-- Google sign-in is configured before the application schema is installed.
-- Preserve existing names; only create the missing application profiles.
insert into public.profiles (id, display_name)
select id, left(coalesce(
  nullif(trim(raw_user_meta_data->>'display_name'), ''),
  nullif(trim(raw_user_meta_data->>'full_name'), ''),
  nullif(trim(raw_user_meta_data->>'name'), ''),
  'Colleague'
), 80)
from auth.users
on conflict (id) do nothing;
