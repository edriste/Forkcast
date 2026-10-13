-- Google OAuth supplies full_name/name rather than the email form's display_name.
-- Keep existing names and histories; this affects new users only.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name) values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      'Colleague'
    ), 80)
  );
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public;
