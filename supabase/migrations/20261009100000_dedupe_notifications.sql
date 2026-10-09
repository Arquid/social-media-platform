-- Stop notification spam from repeated actions.
--
-- Before this migration, "like, unlike, like" or "follow, unfollow, follow" created a new
-- notification every time. Now a person can only produce one like notification per post and
-- one follow notification per user. Comments are different: every comment is a new event,
-- so each one still notifies.

-- ========== 1. Remove existing duplicates (keep the oldest of each group) ==========
delete from notifications n
using notifications older
where n.type in ('like', 'follow')
  and older.type = n.type
  and older.user_id = n.user_id
  and older.actor_id = n.actor_id
  and older.post_id is not distinct from n.post_id
  and older.id < n.id;

-- ========== 2. Make duplicates impossible ==========
create unique index notifications_unique_like
  on notifications (user_id, actor_id, post_id)
  where type = 'like';

create unique index notifications_unique_follow
  on notifications (user_id, actor_id)
  where type = 'follow';

-- ========== 3. Triggers: ignore the insert when the notification already exists ==========
create or replace function notify_like() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor_id, type, post_id)
  select p.user_id, new.user_id, 'like', new.post_id
  from posts p
  where p.id = new.post_id and p.user_id <> new.user_id
  on conflict do nothing;
  return new;
end;
$$;

create or replace function notify_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow')
  on conflict do nothing;
  return new;
end;
$$;
