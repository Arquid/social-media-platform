-- Rate limits for posts and comments, enforced in the database.
--
-- Without a limit, one logged-in user could flood the feed (or a script could fill the
-- database). The limits are checked by a trigger before every insert:
--   posts:    at most 10 per minute per user
--   comments: at most 20 per minute per user
--
-- When the limit is reached the insert is refused with SQLSTATE 'PT429'. PostgREST turns
-- the "PTxxx" codes into HTTP statuses, so the app receives HTTP 429 (Too Many Requests)
-- and error code "PT429".

-- ========== A log of recent actions ==========
-- The log is separate from the posts and comments tables on purpose. If the limit counted
-- the posts themselves, a user could create a post, delete it, and so free the quota again.
create table rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup_idx
  on rate_limit_events (user_id, kind, created_at desc);

-- Row Level Security on and no policies: the app cannot read or change this table.
-- Only the trigger function below (security definer) uses it.
alter table rate_limit_events enable row level security;

-- ========== The check ==========
-- Trigger arguments: kind of action, maximum per minute, error message
create function enforce_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
  v_max int := tg_argv[1]::int;
  v_message text := tg_argv[2];
  v_recent int;
begin
  -- Handle one request at a time per user and kind, so parallel requests cannot slip through
  perform pg_advisory_xact_lock(hashtextextended(v_kind || ':' || new.user_id::text, 0));

  -- Events older than an hour are no longer needed (this keeps the table small)
  delete from rate_limit_events
  where user_id = new.user_id and created_at < now() - interval '1 hour';

  select count(*) into v_recent
  from rate_limit_events
  where user_id = new.user_id
    and kind = v_kind
    and created_at > now() - interval '1 minute';

  if v_recent >= v_max then
    raise exception '%', v_message using errcode = 'PT429';
  end if;

  insert into rate_limit_events (user_id, kind) values (new.user_id, v_kind);
  return new;
end;
$$;

create trigger limit_post_rate
before insert on posts
for each row
execute function enforce_rate_limit('post', '10', 'You are posting too fast. Please wait a minute and try again.');

create trigger limit_comment_rate
before insert on comments
for each row
execute function enforce_rate_limit('comment', '20', 'You are commenting too fast. Please wait a minute and try again.');
