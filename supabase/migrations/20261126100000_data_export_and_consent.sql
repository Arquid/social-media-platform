-- Terms of use, privacy policy and a person's own data.
--
-- 1. consents: a record of which version of the terms and the privacy policy a person accepted when signing up.
--    The sign up form sends the version with the other details (user metadata) and the sign up trigger writes it down.
--    The table cannot be read or changed through the API; the person gets their own rows in the export.
-- 2. export_my_data(): everything the service holds about the person who asks, as one JSON document, for the
--    button "Download my data" (the right of access and of data portability).
--      - Only the caller's own data, and only the caller can ask for it.
--      - Reports that other people made about the caller are NOT included: they are kept private for moderation.
--      - At most 5 downloads an hour, so that the heavy query cannot be used to load the database.

-- ========== 1. Consents ==========
create table consents (
  user_id uuid not null references profiles(id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

-- Row Level Security on, no policy and no privilege for the API roles: closed like the other private tables
alter table consents enable row level security;

-- The sign up trigger: as before, and now it also writes down the accepted version when the form sent one
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_version text := nullif(btrim(new.raw_user_meta_data->>'accepted_legal_version'), '');
begin
  insert into profiles (id, username, display_name)
  values (new.id, new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'username');

  if v_version is not null then
    insert into consents (user_id, version) values (new.id, left(v_version, 40));
  end if;
  return new;
end;
$$;

-- ========== 2. The export ==========
create function export_my_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_recent int;
begin
  if v_user is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;

  -- One at a time per person, and at most 5 an hour (the log is the one of the other rate limits)
  perform pg_advisory_xact_lock(hashtextextended('export:' || v_user::text, 0));
  delete from rate_limit_events where user_id = v_user and created_at < now() - interval '1 hour';
  select count(*) into v_recent
  from rate_limit_events
  where user_id = v_user and kind = 'export' and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'You can download your data 5 times an hour. Please try again later.' using errcode = 'PT429';
  end if;
  insert into rate_limit_events (user_id, kind) values (v_user, 'export');

  return jsonb_build_object(
    'exported_at', now(),
    'notes', jsonb_build_array(
      'This is the data that the service holds about you. Pictures are files: the paths below name them in the storage.',
      'Reports that other people made about you are not included: they are kept private for moderation.'
    ),
    'account', (
      select jsonb_build_object(
        'id', p.id, 'username', p.username, 'display_name', p.display_name, 'bio', p.bio,
        'avatar_path', p.avatar_path, 'created_at', p.created_at, 'email', u.email
      )
      from profiles p join auth.users u on u.id = p.id
      where p.id = v_user
    ),
    'accepted_terms', coalesce((
      select jsonb_agg(jsonb_build_object('version', c.version, 'accepted_at', c.accepted_at) order by c.accepted_at)
      from consents c where c.user_id = v_user
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'content', p.content, 'image_path', p.image_path, 'created_at', p.created_at, 'edited_at', p.edited_at
      ) order by p.id)
      from posts p where p.user_id = v_user
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'post_id', c.post_id, 'content', c.content, 'created_at', c.created_at
      ) order by c.id)
      from comments c where c.user_id = v_user
    ), '[]'::jsonb),
    'likes', coalesce((
      select jsonb_agg(jsonb_build_object('post_id', l.post_id, 'created_at', l.created_at) order by l.created_at, l.post_id)
      from likes l where l.user_id = v_user
    ), '[]'::jsonb),
    'following', coalesce((
      select jsonb_agg(jsonb_build_object('username', pr.username, 'since', f.created_at) order by f.created_at, pr.username)
      from follows f join profiles pr on pr.id = f.following_id
      where f.follower_id = v_user
    ), '[]'::jsonb),
    'followers', coalesce((
      select jsonb_agg(jsonb_build_object('username', pr.username, 'since', f.created_at) order by f.created_at, pr.username)
      from follows f join profiles pr on pr.id = f.follower_id
      where f.following_id = v_user
    ), '[]'::jsonb),
    'blocked_users', coalesce((
      select jsonb_agg(jsonb_build_object('username', pr.username, 'since', b.created_at) order by b.created_at, pr.username)
      from blocks b join profiles pr on pr.id = b.blocked_id
      where b.blocker_id = v_user
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'type', n.type, 'from_username', actor.username, 'post_id', n.post_id, 'read', n.read, 'created_at', n.created_at
      ) order by n.id)
      from notifications n join profiles actor on actor.id = n.actor_id
      where n.user_id = v_user
    ), '[]'::jsonb),
    'reports_sent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'reason', r.reason, 'details', r.details, 'about_username', about.username,
        'post_id', r.post_id, 'comment_id', r.comment_id, 'created_at', r.created_at
      ) order by r.id)
      from reports r join profiles about on about.id = r.reported_user_id
      where r.reporter_id = v_user
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function export_my_data() to authenticated;
