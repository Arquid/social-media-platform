-- Editing a post.
--
-- The author of a post can change its text. Nothing else can be changed: the privilege is given
-- for the column "content" only, so the author, the time of writing and the id stay as they are.
-- A post that has been edited carries the time of the last edit in "edited_at", and the app shows
-- "edited" next to it, so readers know the text is not the original.
--
-- (Deleting a comment needs nothing new: the policy "comments delete own" and the privilege have
-- been there from the start.)

alter table posts add column edited_at timestamptz;

-- Only the author, and only the own posts (the old text is checked, and so is the new row)
create policy "posts update own" on posts
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Column level: the text and nothing else
grant update (content) on posts to authenticated;

-- edited_at is set here, not by the app, so it cannot be left out or faked.
-- Saving the same text again is not an edit.
create function set_post_edited_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is distinct from old.content then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger posts_set_edited_at
  before update on posts
  for each row execute function set_post_edited_at();

-- The feed views get the new column. A column can only be added at the end of a view.
-- posts_following_feed is built on posts_feed ("select pf.*" is expanded when the view is
-- created), so it is replaced as well. Replacing keeps the privileges of the views.
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
  ) as liked_by_me,
  pr.avatar_path,
  p.edited_at
from posts p
join profiles pr on pr.id = p.user_id;

create or replace view posts_following_feed
with (security_invoker = true) as
select pf.*
from posts_feed pf
where exists (
  select 1 from follows f
  where f.follower_id = auth.uid() and f.following_id = pf.user_id
);
