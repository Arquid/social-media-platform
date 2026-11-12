-- Protection against abuse: more rate limits, blocking people, and reporting.
--
-- 1. Likes, follows, blocks and reports get a rate limit, like posts and comments have
--    (a script that likes or follows thousands of times a minute is stopped).
-- 2. A user can block another user.
--      - The blocked user can no longer like, comment on or follow the blocker (HTTP 403).
--      - The blocker no longer sees the blocked user's posts, comments or notifications, in the
--        feeds, on the post page, in the counters and in the realtime messages. The hiding is done
--        by the row level security policies, so every view and query follows it.
--      - Blocking removes the follows between the two, in both directions.
-- 3. A user can report a post, a comment or a user. Nobody can read the reports through the API;
--    the owner of the app reads them in the Supabase dashboard (table "reports").
--
-- CAPTCHA for the sign up is not here: it is switched on in the Supabase dashboard together with
-- a CAPTCHA service (Authentication -> Attack Protection) and needs an account there.

-- ========== 1. The rate limit works for tables whose user column has another name ==========
-- Trigger arguments: kind, maximum per minute, message, and (new) the column that holds the user
create or replace function enforce_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
  v_max int := tg_argv[1]::int;
  v_message text := tg_argv[2];
  v_user uuid := (to_jsonb(new) ->> coalesce(tg_argv[3], 'user_id'))::uuid;
  v_recent int;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_kind || ':' || v_user::text, 0));

  delete from rate_limit_events
  where user_id = v_user and created_at < now() - interval '1 hour';

  select count(*) into v_recent
  from rate_limit_events
  where user_id = v_user
    and kind = v_kind
    and created_at > now() - interval '1 minute';

  if v_recent >= v_max then
    raise exception '%', v_message using errcode = 'PT429';
  end if;

  insert into rate_limit_events (user_id, kind) values (v_user, v_kind);
  return new;
end;
$$;

create trigger limit_like_rate
before insert on likes
for each row
execute function enforce_rate_limit('like', '60', 'You are liking too fast. Please wait a minute and try again.');

create trigger limit_follow_rate
before insert on follows
for each row
execute function enforce_rate_limit('follow', '30', 'You are following too fast. Please wait a minute and try again.', 'follower_id');

-- ========== 2. Blocking ==========
create table blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- The primary key serves "who did this user block"; this one serves the cascade when a profile is deleted
create index blocks_blocked_idx on blocks (blocked_id);

alter table blocks enable row level security;

-- Only the blocker sees and changes a block: the blocked user cannot find out through the API
create policy "blocks read own" on blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy "blocks insert own" on blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy "blocks delete own" on blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

grant select, insert, delete on blocks to authenticated;

create trigger limit_block_rate
before insert on blocks
for each row
execute function enforce_rate_limit('block', '20', 'You are blocking too fast. Please wait a minute and try again.', 'blocker_id');

-- Blocking ends the follows between the two people, in both directions
create function remove_follows_of_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from follows
  where (follower_id = new.blocker_id and following_id = new.blocked_id)
     or (follower_id = new.blocked_id and following_id = new.blocker_id);
  return new;
end;
$$;

create trigger on_block_created after insert on blocks
for each row execute function remove_follows_of_block();

-- The blocked user cannot like or comment on the blocker's posts, and nobody can follow
-- across a block. The message does not say which of the two it is.
-- (The checks start with "check_" so that they run before the rate limit and cost no quota.)
create function refuse_blocked_interaction() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
  v_refuse boolean;
begin
  if tg_table_name = 'follows' then
    v_refuse := exists (
      select 1 from blocks
      where (blocker_id = new.following_id and blocked_id = new.follower_id)
         or (blocker_id = new.follower_id and blocked_id = new.following_id)
    );
  else
    select user_id into v_author from posts where id = new.post_id;
    v_refuse := exists (
      select 1 from blocks where blocker_id = v_author and blocked_id = new.user_id
    );
  end if;

  if v_refuse then
    raise exception 'You cannot do that.' using errcode = 'PT403';
  end if;
  return new;
end;
$$;

create trigger check_block_like before insert on likes
for each row execute function refuse_blocked_interaction();
create trigger check_block_comment before insert on comments
for each row execute function refuse_blocked_interaction();
create trigger check_block_follow before insert on follows
for each row execute function refuse_blocked_interaction();

-- What the blocker does not see: posts, comments and notifications of the blocked user.
-- The policies are replaced; they are otherwise as they were.
drop policy "posts read" on posts;
create policy "posts read" on posts for select to authenticated
  using (not exists (
    select 1 from blocks b
    where b.blocker_id = (select auth.uid()) and b.blocked_id = posts.user_id
  ));

drop policy "comments read" on comments;
create policy "comments read" on comments for select to authenticated
  using (not exists (
    select 1 from blocks b
    where b.blocker_id = (select auth.uid()) and b.blocked_id = comments.user_id
  ));

drop policy "notifications read own" on notifications;
create policy "notifications read own" on notifications for select to authenticated
  using (
    (select auth.uid()) = user_id
    and not exists (
      select 1 from blocks b
      where b.blocker_id = (select auth.uid()) and b.blocked_id = notifications.actor_id
    )
  );

-- ========== 3. Reports ==========
create table reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references profiles(id) on delete cascade,
  -- Who is reported. For a post or a comment the database fills it in (see below), so it cannot be forged.
  reported_user_id uuid not null references profiles(id) on delete cascade,
  -- What is reported (at most one). The report stays when the post or comment is deleted.
  post_id bigint references posts(id) on delete set null,
  comment_id bigint references comments(id) on delete set null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'violence', 'other')),
  details text check (char_length(details) <= 300),
  -- A copy of the text at the time of the report: it can be edited or deleted afterwards
  content_snapshot text,
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_user_id),
  check (post_id is null or comment_id is null)
);

-- Foreign keys need an index (the cascades and the set null look rows up by them)
create index reports_reporter_idx on reports (reporter_id);
create index reports_reported_user_idx on reports (reported_user_id);
create index reports_post_idx on reports (post_id);
create index reports_comment_idx on reports (comment_id);

-- Reporting the same thing twice does nothing new
create unique index reports_unique_post on reports (reporter_id, post_id) where post_id is not null;
create unique index reports_unique_comment on reports (reporter_id, comment_id) where comment_id is not null;
create unique index reports_unique_user on reports (reporter_id, reported_user_id)
  where post_id is null and comment_id is null;

alter table reports enable row level security;

-- Users can only add reports in their own name. There is no policy for reading: the reports are
-- read by the owner in the dashboard.
create policy "reports insert own" on reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));

-- Only these columns may be set by the app (not content_snapshot, not the id or the time)
grant insert (reporter_id, reported_user_id, post_id, comment_id, reason, details) on reports to authenticated;

create function fill_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.post_id is not null then
    select user_id, left(content, 500) into new.reported_user_id, new.content_snapshot
    from posts where id = new.post_id;
  elsif new.comment_id is not null then
    select user_id, left(content, 300) into new.reported_user_id, new.content_snapshot
    from comments where id = new.comment_id;
  end if;
  return new;
end;
$$;

create trigger fill_report before insert on reports
for each row execute function fill_report();

create trigger limit_report_rate
before insert on reports
for each row
execute function enforce_rate_limit('report', '5', 'You are sending reports too fast. Please wait a minute and try again.', 'reporter_id');
