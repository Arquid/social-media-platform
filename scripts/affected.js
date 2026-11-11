// Which end-to-end tests are worth running for a change?
//
// The end-to-end tests take about nine minutes together, and a change to the post form does not
// need the tests of the password reset. This file knows which tests look at which part of the app,
// so `npm run verify` can run only those. The CI (GitHub Actions) still runs all of them.
//
// If a file is not known here, everything is run: a wrong guess must cost time, never a missed bug.

// The tests that look at the same few things: the core of the app, quick to run
export const SMOKE = ['social', 'auth'];

// Tests that only talk to the database and the storage (no browser pages): about a minute together
export const DATABASE_SPECS = [
  'database', 'edit-post', 'indexes', 'post-images', 'privileges', 'profile-storage', 'rate-limit',
  'search', 'following-feed', 'notifications',
];

// [ which files, which tests ]. The first matching rule of a file is not the only one: all rules count.
export const RULES = [
  // --- the pages of the app ---
  [/^src\/components\/PostCard\.jsx$/, ['social', 'optimistic-like', 'post-editing-ui', 'post-images-ui', 'realtime-filters', 'accessibility']],
  [/^src\/components\/PostForm\.jsx$/, ['social', 'own-post', 'post-images-ui', 'rate-limit-ui', 'accessibility']],
  [/^src\/components\/CommentSection\.jsx$/, ['social', 'pagination', 'post-editing-ui', 'post-images-ui', 'rate-limit-ui', 'realtime-filters', 'accessibility']],
  [/^src\/components\/Feed\.jsx$/, ['social', 'own-post', 'following-feed', 'realtime-filters', 'optimistic-like', 'post-editing-ui', 'pagination']],
  [/^src\/components\/Navbar\.jsx$/, ['auth', 'social', 'notifications', 'search-ui', 'theme-and-time', 'accessibility']],
  [/^src\/components\/(FollowButton)\.jsx$/, ['social', 'following-feed', 'accessibility']],
  [/^src\/components\/(EditProfileDialog|UserAvatar)\.jsx$/, ['profile', 'account-deletion', 'post-images-ui', 'accessibility']],
  [/^src\/components\/DeleteAccountDialog\.jsx$/, ['account-deletion', 'accessibility']],
  [/^src\/components\/ErrorBoundary\.jsx$/, ['errors', 'error-reporting', 'accessibility']],
  [/^src\/components\/(PageTitle|ProtectedRoute)\.jsx$/, ['errors', 'auth', 'accessibility']],
  [/^src\/components\/(ThemeToggle|TimeAgo)\.jsx$/, ['theme-and-time', 'accessibility']],
  [/^src\/pages\/(Login|Register)\.jsx$/, ['auth', 'password-reset', 'account-deletion', 'accessibility']],
  [/^src\/pages\/(ForgotPassword|ResetPassword)\.jsx$/, ['password-reset', 'accessibility']],
  [/^src\/pages\/Home\.jsx$/, ['social', 'own-post', 'following-feed', 'accessibility']],
  [/^src\/pages\/Notifications\.jsx$/, ['notifications', 'pagination', 'post-page', 'social', 'accessibility']],
  [/^src\/pages\/PostPage\.jsx$/, ['post-page', 'post-editing-ui', 'realtime-filters', 'pagination', 'errors', 'accessibility']],
  [/^src\/pages\/Profile\.jsx$/, ['profile', 'account-deletion', 'post-editing-ui', 'accessibility']],
  [/^src\/pages\/Search\.jsx$/, ['search-ui', 'pagination', 'accessibility']],
  [/^src\/pages\/NotFound\.jsx$/, ['errors', 'accessibility']],
  [/^src\/App\.jsx$/, ['errors', 'auth', 'password-reset', 'accessibility']],
  [/^src\/theme\.js$/, ['theme-and-time', 'accessibility']],

  // --- helpers used by the pages ---
  [/^src\/lib\/avatars\.js$/, ['profile', 'account-deletion', 'accessibility']],
  [/^src\/lib\/postImages\.js$/, ['post-images-ui', 'account-deletion']],
  [/^src\/lib\/search\.js$/, ['search-ui', 'pagination', 'error-reporting']],
  [/^src\/lib\/errors\.js$/, ['rate-limit-ui']],
  [/^src\/lib\/errorReporting\.js$/, ['error-reporting', 'errors', 'search-ui']],
  [/^src\/lib\/time\.js$/, ['theme-and-time']],
  [/^src\/(context\/AuthContext|context\/authContextObject|hooks\/useAuth)\.jsx?$/, ['auth', 'password-reset', 'account-deletion', 'errors']],
  [/^src\/(context\/ToastContext|context\/toastContextObject|hooks\/useToast)\.jsx?$/, ['social', 'rate-limit-ui', 'account-deletion']],
  [/^src\/hooks\/(useDebouncedValue|useNow)\.js$/, ['search-ui', 'theme-and-time', 'realtime-filters']],

  // --- the database: each migration and the tests that were made for it ---
  [/migrations\/\d+_init_schema\.sql$/, DATABASE_SPECS],
  [/migrations\/\d+_posts_feed_view\.sql$/, ['following-feed', 'edit-post', 'post-images', 'social']],
  [/migrations\/\d+_posts_pagination_index\.sql$/, ['indexes', 'following-feed']],
  [/migrations\/\d+_username_format_constraint\.sql$/, ['database', 'auth']],
  [/migrations\/\d+_profile_editing_and_avatars\.sql$/, ['profile-storage', 'profile', 'account-deletion']],
  [/migrations\/\d+_dedupe_notifications\.sql$/, ['notifications']],
  [/migrations\/\d+_rate_limits\.sql$/, ['rate-limit', 'rate-limit-ui']],
  [/migrations\/\d+_user_search\.sql$/, ['search', 'search-ui', 'pagination']],
  [/migrations\/\d+_missing_indexes\.sql$/, ['indexes']],
  [/migrations\/\d+_following_feed\.sql$/, ['following-feed', 'indexes']],
  [/migrations\/\d+_least_privilege\.sql$/, DATABASE_SPECS],
  [/migrations\/\d+_delete_account\.sql$/, ['account-deletion', 'privileges']],
  [/migrations\/\d+_pagination\.sql$/, ['pagination', 'search', 'indexes', 'privileges']],
  [/migrations\/\d+_edit_posts\.sql$/, ['edit-post', 'post-editing-ui', 'privileges', 'following-feed']],
  [/migrations\/\d+_post_images\.sql$/, ['post-images', 'post-images-ui', 'privileges', 'following-feed', 'account-deletion']],
];

// Files that change nothing about how the app works
const HARMLESS = [
  /\.md$/, /^\.gitignore$/, /^\.github\/dependabot\.yml$/, /^LICENSE/,
  /\.test\.jsx?$/, // unit tests: they are run by the unit test step
  /^scripts\//, // the tools that choose the tests (they have unit tests of their own)
  /^eslint\.config\.js$/, // lint is always run
  /^coverage\//, /^dist\//,
];

// Files that can change the behaviour of everything: run everything
const EVERYTHING = [
  /^package(-lock)?\.json$/, /^vite\.config\.js$/, /^playwright\.config\.js$/, /^index\.html$/,
  /^supabase\/config\.toml$/, /^e2e\/(helpers|api|env|global-setup|mail)\.js$/, /^src\/main\.jsx$/,
  /^src\/lib\/supabaseClient\.js$/, /^\.github\/workflows\//,
];

const matches = (patterns, file) => patterns.some((pattern) => pattern.test(file));

// Returns { specs: [...names], everything: boolean, reasons: { file: why } }
export function selectSpecs(files) {
  const specs = new Set();
  const reasons = {};
  let everything = false;

  for (const raw of files) {
    const file = raw.replaceAll('\\', '/');

    const ownSpec = file.match(/^e2e\/([\w-]+)\.spec\.js$/);
    if (ownSpec) {
      specs.add(ownSpec[1]);
      reasons[file] = 'a test that was changed';
      continue;
    }
    if (matches(HARMLESS, file)) {
      reasons[file] = 'no effect on the app';
      continue;
    }
    if (matches(EVERYTHING, file)) {
      everything = true;
      reasons[file] = 'can change everything';
      continue;
    }
    // Test helpers of the unit tests change no behaviour of the app either
    if (/^src\/test\//.test(file)) {
      reasons[file] = 'helper of the unit tests';
      continue;
    }

    const rules = RULES.filter(([pattern]) => pattern.test(file));
    if (rules.length === 0) {
      everything = true;
      reasons[file] = 'not known: to be safe, everything is run';
      continue;
    }
    for (const [, names] of rules) names.forEach((name) => specs.add(name));
    reasons[file] = `${rules.flatMap(([, names]) => names).length} tests look at it`;
  }

  return { specs: [...specs].sort(), everything, reasons };
}

// A change of the app (not only of tests) is also looked at by the core flows
export function needsSmoke(files) {
  return files.some((raw) => {
    const file = raw.replaceAll('\\', '/');
    return file.startsWith('src/') && !file.startsWith('src/test/') && !/\.test\.jsx?$/.test(file);
  });
}

export function touchesDatabase(files) {
  return files.some((file) => /^supabase\/(migrations\/|config\.toml)/.test(file.replaceAll('\\', '/')));
}
