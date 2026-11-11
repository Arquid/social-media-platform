import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RULES, SMOKE, DATABASE_SPECS, selectSpecs, needsSmoke, touchesDatabase } from './affected.js';

// The list of which tests look at which file must not rot: these tests fail when a new test file,
// source file or migration is added without a decision about it.

const root = path.resolve(import.meta.dirname, '..');
const listFiles = (dir, keep) =>
  fs.readdirSync(path.join(root, dir), { recursive: true })
    .map((file) => `${dir}/${String(file).replaceAll('\\', '/')}`)
    .filter((file) => fs.statSync(path.join(root, file)).isFile() && keep(file));

const specNames = listFiles('e2e', (f) => f.endsWith('.spec.js')).map((f) => f.match(/e2e\/(.+)\.spec\.js$/)[1]);
const namedInRules = new Set([...RULES.flatMap(([, names]) => names), ...SMOKE, ...DATABASE_SPECS]);

describe('which tests look at which file', () => {
  it('knows every end-to-end test file: each is named by at least one rule', () => {
    const orphans = specNames.filter((name) => !namedInRules.has(name));

    expect(orphans, 'tests that no change would ever select').toEqual([]);
  });

  it('names only tests that exist (no typos)', () => {
    const missing = [...namedInRules].filter((name) => !specNames.includes(name));

    expect(missing).toEqual([]);
  });

  it('knows every source file of the app: none makes everything run just because it is unknown', () => {
    const sources = listFiles('src', (f) => !/\.test\.jsx?$/.test(f));
    const unknown = sources.filter((file) => selectSpecs([file]).reasons[file]?.startsWith('not known'));

    expect(unknown).toEqual([]);
  });

  it('knows every migration', () => {
    const migrations = listFiles('supabase/migrations', (f) => f.endsWith('.sql'));
    const unknown = migrations.filter((file) => !RULES.some(([pattern]) => pattern.test(file)));

    expect(unknown, 'a migration needs a rule for the tests that look at it').toEqual([]);
  });
});

describe('selectSpecs', () => {
  it('picks the tests of the part that changed, and not the others', () => {
    const { specs, everything } = selectSpecs(['src/components/PostCard.jsx']);

    expect(everything).toBe(false);
    expect(specs).toContain('post-editing-ui');
    expect(specs).toContain('post-images-ui');
    expect(specs).not.toContain('password-reset');
    expect(specs).not.toContain('rate-limit');
  });

  it('adds up the tests of several changed files, each test once', () => {
    const { specs } = selectSpecs(['src/components/PostCard.jsx', 'src/components/PostForm.jsx']);

    expect(specs).toContain('rate-limit-ui'); // only the form
    expect(specs).toContain('optimistic-like'); // only the card
    expect(new Set(specs).size).toBe(specs.length);
  });

  it('runs nothing for files that change nothing about the app', () => {
    const result = selectSpecs([
      'README.md', 'src/components/PostCard.test.jsx', 'src/test/supabaseMock.js', '.gitignore',
      'scripts/verify.mjs', 'scripts/affected.js', 'eslint.config.js',
    ]);

    expect(result.specs).toEqual([]);
    expect(result.everything).toBe(false);
  });

  it('runs a test file that was changed, and only that', () => {
    expect(selectSpecs(['e2e/search.spec.js'])).toMatchObject({ specs: ['search'], everything: false });
  });

  it('runs everything for a file that is not known, to be safe', () => {
    const result = selectSpecs(['src/components/SomethingNew.jsx']);

    expect(result.everything).toBe(true);
    expect(result.reasons['src/components/SomethingNew.jsx']).toMatch(/not known/);
  });

  it.each([
    'package.json', 'package-lock.json', 'vite.config.js', 'playwright.config.js', 'supabase/config.toml',
    'e2e/helpers.js', 'e2e/api.js', '.github/workflows/ci.yml', 'src/main.jsx', 'src/lib/supabaseClient.js',
  ])('runs everything when %s changes', (file) => {
    expect(selectSpecs([file]).everything).toBe(true);
  });

  it('picks the tests of a migration', () => {
    const { specs, everything } = selectSpecs(['supabase/migrations/20261110100000_post_images.sql']);

    expect(everything).toBe(false);
    expect(specs).toEqual(expect.arrayContaining(['post-images', 'privileges', 'following-feed']));
  });

  it('runs all the database tests for the migration that sets up the privileges', () => {
    const { specs } = selectSpecs(['supabase/migrations/20261103100000_least_privilege.sql']);

    expect(specs).toEqual(expect.arrayContaining(DATABASE_SPECS));
  });

  it('understands the paths of Windows', () => {
    expect(selectSpecs(['src\\pages\\Search.jsx']).specs).toContain('search-ui');
  });

  it('explains what it did with every file', () => {
    const files = ['src/pages/Search.jsx', 'README.md', 'src/new.jsx'];
    const { reasons } = selectSpecs(files);

    expect(Object.keys(reasons).sort()).toEqual([...files].sort());
  });
});

describe('needsSmoke and touchesDatabase', () => {
  it('adds the core flows when the app changed, but not for tests, helpers of tests and documents', () => {
    expect(needsSmoke(['src/components/PostCard.jsx'])).toBe(true);
    expect(needsSmoke(['src\\pages\\Search.jsx'])).toBe(true);
    expect(needsSmoke(['src/components/PostCard.test.jsx', 'src/test/supabaseMock.js', 'README.md', 'e2e/search.spec.js'])).toBe(false);
  });

  it('tells when the database must be reset because of the change', () => {
    expect(touchesDatabase(['supabase/migrations/20261110100000_post_images.sql'])).toBe(true);
    expect(touchesDatabase(['supabase/config.toml'])).toBe(true);
    expect(touchesDatabase(['src/components/PostCard.jsx', 'e2e/post-images.spec.js'])).toBe(false);
  });
});
