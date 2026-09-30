-- Speeds up counting comments per post
create index if not exists comments_post_id_idx on comments (post_id);

-- Feed view: posts with author name and pre-computed counts.
-- security_invoker makes the view respect the caller's RLS policies
-- and lets auth.uid() return the logged-in user.
create or replace view posts_feed
with (security_invoker = true) as
select
  p.id,
  p.user_id,
  p.content,
  p.created_at,
  pr.username,
  pr.display_name,
  (select count(*) from likes l where l.post_id = p.id)::int as like_count,
  (select count(*) from comments c where c.post_id = p.id)::int as comment_count,
  exists (
    select 1 from likes l
    where l.post_id = p.id and l.user_id = auth.uid()
  ) as liked_by_me
from posts p
join profiles pr on pr.id = p.user_id;

grant select on posts_feed to authenticated;