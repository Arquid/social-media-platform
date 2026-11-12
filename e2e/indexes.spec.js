import { test, expect } from '@playwright/test';
import { runSql } from './api';

// These tests look at how the database plans its queries when a table is large.
// Every plan is made inside a transaction that is rolled back, so no data is left behind.
// While the test rows are loaded the triggers and foreign key checks are switched off
// (session_replication_role = replica), which makes loading 50 000 rows take a fraction of a second.

const TARGET_USER = '00000000-0000-0000-0000-00000000aaaa';
const AUTHOR = '00000000-0000-0000-0000-00000000f001';

// Loads `setup`, collects statistics like autovacuum would, and returns the plan of `query`.
function planOf({ setup, query, analyze, asUser }) {
  const switchToUser = asUser
    ? `set local role authenticated;
       select set_config('request.jwt.claims', '{"sub":"${asUser}","role":"authenticated"}', true);`
    : '';

  return runSql(`
    begin;
    set local session_replication_role = replica;
    ${setup}
    ${analyze.map((table) => `analyze ${table};`).join('\n')}
    ${switchToUser}
    explain ${query};
    rollback;
  `);
}

test.describe('indexes exist', () => {
  test('all the indexes of the review are in place', () => {
    const names = runSql(`select indexname from pg_indexes where schemaname = 'public' order by 1;`)
      .split('\n')
      .map((line) => line.trim());

    for (const index of [
      'likes_user_id_post_id_idx',
      'follows_following_id_idx',
      'comments_user_id_idx',
      'notifications_user_id_id_idx',
      'comments_post_id_id_idx',
      'notifications_actor_id_idx',
      'notifications_post_id_idx',
      'blocks_blocked_idx',
      'reports_reporter_idx',
      'reports_reported_user_idx',
      'reports_post_idx',
      'reports_comment_idx',
    ]) {
      expect(names, `index ${index}`).toContain(index);
    }
  });

  test('no foreign key is left without an index that can be used', () => {
    // Deleting a row in the parent table (a user, a post) must find the child rows by index.
    // Partial indexes (with a where clause) cannot be used for that, so they do not count.
    const missing = runSql(`
      select c.conrelid::regclass || '.' || a.attname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
            and i.indpred is null and i.indisvalid
        )
      order by 1;
    `).trim();

    expect(missing, 'foreign keys without a usable index').toBe('');
  });
});

test.describe('queries use the indexes on large tables', () => {
  test('"which posts has this user liked?" does not read the whole likes table', () => {
    const plan = planOf({
      setup: `
        insert into likes (post_id, user_id) select g, gen_random_uuid() from generate_series(1, 50000) g;
        insert into likes (post_id, user_id) select g, '${TARGET_USER}' from generate_series(60001, 60020) g;
      `,
      analyze: ['likes'],
      query: `select post_id from likes where user_id = '${TARGET_USER}'`,
    });

    expect(plan).toContain('likes_user_id_post_id_idx');
    expect(plan).not.toContain('Seq Scan on likes');
  });

  test('the first page of the feed does not scan the whole likes table (the 1.4 second problem)', () => {
    const plan = planOf({
      setup: `
        insert into profiles (id, username) values ('${AUTHOR}', 'idxfeed_author');
        insert into posts (user_id, content) select '${AUTHOR}', 'index test post ' || g from generate_series(1, 3000) g;
        insert into likes (post_id, user_id)
          select p.id, gen_random_uuid() from posts p, generate_series(1, 20) where p.user_id = '${AUTHOR}';
      `,
      analyze: ['profiles', 'posts', 'likes'],
      asUser: TARGET_USER,
      // The same request as the app: the newest 20 posts from the feed view
      query: 'select * from posts_feed order by id desc limit 20',
    });

    expect(plan).not.toContain('Seq Scan on likes');
    // Needed for "did I like this post": the index on the user, not the whole table
    expect(plan).toContain('likes_user_id_post_id_idx');
    // And the 20 newest posts are read from the end of the primary key, not sorted afterwards
    expect(plan).toContain('Index Scan Backward using posts_pkey');
  });

  test('the first page of the Following feed is read from the newest posts, not from all of them', () => {
    const plan = planOf({
      setup: `
        insert into profiles (id, username)
          select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'idxfollow_' || g from generate_series(1, 300) g;
        insert into posts (user_id, content)
          select ('00000000-0000-0000-0001-' || lpad((1 + g % 300)::text, 12, '0'))::uuid, 'following plan post' from generate_series(1, 20000) g;
        insert into likes (post_id, user_id) select id, gen_random_uuid() from posts where id % 2 = 0;
        insert into follows (follower_id, following_id)
          select '${TARGET_USER}', ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 100) g;
      `,
      analyze: ['profiles', 'posts', 'likes', 'follows'],
      asUser: TARGET_USER,
      // The same request as the Following tab
      query: 'select * from posts_following_feed order by id desc limit 20',
    });

    expect(plan).not.toContain('Seq Scan on likes');
    expect(plan).not.toContain('Seq Scan on posts');
    expect(plan).toContain('Index Scan Backward using posts_pkey');
  });

  test('the follower count of a profile uses the index', () => {
    const plan = planOf({
      setup: `
        insert into follows (follower_id, following_id) select gen_random_uuid(), gen_random_uuid() from generate_series(1, 50000);
        insert into follows (follower_id, following_id) select gen_random_uuid(), '${TARGET_USER}' from generate_series(1, 10);
      `,
      analyze: ['follows'],
      query: `select count(*) from follows where following_id = '${TARGET_USER}'`,
    });

    expect(plan).toContain('follows_following_id_idx');
    expect(plan).not.toContain('Seq Scan on follows');
  });

  test('a page of a user\'s notifications comes newest first straight from the index, without sorting', () => {
    const plan = planOf({
      setup: `
        insert into notifications (user_id, actor_id, type, created_at)
          select ('00000000-0000-0000-0000-' || lpad((g % 500)::text, 12, '0'))::uuid, gen_random_uuid(), 'comment',
                 now() - g * interval '1 second'
          from generate_series(1, 50000) g;
        insert into notifications (user_id, actor_id, type, created_at)
          select '${TARGET_USER}', gen_random_uuid(), 'comment', now() - g * interval '1 minute'
          from generate_series(1, 100) g;
      `,
      analyze: ['notifications'],
      // The first page, as the app asks for it
      query: `select * from notifications where user_id = '${TARGET_USER}' order by id desc limit 20`,
    });

    expect(plan).toContain('notifications_user_id_id_idx');
    expect(plan).not.toContain('Seq Scan on notifications');
    expect(plan).not.toMatch(/\bSort\b/);
  });

  test('the next page of notifications (the 20 below an id) is found by the index as well', () => {
    const plan = planOf({
      setup: `
        insert into notifications (user_id, actor_id, type)
          select ('00000000-0000-0000-0000-' || lpad((g % 500)::text, 12, '0'))::uuid, gen_random_uuid(), 'comment'
          from generate_series(1, 50000) g;
        insert into notifications (user_id, actor_id, type)
          select '${TARGET_USER}', gen_random_uuid(), 'comment' from generate_series(1, 400);
      `,
      analyze: ['notifications'],
      query: `select * from notifications where user_id = '${TARGET_USER}'
              and id < (select max(id) from notifications) - 20000 order by id desc limit 20`,
    });

    expect(plan).toContain('notifications_user_id_id_idx');
    expect(plan).not.toContain('Seq Scan on notifications');
    expect(plan).not.toMatch(/\bSort\b/);
  });

  test('the comments of a post come newest first, a page at a time, straight from the index', () => {
    const POST_AUTHOR = '00000000-0000-0000-0000-00000000f002';
    const setup = `
      insert into profiles (id, username) values ('${POST_AUTHOR}', 'idxcomment_author');
      insert into posts (user_id, content) select '${POST_AUTHOR}', 'a post ' || g from generate_series(1, 200) g;
      insert into comments (post_id, user_id, content)
        select p.id, '${POST_AUTHOR}', 'comment ' || g from posts p, generate_series(1, 150) g where p.user_id = '${POST_AUTHOR}';
    `;
    const post = `(select min(id) from posts where user_id = '${POST_AUTHOR}')`;

    const first = planOf({
      setup,
      analyze: ['posts', 'comments'],
      query: `select * from comments where post_id = ${post} order by id desc limit 20`,
    });
    const next = planOf({
      setup,
      analyze: ['posts', 'comments'],
      query: `select * from comments where post_id = ${post} and id < (select max(id) from comments) - 3000 order by id desc limit 20`,
    });

    for (const plan of [first, next]) {
      expect(plan).toContain('comments_post_id_id_idx');
      expect(plan).not.toContain('Seq Scan on comments');
      expect(plan).not.toMatch(/\bSort\b/);
    }
  });

  test('the unread notification counter of the navigation bar uses an index', () => {
    const plan = planOf({
      setup: `
        insert into notifications (user_id, actor_id, type)
          select ('00000000-0000-0000-0000-' || lpad((g % 500)::text, 12, '0'))::uuid, gen_random_uuid(), 'comment'
          from generate_series(1, 50000) g;
        insert into notifications (user_id, actor_id, type)
          select '${TARGET_USER}', gen_random_uuid(), 'comment' from generate_series(1, 100);
      `,
      analyze: ['notifications'],
      query: `select count(*) from notifications where user_id = '${TARGET_USER}' and read = false`,
    });

    expect(plan).toContain('notifications_user_id_id_idx');
    expect(plan).not.toContain('Seq Scan on notifications');
  });
});
