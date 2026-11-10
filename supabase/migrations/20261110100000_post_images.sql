-- Pictures in posts.
--
-- A post can have one picture. The file lives in the storage bucket "post-images", in a folder
-- named after the author, and the post remembers its place in the column "image_path" (for
-- example "<user id>/1712345678.jpg"). This is the same arrangement as the profile pictures.

-- ========== THE STORAGE BUCKET ==========
-- Public, like the bucket of the avatars: the address of a picture works without logging in, but
-- it contains the id of the author and the time in milliseconds, so it cannot be guessed.
-- The storage service enforces the limits: max 5 MB, and only JPEG, PNG and WebP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Only the owner of the folder can add and remove files in it. There is no update policy: a
-- picture is never changed, a post gets a new one. (Select is needed by the storage service when
-- it deletes files.)
create policy "post images select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "post images insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "post images delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ========== THE POST ==========
alter table posts add column image_path text;

-- A post can only point at a file in the folder of its own author
alter table posts
  add constraint posts_image_path_own_folder
  check (image_path is null or image_path like (user_id::text || '/%'));

-- The picture cannot be changed afterwards: the privilege to update posts is on the column
-- "content" only (see the migration of editing posts), and image_path is not added to it.

-- ========== THE FEED VIEWS ==========
-- A column can only be added at the end of a view. posts_following_feed is built on posts_feed
-- ("select pf.*" is expanded when the view is created), so it is replaced as well.
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
  p.edited_at,
  p.image_path
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
