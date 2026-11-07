import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import {
  API, KEY, createUserNamed, authHeaders, patchProfile, createProfilesInBulk, runSql,
} from './api';

// These tests call the search function in the database directly, the same way the app does.

const tag = () => randomBytes(3).toString('hex'); // 6 characters, keeps usernames short

// Creates a user whose username is exactly `username` and (optionally) a display name
async function person(request, username, displayName) {
  const user = await createUserNamed(request, username);
  if (displayName) await patchProfile(request, user, { display_name: displayName });
  return user;
}

async function search(request, as, text) {
  const response = await request.post(`${API}/rest/v1/rpc/search_profiles`, {
    headers: as ? authHeaders(as, { 'Content-Type': 'application/json' }) : { apikey: KEY, 'Content-Type': 'application/json' },
    data: { search_text: text },
  });
  expect(response.ok(), `search for ${JSON.stringify(text)}`).toBe(true);
  return response.json();
}

const names = (results) => results.map((r) => r.username);

test.describe('user search', () => {
  test('finds a user by part of the username, in any letter case', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const t = tag();
    const target = await person(request, `seek_${t}`);

    expect(names(await search(request, searcher, t))).toEqual([target.username]);
    expect(names(await search(request, searcher, `SEEK_${t.toUpperCase()}`))).toEqual([target.username]);
    expect(names(await search(request, searcher, `eek_${t.slice(0, 3)}`))).toEqual([target.username]);
  });

  test('finds a user by display name', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const t = tag();
    const target = await person(request, `quiet_${t}`, `Zeppelin Captain ${t}`);

    expect(names(await search(request, searcher, `captain ${t}`))).toEqual([target.username]);
  });

  test('returns only public profile fields', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const t = tag();
    await person(request, `pub_${t}`, `Public ${t}`);

    const [result] = await search(request, searcher, `pub_${t}`);

    expect(Object.keys(result).sort()).toEqual(['avatar_path', 'bio', 'display_name', 'id', 'username']);
  });

  test('ignores spaces around the text and very short text', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const t = tag();
    const target = await person(request, `trim_${t}`);

    expect(names(await search(request, searcher, `   trim_${t}   `))).toEqual([target.username]);
    expect(await search(request, searcher, 'a')).toEqual([]);
    expect(await search(request, searcher, ' a ')).toEqual([]);
    expect(await search(request, searcher, '')).toEqual([]);
    expect(await search(request, searcher, '   ')).toEqual([]);
    expect(await search(request, searcher, null)).toEqual([]);
  });

  test('puts the best matches first: exact username, username start, display name start, the rest', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const term = `qz${tag()}`;
    const contains = await person(request, `a${term}`); //                   contains the text
    const displayStart = await person(request, `other_${tag()}`, `${term} Smith`); // display name starts with it
    const usernameStart = await person(request, `${term}a`); //              username starts with it
    const exact = await person(request, term); //                            exact username

    const results = names(await search(request, searcher, term));

    expect(results).toEqual([exact.username, usernameStart.username, displayStart.username, contains.username]);
  });

  test('returns at most 20 results', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const prefix = `bulk${tag()}`;
    createProfilesInBulk(prefix, 25);

    const results = await search(request, searcher, prefix);

    expect(results).toHaveLength(20);
  });

  test('only logged-in users get results', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const t = tag();
    await person(request, `hidden_${t}`);

    // Without logging in the function cannot even be called (permission denied)
    const anonymous = await request.post(`${API}/rest/v1/rpc/search_profiles`, {
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      data: { search_text: `hidden_${t}` },
    });
    expect(anonymous.status()).toBe(401);
    expect((await anonymous.json()).code).toBe('42501');

    expect(await search(request, searcher, `hidden_${t}`)).toHaveLength(1);
  });
});

test.describe('special characters in the search text', () => {
  test('% and _ are searched as plain characters, not as wildcards', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const t = tag();
    const percent = await person(request, `pct_${t}`, `Fifty%Off ${t}`);
    await person(request, `plain_${t}`, `FiftyXOff ${t}`);
    const underscore = await person(request, `und_${t}`, `Under_score ${t}`);
    await person(request, `unx_${t}`, `UnderXscore ${t}`);

    // Without escaping, "%" would match anything and "_" any single character
    expect(names(await search(request, searcher, `Fifty%Off ${t}`))).toEqual([percent.username]);
    expect(names(await search(request, searcher, `Under_score ${t}`))).toEqual([underscore.username]);
    // A % at the start of the text does not match "anything" either: "%Off <tag>" finds the
    // person who really has "%Off" in their name, not "FiftyXOff <tag>"
    const withPercent = names(await search(request, searcher, `%Off ${t}`));
    expect(withPercent).toEqual([percent.username]);
  });

  test('a backslash is searched as a plain character', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const t = tag();
    const target = await person(request, `bsl_${t}`, `back\\slash ${t}`);

    expect(names(await search(request, searcher, `back\\slash ${t}`))).toEqual([target.username]);
    expect(names(await search(request, searcher, `back\\`))).toContain(target.username);
  });

  test('quotes, commas, parentheses and SQL do no harm', async ({ request }) => {
    const searcher = await person(request, `finder_${tag()}`);
    const t = tag();
    const target = await person(request, `safe_${t}`);

    for (const text of [`x'); drop table profiles; --`, 'a,b)', ')(', 'username.eq.admin,or', '"quoted"', '\\', '%_%']) {
      await search(request, searcher, text); // must answer normally
    }

    // The table is still there and searchable
    expect(names(await search(request, searcher, `safe_${t}`))).toEqual([target.username]);
  });
});

test.describe('search indexes', () => {
  test('the trigram indexes exist and are used for "contains" searches', () => {
    const indexes = runSql(`select indexname from pg_indexes where tablename = 'profiles' order by 1;`);
    expect(indexes).toContain('profiles_username_trgm_idx');
    expect(indexes).toContain('profiles_display_name_trgm_idx');

    // With only a few rows the planner prefers a plain scan, so switch that off for the check
    const plan = runSql(`
      begin;
      set local enable_seqscan = off;
      explain select id from profiles where username ilike '%abc%';
      explain select id from profiles where display_name ilike '%abc%';
      rollback;
    `);
    expect(plan).toContain('profiles_username_trgm_idx');
    expect(plan).toContain('profiles_display_name_trgm_idx');
  });
});

test.describe('pages of the search', () => {
  // Asks for one page: how many, and how many to skip
  async function page(request, as, text, extra) {
    const response = await request.post(`${API}/rest/v1/rpc/search_profiles`, {
      headers: authHeaders(as, { 'Content-Type': 'application/json' }),
      data: { search_text: text, ...extra },
    });
    expect(response.ok(), `page ${JSON.stringify(extra)}`).toBe(true);
    return names(await response.json());
  }

  // 55 people whose names all start with the same text
  async function crowd(request) {
    const searcher = await person(request, `finder_${tag()}`);
    const prefix = `pg${tag()}`;
    createProfilesInBulk(prefix, 55);
    return { searcher, prefix };
  }

  test('pages of 20 follow each other without gaps or overlaps, and add up to everybody', async ({ request }) => {
    const { searcher, prefix } = await crowd(request);

    const first = await page(request, searcher, prefix, { result_limit: 20, result_offset: 0 });
    const second = await page(request, searcher, prefix, { result_limit: 20, result_offset: 20 });
    const third = await page(request, searcher, prefix, { result_limit: 20, result_offset: 40 });

    expect([first.length, second.length, third.length]).toEqual([20, 20, 15]);
    const all = [...first, ...second, ...third];
    expect(new Set(all).size).toBe(55);
    // One list in one order: asking for everything at once gives the same names in the same order
    expect(await page(request, searcher, prefix, { result_limit: 50, result_offset: 0 })).toEqual(all.slice(0, 50));
    expect(await page(request, searcher, prefix, { result_limit: 50, result_offset: 50 })).toEqual(all.slice(50));
  });

  test('gives the same order every time, so a page never changes under the reader', async ({ request }) => {
    const { searcher, prefix } = await crowd(request);

    const once = await page(request, searcher, prefix, { result_limit: 20, result_offset: 20 });
    const again = await page(request, searcher, prefix, { result_limit: 20, result_offset: 20 });

    expect(again).toEqual(once);
  });

  test('without a page size and a start the answer is the first 20, as before', async ({ request }) => {
    const { searcher, prefix } = await crowd(request);

    const plain = await page(request, searcher, prefix, {});
    const explicit = await page(request, searcher, prefix, { result_limit: 20, result_offset: 0 });

    expect(plain).toHaveLength(20);
    expect(plain).toEqual(explicit);
  });

  test('keeps the page size between 1 and 50, and the start from being negative', async ({ request }) => {
    const { searcher, prefix } = await crowd(request);

    expect(await page(request, searcher, prefix, { result_limit: 1000 })).toHaveLength(50);
    expect(await page(request, searcher, prefix, { result_limit: 0 })).toHaveLength(1);
    expect(await page(request, searcher, prefix, { result_limit: -5 })).toHaveLength(1);
    expect(await page(request, searcher, prefix, { result_offset: -10 })).toEqual(
      await page(request, searcher, prefix, { result_offset: 0 })
    );
  });

  test('an empty page after the last person, and nothing for text that is too short', async ({ request }) => {
    const { searcher, prefix } = await crowd(request);

    expect(await page(request, searcher, prefix, { result_offset: 55 })).toEqual([]);
    expect(await page(request, searcher, prefix, { result_offset: 500 })).toEqual([]);
    expect(await page(request, searcher, 'a', { result_offset: 0 })).toEqual([]);
  });

  test('the old one-argument function is gone, so the name is not ambiguous', async () => {
    const versions = runSql(`select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'search_profiles';`)
      .split('\n').map((line) => line.trim()).filter(Boolean);

    expect(versions).toEqual(['search_text text, result_limit integer, result_offset integer']);
  });
});
