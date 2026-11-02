-- Following feed: posts from the people the logged-in user follows.
--
-- Before this the browser first downloaded the list of followed ids and then sent them back in
-- the address of the request (user_id=in.(...)). That broke at about 400 followed people (the
-- address got too long, HTTP 414) and the list itself was cut at 1000 rows (the PostgREST row
-- limit). Here the database does the filtering, so nothing is sent back and forth and there is
-- no limit on how many people a user can follow.
--
-- It is a view on top of posts_feed, so it has the same columns and the same security:
-- security_invoker makes the row level security policies and auth.uid() of the caller apply.
create or replace view posts_following_feed
with (security_invoker = true) as
select pf.*
from posts_feed pf
where exists (
  select 1 from follows f
  where f.follower_id = auth.uid() and f.following_id = pf.user_id
);

-- Supabase gives every new object in the public schema to all API roles. This view is only for
-- logged-in users, and only for reading.
revoke all on posts_following_feed from anon, authenticated;
grant select on posts_following_feed to authenticated;
