-- Pagination for notifications, comments and the user search.
--
-- Until now the notification list showed the newest 50, the comments of a post were all loaded at
-- once and the search stopped at 20 people. The app now loads 20 at a time and asks for more.
--
-- Notifications and comments are paged by their id ("the 20 below the oldest one on the screen").
-- The id grows with time, so it is as good as the creation time for ordering, and unlike the
-- time it is unique, so no row can be skipped or shown twice. Each list gets an index that is
-- made for exactly that question, so a page costs the same however long the list is.

-- Notifications of one user, newest first. Replaces the index on (user_id, created_at): the
-- list is no longer sorted by time, and the unread counter only needs user_id.
create index notifications_user_id_id_idx on notifications (user_id, id desc);
drop index notifications_user_id_created_at_idx;

-- Comments of one post, newest first. Replaces the index on post_id alone: this one starts with
-- post_id too, so counting the comments of a post still uses it.
create index comments_post_id_id_idx on comments (post_id, id desc);
drop index comments_post_id_idx;

-- The search gets a page size and a starting point. The order already ends with the username, which
-- is unique, so the same text always gives the same order and pages do not overlap.
-- The old version with one argument is removed: two versions would make calls with only the text
-- ambiguous.
drop function search_profiles(text);

create function search_profiles(search_text text, result_limit int default 20, result_offset int default 0)
returns table (id uuid, username text, display_name text, bio text, avatar_path text)
language sql
stable
set search_path = public, extensions
as $$
  with term as (
    select
      btrim(coalesce(search_text, '')) as raw,
      -- Make \, % and _ ordinary characters inside a LIKE pattern
      replace(replace(replace(btrim(coalesce(search_text, '')), '\', '\\'), '%', '\%'), '_', '\_') as escaped
  )
  select p.id, p.username, p.display_name, p.bio, p.avatar_path
  from profiles p, term
  where char_length(term.raw) >= 2
    and (p.username ilike '%' || term.escaped || '%'
         or p.display_name ilike '%' || term.escaped || '%')
  order by
    (lower(p.username) = lower(term.raw)) desc,            -- exact username
    (p.username ilike term.escaped || '%') desc,           -- username starts with the text
    (p.display_name ilike term.escaped || '%') desc,       -- display name starts with the text
    p.username
  -- A page is between 1 and 50 people; a missing or negative start means the beginning
  limit least(greatest(coalesce(result_limit, 20), 1), 50)
  offset greatest(coalesce(result_offset, 0), 0);
$$;

revoke execute on function search_profiles(text, int, int) from public, anon;
grant execute on function search_profiles(text, int, int) to authenticated;
