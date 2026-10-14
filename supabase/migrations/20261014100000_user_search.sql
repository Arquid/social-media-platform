-- User search.
--
-- The app searches people by username or display name. The search lives in a database
-- function instead of a filter built in the browser, for two reasons:
--   1. The text typed by the user is a LIKE pattern. Characters such as % and _ would act as
--      wildcards ("a_b" would also match "axb"), and commas and parentheses would break a
--      PostgREST "or" filter. The function escapes them, so every character means itself.
--   2. The ranking (exact match first, then names that start with the text, then the rest)
--      and the limit of 20 results are decided in one place.

-- Trigram indexes make "contains" searches (ILIKE '%text%') fast when there are many users.
-- The extension lives in the "extensions" schema, as is usual in Supabase.
create extension if not exists pg_trgm with schema extensions;

create index profiles_username_trgm_idx
  on profiles using gin (username extensions.gin_trgm_ops);

create index profiles_display_name_trgm_idx
  on profiles using gin (display_name extensions.gin_trgm_ops);

-- Returns up to 20 profiles whose username or display name contains the text (any case).
-- Fewer than 2 characters returns nothing, because a single letter matches almost everyone.
-- The function runs with the caller's rights, so the "profiles read" policy still applies:
-- only logged-in users get results.
create function search_profiles(search_text text)
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
  limit 20;
$$;
