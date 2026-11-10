import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { localSupabase } from './env';

export const { url: API, anonKey: KEY } = localSupabase();

// A valid 1x1 pixel PNG image
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// Signs up a throwaway user through the API (like the sign up form does) and returns their session
export async function createUser(request, prefix = 'api') {
  return createUserNamed(request, `${prefix}_${randomBytes(4).toString('hex')}`);
}

// Same, but with an exact username (3-20 characters: a-z, 0-9, _)
export async function createUserNamed(request, username) {
  const response = await request.post(`${API}/auth/v1/signup`, {
    headers: { apikey: KEY, 'X-Supabase-Api-Version': '2024-01-01' },
    data: {
      email: `${username}@example.test`,
      password: `Pw-${randomBytes(8).toString('hex')}`,
      data: { username },
    },
  });
  const body = await response.json();
  return { username, id: body.user.id, token: body.access_token };
}

export function authHeaders(user, extra = {}) {
  return { apikey: KEY, Authorization: `Bearer ${user.token}`, ...extra };
}

export function uploadAvatar(request, user, path, { body = TINY_PNG, contentType = 'image/png' } = {}) {
  return request.post(`${API}/storage/v1/object/avatars/${path}`, {
    headers: authHeaders(user, { 'Content-Type': contentType }),
    data: body,
  });
}

export function publicAvatarUrl(path) {
  return `${API}/storage/v1/object/public/avatars/${path}`;
}

export function patchProfile(request, user, values) {
  return request.patch(`${API}/rest/v1/profiles?id=eq.${user.id}`, {
    headers: authHeaders(user, { Prefer: 'return=representation' }),
    data: values,
  });
}

// "A minute passes": make every logged action two minutes older. The database is reached
// through Docker, because the app itself is not allowed to touch the log table.
export function ageRateLimitEvents() {
  execFileSync('docker', [
    'exec', 'supabase_db_social-media-platform',
    'psql', '-U', 'postgres', '-c',
    "update rate_limit_events set created_at = created_at - interval '2 minutes'",
  ]);
}

// Runs SQL in the local database (through Docker) and returns what psql printed.
// Only for things the app is not allowed to do itself.
export function runSql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_social-media-platform', 'psql', '-U', 'postgres', '-tA', '-f', '-'],
    { input: sql, encoding: 'utf8' }
  );
}

// Creates many profiles at once, for tests that need more users than the sign up
// rate limit allows. Usernames are "<prefix>_1" ... "<prefix>_<count>".
export function createProfilesInBulk(prefix, count) {
  runSql(`
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
    select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           '${prefix}_' || g || '@example.test',
           jsonb_build_object('username', '${prefix}_' || g)
    from generate_series(1, ${count}) g;
  `);
}

// Realtime reads the changes of the database from its log, a little behind. Rows written straight
// into the database (as many tests do) are reported to the open pages a moment later. A test that
// then opens a page would get the "new post" messages of rows that were already there when the page
// loaded. This waits until Realtime has read everything that has been written so far.
export async function waitForRealtimeToCatchUp({ timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lag = Number(
      runSql(`
        select coalesce(max(pg_current_wal_lsn() - confirmed_flush_lsn), 0)
        from pg_replication_slots
        where slot_name like 'supabase_realtime_replication_slot%' and slot_name not like '%messages%';
      `).trim()
    );
    // A little WAL is always written by the database itself, so "caught up" means a small lag
    if (lag < 4096) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Realtime did not catch up with the database in time');
}

// The pictures in posts live in their own bucket, with the same rules as the avatars
export function uploadPostImage(request, user, path, { body = TINY_PNG, contentType = 'image/png' } = {}) {
  return request.post(`${API}/storage/v1/object/post-images/${path}`, {
    headers: authHeaders(user, { 'Content-Type': contentType }),
    data: body,
  });
}

export function publicPostImageUrl(path) {
  return `${API}/storage/v1/object/public/post-images/${path}`;
}
