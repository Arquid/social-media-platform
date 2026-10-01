-- Profile editing and avatars.

-- ========== PROFILE COLUMNS AND LIMITS ==========
-- Path of the avatar file inside the "avatars" storage bucket, e.g. "<user id>/1712345678.png"
alter table profiles add column avatar_path text;

alter table profiles
  add constraint profiles_display_name_length
  check (display_name is null or char_length(display_name) <= 50);

alter table profiles
  add constraint profiles_bio_length
  check (bio is null or char_length(bio) <= 160);

-- A user may only point their profile at a file in their own storage folder
alter table profiles
  add constraint profiles_avatar_path_own_folder
  check (avatar_path is null or avatar_path like (id::text || '/%'));

-- ========== AVATAR STORAGE BUCKET ==========
-- Public bucket: anyone can view avatar images by URL, only the owner can change them.
-- Limits are enforced by the storage service: max 2 MB, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Files live in a folder named after the user id: "<user id>/<file>"
-- (select is needed by the storage API when deleting files)
create policy "avatars select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars update own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ========== FEED VIEW: add the author's avatar ==========
-- New columns can only be added at the end of an existing view
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
  pr.avatar_path
from posts p
join profiles pr on pr.id = p.user_id;
