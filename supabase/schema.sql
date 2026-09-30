-- Socialy database schema
-- Run this in the Supabase dashboard: SQL Editor -> New query -> Run

-- ========== TABLES ==========
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  bio text default '',
  created_at timestamptz default now()
);

create table posts (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz default now()
);

create table comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 300),
  created_at timestamptz default now()
);

create table likes (
  post_id bigint references posts(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);

create table follows (
  follower_id uuid references profiles(id) on delete cascade,
  following_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  actor_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'follow')),
  post_id bigint references posts(id) on delete cascade,
  read boolean default false,
  created_at timestamptz default now()
);

-- ========== AUTO-CREATE PROFILE ON SIGN UP ==========
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username, display_name)
  values (new.id, new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'username');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ========== AUTO-CREATE NOTIFICATIONS ==========
create function notify_like() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor_id, type, post_id)
  select p.user_id, new.user_id, 'like', new.post_id
  from posts p
  where p.id = new.post_id and p.user_id <> new.user_id;
  return new;
end;
$$;
create trigger on_like_created after insert on likes
for each row execute function notify_like();

create function notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor_id, type, post_id)
  select p.user_id, new.user_id, 'comment', new.post_id
  from posts p
  where p.id = new.post_id and p.user_id <> new.user_id;
  return new;
end;
$$;
create trigger on_comment_created after insert on comments
for each row execute function notify_comment();

create function notify_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow');
  return new;
end;
$$;
create trigger on_follow_created after insert on follows
for each row execute function notify_follow();

-- ========== ROW LEVEL SECURITY ==========
alter table profiles enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table likes enable row level security;
alter table follows enable row level security;
alter table notifications enable row level security;

create policy "profiles read" on profiles for select to authenticated using (true);
create policy "profiles update own" on profiles for update to authenticated using (auth.uid() = id);

create policy "posts read" on posts for select to authenticated using (true);
create policy "posts insert own" on posts for insert to authenticated with check (auth.uid() = user_id);
create policy "posts delete own" on posts for delete to authenticated using (auth.uid() = user_id);

create policy "comments read" on comments for select to authenticated using (true);
create policy "comments insert own" on comments for insert to authenticated with check (auth.uid() = user_id);
create policy "comments delete own" on comments for delete to authenticated using (auth.uid() = user_id);

create policy "likes read" on likes for select to authenticated using (true);
create policy "likes insert own" on likes for insert to authenticated with check (auth.uid() = user_id);
create policy "likes delete own" on likes for delete to authenticated using (auth.uid() = user_id);

create policy "follows read" on follows for select to authenticated using (true);
create policy "follows insert own" on follows for insert to authenticated with check (auth.uid() = follower_id);
create policy "follows delete own" on follows for delete to authenticated using (auth.uid() = follower_id);

create policy "notifications read own" on notifications for select to authenticated using (auth.uid() = user_id);
create policy "notifications update own" on notifications for update to authenticated using (auth.uid() = user_id);

-- ========== REALTIME ==========
alter publication supabase_realtime add table posts, comments, likes, notifications;
