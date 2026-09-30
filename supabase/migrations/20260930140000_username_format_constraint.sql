-- Enforce the username format in the database. The sign up form checks the same rule,
-- but a direct API call could skip the form.
--
-- Rule: 3-20 characters, only lowercase letters, numbers and underscores.
-- Because uppercase letters are not allowed, the existing unique constraint also makes
-- usernames case-insensitive.
--
-- NOT VALID: the rule applies to new and updated rows only, so old rows that break it
-- (e.g. accounts created before the form validated usernames) do not block this migration.
-- Once old rows are fixed, run: alter table profiles validate constraint profiles_username_format;
alter table profiles
  add constraint profiles_username_format
  check (username ~ '^[a-z0-9_]{3,20}$') not valid;
