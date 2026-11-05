-- Deleting your own account.
--
-- A user cannot delete their own row in auth.users through the API, so this function does it for
-- them. It is the only way, and it can only ever delete the account of the caller: the id comes
-- from the login token (auth.uid()) and nothing else is accepted.
--
-- Everything that belongs to the account goes with it, because every table refers to the profile
-- with "on delete cascade" and the profile refers to auth.users the same way: posts, comments,
-- likes, follows, notifications (those received and those caused), and the rate limit log.
--
-- The profile picture is a file in Storage, which the database must not delete directly. The app
-- removes the files first (through the Storage API, while the user still can) and then calls this.
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to delete your account' using errcode = '28000';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;

-- Not callable by visitors; the default of "everybody" is removed
revoke execute on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
