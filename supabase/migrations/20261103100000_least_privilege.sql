-- Least privilege for the API roles.
--
-- Supabase gives the roles anon (not logged in) and authenticated (logged in) every privilege on
-- every new table, view, sequence and function in the public schema: INSERT, UPDATE, DELETE,
-- TRUNCATE, TRIGGER, REFERENCES, ... The row level security policies decide which rows a user may
-- touch, but a policy that is forgotten or written wrongly then opens everything, and TRUNCATE,
-- TRIGGER and REFERENCES are not even covered by policies.
--
-- This migration removes all of that and grants back only what the app uses and the policies
-- allow. The postgres role (the owner of the tables) and service_role are not touched, so the
-- trigger functions (security definer) and the admin tools keep working.
--
-- To allow something new later, add an explicit grant in the migration that creates the object.

-- ========== TABLES AND VIEWS ==========
revoke all on all tables in schema public from anon, authenticated;

-- Reading is allowed for logged-in users (the policies "... read" are all `using (true)`).
grant select on profiles, posts, comments, likes, follows, notifications to authenticated;
grant select on posts_feed, posts_following_feed to authenticated;

-- Writing: exactly the operations that have a policy and are used by the app.
grant insert, delete on posts, comments, likes, follows to authenticated;
-- A profile is created by the sign up trigger, and users edit it (it is never deleted through the API).
grant update on profiles to authenticated;
-- Notifications are created by triggers. The only thing a user may change is the read flag, so a
-- user cannot edit who a notification is from, what it says or which post it points at.
grant update (read) on notifications to authenticated;

-- rate_limit_events is a private log that only the triggers (as owner) write and read:
-- nothing is granted on it, so the API cannot see it at all.

-- ========== SEQUENCES ==========
-- Inserting a row with a generated id needs USAGE on its sequence. The ids of notifications and
-- of the rate limit log are made inside the triggers (as owner), so those need nothing.
revoke all on all sequences in schema public from anon, authenticated;
grant usage on sequence posts_id_seq, comments_id_seq to authenticated;

-- ========== FUNCTIONS ==========
-- Functions are executable by everyone (PUBLIC) unless this is revoked. The trigger functions
-- are only called by their triggers, and the search is for logged-in users.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function search_profiles(text) to authenticated;

-- ========== OBJECTS CREATED IN THE FUTURE ==========
-- Without this every new table would again be open to anon and authenticated.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
-- New functions are also executable by PUBLIC by default; this takes that away for functions
-- created by postgres (the role that runs migrations).
alter default privileges for role postgres
  revoke execute on functions from public;
