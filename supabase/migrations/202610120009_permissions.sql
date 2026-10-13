-- Supabase projects may grant table DML through default privileges. Explicitly
-- remove those grants so the transactional RPCs cannot be bypassed.
revoke all on public.profiles,public.organizations,public.organization_memberships,public.organization_invites,public.places,public.reviews,public.cooking_events,public.cooking_event_participants,public.event_images,public.place_ratings from public,anon,authenticated;
grant select on public.profiles,public.organizations,public.organization_memberships,public.places,public.reviews,public.cooking_events,public.cooking_event_participants,public.event_images,public.place_ratings to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant insert,delete on public.event_images to authenticated;
revoke all on function public.handle_new_user(),public.is_member(uuid),public.create_organization(text,text),public.join_organization(text),public.organization_invite(uuid,boolean),public.add_review(uuid,text,integer,text,text),public.create_cooking_event(uuid,date,text,text,integer,integer,text),public.set_portions(uuid,integer),public.can_access_event_image(text,boolean),public.mark_payment(uuid,boolean) from public,anon;
