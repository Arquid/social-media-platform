-- Handling the reports: administrators, a state for each report, and the functions of the admin page.
--
-- Before this, a report could only be read in the Supabase dashboard and had no state. Now:
--   - an administrator (a row in the table `admins`) can list the reports through functions that check who asks,
--     and handle each one: dismiss it, remove the post or comment, or mark it as handled some other way
--   - a report that is handled stays in the table, with who handled it, when, how, and a note
--   - handling one report handles every open report about the same thing, so nobody does the same work twice
--
-- To make yourself an administrator, run this in the SQL Editor of the Supabase dashboard (once):
--   insert into admins (user_id) select id from profiles where username = 'YOUR-USERNAME';
-- The table cannot be read or changed through the API, so nobody can make themselves an administrator.

-- ========== 0. A fix for the reports table ==========
-- A report about a post pointed at it with a foreign key that set the column to null when the post was deleted.
-- Then the report looked like a report about the person, and when the same user had reported that person too, the
-- unique index "reports_unique_user" refused it: deleting the post then failed. The numbers are never used twice, so
-- the report can keep the number of the deleted post: it says what it was about, and the copy of the text is in it.
alter table reports drop constraint reports_post_id_fkey;
alter table reports drop constraint reports_comment_id_fkey;

-- ========== 1. Administrators ==========
create table admins (
  user_id uuid primary key references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Row Level Security on and no policy, and no privilege for the API roles (see the least privilege migration:
-- new tables are closed by default). Only the functions below, as the owner, look at it.
alter table admins enable row level security;

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

grant execute on function is_admin() to authenticated;

-- ========== 2. The state of a report ==========
alter table reports
  add column handled_at timestamptz,
  add column handled_by uuid references profiles(id) on delete set null,
  add column resolution text check (resolution in ('dismissed', 'content_removed', 'noted')),
  add column handler_note text check (char_length(handler_note) <= 300),
  -- a report is handled exactly when it has a resolution
  add constraint reports_handled_together check ((handled_at is null) = (resolution is null));

-- Not part of the columns that users may set (see the grant in the abuse protection migration): nobody can
-- hand in a report that is already handled.

create index reports_handled_by_idx on reports (handled_by);
-- The list of what is still to do
create index reports_open_idx on reports (id desc) where handled_at is null;

-- ========== 3. What an administrator can do ==========
-- All three check who asks. A user who is not an administrator is refused with HTTP 403.

create function admin_open_report_count() returns bigint
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only an administrator can do that.' using errcode = '42501';
  end if;
  return (select count(*) from reports where handled_at is null);
end;
$$;

-- The reports, newest first, a page at a time (give the id of the last one you have as p_before)
create function admin_list_reports(p_status text default 'open', p_limit int default 20, p_before bigint default null)
returns table (
  id bigint,
  created_at timestamptz,
  reason text,
  details text,
  content_snapshot text,
  reporter_username text,
  reported_user_id uuid,
  reported_username text,
  post_id bigint,
  comment_id bigint,
  content_exists boolean,
  other_reports bigint,
  handled_at timestamptz,
  handled_by_username text,
  resolution text,
  handler_note text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only an administrator can do that.' using errcode = '42501';
  end if;
  if p_status not in ('open', 'handled') then
    raise exception 'The status must be open or handled.' using errcode = 'PT400';
  end if;

  return query
  select
    r.id,
    r.created_at,
    r.reason,
    r.details,
    r.content_snapshot,
    reporter.username,
    r.reported_user_id,
    reported.username,
    r.post_id,
    r.comment_id,
    -- is the post or comment still there (null for a report about a person)
    case
      when r.post_id is not null then exists (select 1 from posts p where p.id = r.post_id)
      when r.comment_id is not null then exists (select 1 from comments c where c.id = r.comment_id)
    end,
    -- how many other open reports there are about the same thing
    (
      select count(*) from reports o
      where o.id <> r.id and o.handled_at is null and (
        (r.post_id is not null and o.post_id = r.post_id)
        or (r.comment_id is not null and o.comment_id = r.comment_id)
        or (r.post_id is null and r.comment_id is null and o.post_id is null and o.comment_id is null
            and o.reported_user_id = r.reported_user_id)
      )
    ),
    r.handled_at,
    handler.username,
    r.resolution,
    r.handler_note
  from reports r
  join profiles reporter on reporter.id = r.reporter_id
  join profiles reported on reported.id = r.reported_user_id
  left join profiles handler on handler.id = r.handled_by
  where ((p_status = 'open' and r.handled_at is null) or (p_status = 'handled' and r.handled_at is not null))
    and (p_before is null or r.id < p_before)
  order by r.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

-- Handles a report, and every other open report about the same thing.
--   dismissed        nothing was wrong
--   content_removed  the post or comment is deleted (with its likes, comments and notifications)
--   noted            handled in some other way (for example the person was spoken to); a note says how
-- Gives back the path of the picture of a removed post, so the page can remove the file as well.
create function admin_resolve_report(p_report_id bigint, p_resolution text, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_report reports%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_image text;
begin
  if not is_admin() then
    raise exception 'Only an administrator can do that.' using errcode = '42501';
  end if;
  if p_resolution not in ('dismissed', 'content_removed', 'noted') then
    raise exception 'The resolution must be dismissed, content_removed or noted.' using errcode = 'PT400';
  end if;
  if char_length(v_note) > 300 then
    raise exception 'The note can have at most 300 characters.' using errcode = 'PT400';
  end if;

  select * into v_report from reports where id = p_report_id for update;
  if not found then
    raise exception 'The report does not exist.' using errcode = 'PT404';
  end if;
  if v_report.handled_at is not null then
    raise exception 'This report has already been handled.' using errcode = 'PT409';
  end if;
  if p_resolution = 'content_removed' and v_report.post_id is null and v_report.comment_id is null then
    raise exception 'Only a post or a comment can be removed.' using errcode = 'PT400';
  end if;

  update reports
  set handled_at = now(), handled_by = auth.uid(), resolution = p_resolution, handler_note = v_note
  where handled_at is null and (
    (v_report.post_id is not null and post_id = v_report.post_id)
    or (v_report.comment_id is not null and comment_id = v_report.comment_id)
    or (v_report.post_id is null and v_report.comment_id is null and post_id is null and comment_id is null
        and reported_user_id = v_report.reported_user_id)
  );

  if p_resolution = 'content_removed' then
    if v_report.post_id is not null then
      select image_path into v_image from posts where id = v_report.post_id;
      delete from posts where id = v_report.post_id;
    else
      delete from comments where id = v_report.comment_id;
    end if;
  end if;

  return v_image;
end;
$$;

grant execute on function admin_open_report_count() to authenticated;
grant execute on function admin_list_reports(text, int, bigint) to authenticated;
grant execute on function admin_resolve_report(bigint, text, text) to authenticated;

-- ========== 4. The picture of a removed post ==========
-- A user removes the files in their own folder; an administrator may remove any file in the bucket of the
-- pictures of posts, so that the picture of a post that was removed can go too. (The Storage API looks the file
-- up first, so the administrator needs the right to see it as well; the bucket is public, so nothing else changes.)
create policy "post images select by admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'post-images' and is_admin());

create policy "post images delete by admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-images' and is_admin());
