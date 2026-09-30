-- Speeds up "posts by user, newest first" (profile feed and Following feed)
create index if not exists posts_user_id_id_idx on posts (user_id, id desc);
