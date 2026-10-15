-- Missing indexes.
--
-- A review with 100 000 posts, 200 000 likes and 100 000 comments found that the first page of
-- the feed took 1.4 seconds. The feed view asks "has the logged-in user liked this post?", and
-- without an index on likes(user_id) the database read every like in the table for it. With
-- this index the same request takes about 20 milliseconds, and it stays fast when the table
-- grows. The other indexes below close similar gaps: every foreign key should have an index
-- that starts with its column, otherwise deleting a row in the parent table (a user, a post)
-- has to scan the child table.

-- "Has this user liked it?" (feed, post page) and deleting a user's likes.
-- The primary key (post_id, user_id) cannot be used when only user_id is known.
create index if not exists likes_user_id_post_id_idx on likes (user_id, post_id);

-- Follower count on a profile ("who follows this person?") and deleting a profile.
-- The primary key (follower_id, following_id) only helps the other direction.
create index if not exists follows_following_id_idx on follows (following_id);

-- Deleting a user's comments.
create index if not exists comments_user_id_idx on comments (user_id);

-- The notification list and the unread counter ask for one user's notifications, newest first.
-- The unique indexes from the de-duplication migration are partial (likes only, follows only),
-- so they cannot answer this.
create index if not exists notifications_user_id_created_at_idx on notifications (user_id, created_at desc);

-- Deleting a user (as the actor) or a post removes the notifications that refer to them.
create index if not exists notifications_actor_id_idx on notifications (actor_id);
create index if not exists notifications_post_id_idx on notifications (post_id);
