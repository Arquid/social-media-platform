import { test, expect } from '@playwright/test';
import { API, KEY, createUser, authHeaders, runSql } from './api';

// The database roles of the app (anon = not logged in, authenticated = logged in) may only do what
// the app needs. The row level security policies say which rows, these privileges say which kinds
// of operations at all. The first tests read the privileges straight from the catalog and compare
// them with the list below: a new table with no entry in the list fails the test on purpose, so
// a decision has to be made about it.

const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

// What a logged-in user may do, per table or view. Everything not listed is forbidden.
const EXPECTED = {
  blocks: ['DELETE', 'INSERT', 'SELECT'],
  comments: ['DELETE', 'INSERT', 'SELECT'],
  follows: ['DELETE', 'INSERT', 'SELECT'],
  likes: ['DELETE', 'INSERT', 'SELECT'],
  notifications: ['SELECT'], // plus UPDATE of the column "read" only (checked below)
  posts: ['DELETE', 'INSERT', 'SELECT'],
  posts_feed: ['SELECT'],
  posts_following_feed: ['SELECT'],
  profiles: ['SELECT', 'UPDATE'],
  rate_limit_events: [],
  reports: [], // INSERT of six columns only (checked below); nobody can read them through the API
};

function lines(sql) {
  return runSql(sql).split('\n').map((line) => line.trim()).filter(Boolean);
}

// "table:PRIVILEGE" for every table-level privilege the role has on a table or view of the public schema
function tablePrivilegesOf(role) {
  return lines(`
    select c.relname || ':' || p.priv
    from pg_class c, unnest(array[${TABLE_PRIVILEGES.map((p) => `'${p}'`).join(',')}]) as p(priv)
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
      and has_table_privilege('${role}', c.oid, p.priv)
    order by 1;
  `);
}

test.describe('privileges of the database roles', () => {
  test('a logged-in user has exactly the privileges the app needs, table by table', () => {
    const expected = Object.entries(EXPECTED)
      .flatMap(([table, privileges]) => privileges.map((privilege) => `${table}:${privilege}`))
      .sort();

    expect(tablePrivilegesOf('authenticated')).toEqual(expected);
  });

  test('every table and view of the schema has been decided about (a new one must be added to the list)', () => {
    const existing = lines(`
      select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1;
    `);

    expect(existing).toEqual(Object.keys(EXPECTED).sort());
  });

  test('a user can change only the "read" column of a notification', () => {
    const columns = lines(`
      select attname from pg_attribute
      where attrelid = 'public.notifications'::regclass and attnum > 0 and not attisdropped
        and has_column_privilege('authenticated', attrelid, attname, 'UPDATE')
      order by 1;
    `);

    expect(columns).toEqual(['read']);
  });

  test('a user can change only the "content" column of a post', () => {
    const columns = lines(`
      select attname from pg_attribute
      where attrelid = 'public.posts'::regclass and attnum > 0 and not attisdropped
        and has_column_privilege('authenticated', attrelid, attname, 'UPDATE')
      order by 1;
    `);

    expect(columns).toEqual(['content']);
  });

  test('a user can send a report with the six columns of the form, and nothing else', () => {
    const columns = (privilege) => lines(`
      select attname from pg_attribute
      where attrelid = 'public.reports'::regclass and attnum > 0 and not attisdropped
        and has_column_privilege('authenticated', attrelid, attname, '${privilege}')
      order by 1;
    `);

    expect(columns('INSERT')).toEqual(['comment_id', 'details', 'post_id', 'reason', 'reported_user_id', 'reporter_id']);
    // The copy of the text, the id and the time are made by the database; nothing can be read back or changed
    expect(columns('SELECT')).toEqual([]);
    expect(columns('UPDATE')).toEqual([]);
  });

  test('a visitor who is not logged in has no privileges at all, not even on single columns', () => {
    expect(tablePrivilegesOf('anon')).toEqual([]);

    const columnPrivileges = lines(`
      select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
        and has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES');
    `);
    expect(columnPrivileges).toEqual([]);
  });

  test('sequences: a logged-in user can only take the next number of the two that they need', () => {
    const usable = (role) =>
      lines(`
        select c.relname || ':' || p.priv
        from pg_class c, unnest(array['USAGE','SELECT','UPDATE']) as p(priv)
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
          and has_sequence_privilege('${role}', c.oid, p.priv)
        order by 1;
      `);

    expect(usable('authenticated')).toEqual(['comments_id_seq:USAGE', 'posts_id_seq:USAGE']);
    expect(usable('anon')).toEqual([]);
  });

  test('functions: the trigger functions cannot be called by anyone, search and account deletion only when logged in', () => {
    const executable = (role) =>
      lines(`
        select p.proname from pg_proc p
        where p.pronamespace = 'public'::regnamespace and has_function_privilege('${role}', p.oid, 'execute')
        order by 1;
      `);

    expect(executable('authenticated')).toEqual(['delete_my_account', 'search_profiles']);
    expect(executable('anon')).toEqual([]);
    expect(executable('public')).toEqual([]);
  });

  test('a table, sequence or function created later is closed to the app until someone opens it', () => {
    // Created in a transaction that is rolled back, as the role that runs the migrations
    const rows = lines(`
      begin;
      create table public.zz_future_table (id serial primary key, note text);
      create function public.zz_future_function() returns int language sql as 'select 1';
      select 'table:' || r.role || ':' || has_table_privilege(r.role, 'public.zz_future_table', 'SELECT,INSERT,UPDATE,DELETE')
        from (values ('anon'), ('authenticated')) as r(role);
      select 'sequence:' || r.role || ':' || has_sequence_privilege(r.role, 'public.zz_future_table_id_seq', 'USAGE')
        from (values ('anon'), ('authenticated')) as r(role);
      select 'function:' || r.role || ':' || has_function_privilege(r.role, 'public.zz_future_function()', 'execute')
        from (values ('anon'), ('authenticated'), ('public')) as r(role);
      rollback;
    `).filter((line) => line.includes(':'));

    expect(rows).toEqual([
      'table:anon:false', 'table:authenticated:false',
      'sequence:anon:false', 'sequence:authenticated:false',
      'function:anon:false', 'function:authenticated:false', 'function:public:false',
    ]);
  });
});

test.describe('what the API says to a user who does something that is not allowed', () => {
  const json = { 'Content-Type': 'application/json', Prefer: 'return=representation' };

  // The author writes a post, the fan likes it: the author now has a notification
  async function authorWithNotification(request) {
    const author = await createUser(request, 'privauth');
    const fan = await createUser(request, 'privfan');
    const created = await request.post(`${API}/rest/v1/posts`, {
      headers: authHeaders(author, json),
      data: { user_id: author.id, content: 'privilege test post' },
    });
    const [post] = await created.json();
    await request.post(`${API}/rest/v1/likes`, {
      headers: authHeaders(fan, json),
      data: { post_id: post.id, user_id: fan.id },
    });
    return { author, fan, post };
  }

  test('a visitor who is not logged in is refused on every table, instead of getting an empty list', async ({ request }) => {
    for (const table of Object.keys(EXPECTED)) {
      const response = await request.get(`${API}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: KEY } });

      expect(response.status(), table).toBe(401);
      expect((await response.json()).code, table).toBe('42501'); // insufficient_privilege
    }
  });

  test('nobody can call the trigger functions through the API', async ({ request }) => {
    const user = await createUser(request, 'privrpc');

    for (const name of ['notify_like', 'notify_comment', 'notify_follow', 'handle_new_user', 'enforce_rate_limit', 'refuse_blocked_interaction', 'remove_follows_of_block', 'fill_report']) {
      const asUser = await request.post(`${API}/rest/v1/rpc/${name}`, { headers: authHeaders(user, json), data: {} });
      const asVisitor = await request.post(`${API}/rest/v1/rpc/${name}`, { headers: { apikey: KEY, ...json }, data: {} });

      expect(asUser.ok(), `${name} as a user`).toBe(false);
      expect(asVisitor.ok(), `${name} as a visitor`).toBe(false);
    }
  });

  test('the author of a post can change its text, but nothing else about it', async ({ request }) => {
    const { author, fan, post } = await authorWithNotification(request);

    const edit = await request.patch(`${API}/rest/v1/posts?id=eq.${post.id}`, {
      headers: authHeaders(author, json),
      data: { content: 'edited' },
    });
    expect(edit.status()).toBe(200);

    for (const change of [{ user_id: fan.id }, { created_at: '2000-01-01T00:00:00Z' }, { edited_at: null }]) {
      const refused = await request.patch(`${API}/rest/v1/posts?id=eq.${post.id}`, {
        headers: authHeaders(author, json),
        data: change,
      });
      expect(refused.status(), JSON.stringify(change)).toBe(403);
      expect((await refused.json()).code).toBe('42501');
    }

    // The id cannot be changed at all (it is generated), whoever asks
    const newId = await request.patch(`${API}/rest/v1/posts?id=eq.${post.id}`, {
      headers: authHeaders(author, json),
      data: { id: post.id + 1000 },
    });
    expect(newId.ok()).toBe(false);
  });

  test('likes, follows and comments cannot be changed afterwards, only added and removed', async ({ request }) => {
    const { author, fan, post } = await authorWithNotification(request);
    await request.post(`${API}/rest/v1/follows`, {
      headers: authHeaders(fan, json),
      data: { follower_id: fan.id, following_id: author.id },
    });
    await request.post(`${API}/rest/v1/comments`, {
      headers: authHeaders(fan, json),
      data: { post_id: post.id, user_id: fan.id, content: 'original comment' },
    });

    for (const [table, filter, change] of [
      ['likes', `user_id=eq.${fan.id}`, { post_id: post.id + 1000 }],
      ['follows', `follower_id=eq.${fan.id}`, { following_id: fan.id }],
      ['comments', `user_id=eq.${fan.id}`, { content: 'edited later' }],
    ]) {
      const response = await request.patch(`${API}/rest/v1/${table}?${filter}`, {
        headers: authHeaders(fan, json),
        data: change,
      });
      expect(response.status(), table).toBe(403);
      expect((await response.json()).code, table).toBe('42501');
    }
  });

  test('a profile cannot be deleted through the API', async ({ request }) => {
    const user = await createUser(request, 'privdel');

    const response = await request.delete(`${API}/rest/v1/profiles?id=eq.${user.id}`, { headers: authHeaders(user, json) });

    expect(response.status()).toBe(403);
    const profile = await request.get(`${API}/rest/v1/profiles?id=eq.${user.id}&select=id`, { headers: authHeaders(user) });
    expect(await profile.json()).toHaveLength(1);
  });

  test('a user can mark a notification as read, but not rewrite who sent it or what it says', async ({ request }) => {
    const { author, fan, post } = await authorWithNotification(request);
    const inbox = async () =>
      (await request.get(`${API}/rest/v1/notifications?user_id=eq.${author.id}&select=*`, { headers: authHeaders(author) })).json();
    const [before] = await inbox();
    expect(before.actor_id).toBe(fan.id);

    for (const change of [{ actor_id: author.id }, { type: 'follow' }, { post_id: post.id + 1 }, { user_id: fan.id }, { read: true, actor_id: author.id }]) {
      const response = await request.patch(`${API}/rest/v1/notifications?id=eq.${before.id}`, {
        headers: authHeaders(author, json),
        data: change,
      });
      expect(response.status(), JSON.stringify(change)).toBe(403);
    }
    expect(await inbox()).toEqual([before]);

    const read = await request.patch(`${API}/rest/v1/notifications?id=eq.${before.id}`, {
      headers: authHeaders(author, json),
      data: { read: true },
    });
    expect(read.ok()).toBe(true);
    expect((await inbox())[0]).toMatchObject({ id: before.id, actor_id: fan.id, type: before.type, read: true });
  });

  test('a user cannot create or delete notifications', async ({ request }) => {
    const { author, fan, post } = await authorWithNotification(request);

    const create = await request.post(`${API}/rest/v1/notifications`, {
      headers: authHeaders(fan, json),
      data: { user_id: author.id, actor_id: fan.id, type: 'like', post_id: post.id },
    });
    expect(create.status()).toBe(403);

    const remove = await request.delete(`${API}/rest/v1/notifications?user_id=eq.${author.id}`, { headers: authHeaders(author, json) });
    expect(remove.status()).toBe(403);
  });

  test('the normal things still work for a logged-in user', async ({ request }) => {
    const { author, fan, post } = await authorWithNotification(request);

    // read the feed (the view needs select on several tables), comment, follow, edit the own profile, search
    const feed = await request.get(`${API}/rest/v1/posts_feed?id=eq.${post.id}`, { headers: authHeaders(fan) });
    expect(await feed.json()).toMatchObject([{ id: post.id, like_count: 1, liked_by_me: true }]);

    const comment = await request.post(`${API}/rest/v1/comments`, {
      headers: authHeaders(fan, json),
      data: { post_id: post.id, user_id: fan.id, content: 'still works' },
    });
    expect(comment.status()).toBe(201);

    const follow = await request.post(`${API}/rest/v1/follows`, {
      headers: authHeaders(fan, json),
      data: { follower_id: fan.id, following_id: author.id },
    });
    expect(follow.status()).toBe(201);
    const following = await request.get(`${API}/rest/v1/posts_following_feed?select=id`, { headers: authHeaders(fan) });
    expect(await following.json()).toEqual([{ id: post.id }]);

    const profile = await request.patch(`${API}/rest/v1/profiles?id=eq.${fan.id}`, {
      headers: authHeaders(fan, json),
      data: { bio: 'hello' },
    });
    expect(profile.ok()).toBe(true);

    const search = await request.post(`${API}/rest/v1/rpc/search_profiles`, {
      headers: authHeaders(fan, json),
      data: { search_text: author.username },
    });
    expect(search.ok()).toBe(true);

    const unlike = await request.delete(`${API}/rest/v1/likes?user_id=eq.${fan.id}&post_id=eq.${post.id}`, { headers: authHeaders(fan) });
    expect(unlike.ok()).toBe(true);
    const remove = await request.delete(`${API}/rest/v1/posts?id=eq.${post.id}`, { headers: authHeaders(author) });
    expect(remove.ok()).toBe(true);
  });
});
