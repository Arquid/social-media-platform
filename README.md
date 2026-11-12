<div align="center">

# Socialy

**A social media web app with real-time posts, likes, comments, follows and notifications.**

[![CI](https://github.com/Arquid/social-media-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Arquid/social-media-platform/actions/workflows/ci.yml)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
![Material UI](https://img.shields.io/badge/Material_UI-v9-007fff?logo=mui&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)
![Tests](https://img.shields.io/badge/tests-624_unit_%2B_271_e2e-brightgreen)

[Features](#features) · [Quick start](#quick-start) · [Local development](#local-development-with-docker) · [Testing](#testing) · [Database](#database) · [Deployment](#deployment)

</div>

---

## Features

### Accounts
| | |
|---|---|
| **Sign up and log in** | Protected routes, username rules (3-20 characters: `a-z`, `0-9`, `_`) checked in the form **and** by a database constraint |
| **Forgot password** | `/forgot-password` emails a link, `/reset-password` sets a new password. The answer never reveals whether an address has an account, a link works once, and a used or expired link shows "Link not valid" with a way to ask for a new one |
| **Email confirmation** | Works when switched on: the app shows "Check your email" instead of going home (off by default, see [Deployment](#deployment)) |
| **Profiles** | Display name, bio (max 160 characters), follower and following counts. Profile picture: JPEG, PNG or WebP, max 2 MB, in a public Storage bucket where users can only change their own folder |
| **Delete account** | "Delete account" on your own profile asks you to type your username, removes your profile picture from Storage and then deletes the account through the database function `delete_my_account()`. Your profile, posts, comments, likes, follows and notifications go with it, other people's feeds update live, and the username and email can be used again |
| **Password managers** | Every form tells browsers what each field is (`autocomplete`) |

### Social
| | |
|---|---|
| **Posts** | Create, **edit** and delete. A post can have **one picture** (JPEG, PNG or WebP, max 5 MB): you see a preview before posting, the file is kept in your own folder of a public Storage bucket, and it is removed again when the post (or your account) is deleted, or when saving the post fails. Your own new post appears at the top **at once**, even if realtime is slow or broken, and is never shown twice. An edited post says "· edited" (the exact time is in the tooltip), and everybody who has it on the screen sees the new text without reloading. The database allows changing the text only, and sets the time of the edit itself |
| **Likes and comments** | Counts are computed in the database (`posts_feed` view). Likes are **optimistic**: instant update, undone with an error toast if saving fails. Every comment shows the **profile picture** of its author. You can **delete your own comments** (the count follows, and others who read them see the comment go) |
| **Follow** | Follow / unfollow, with a **Following** feed filtered by the database (`posts_following_feed`), so it works for users who follow thousands of people |
| **Notifications** | Likes, comments and new followers, opened as the post (`/post/:id`) or the follower's profile. Repeating an action (like, unlike, like again) gives **one** notification, enforced by unique indexes |
| **Search** | `/search` finds people by username or display name (any letter case, part of a word), ranked and limited to 20. The text lives in the address (`/search?q=anna`), so reload, back button and shared links work |
| **Real time** | Feeds, comments, post pages and the notification badge update live. Only the changed post is fetched, the feed is not reloaded. Each page asks Realtime for **only what it shows**: the feed for the likes and comments of its (at most 100) posts, a post page for its own post, a profile page for that user's new posts. Likes on posts that are not on the screen never reach the browser |
| **Pagination** | Everything long comes 20 at a time with a button for more: the feeds, **notifications** and **comments** ("Load more", paged by id so nothing is skipped or shown twice, newest first, new ones go on top) and the **search** ("Show more", the database function takes a page size and a start). A page costs the same however long the list is, because each list has an index made for it |
| **Block and report** | **Block** from a profile (after a question): the person can no longer like, comment on or follow you (HTTP 403, a short neutral message), you stop following each other, and **you no longer see their posts, comments or notifications** anywhere: feeds, post page, counters and live updates. The profile says so and offers **Unblock**. Only you can see your blocks. **Report** a post, a comment or a person (spam, harassment, hate, violence, other, with optional details): the database records who is reported (it cannot be forged) and a copy of the text, even if the post is later edited or deleted. Reports cannot be read through the API; read them in the Supabase dashboard (table `reports`) |
| **Relative times** | "just now", "5 minutes ago", "yesterday", then a date. The exact time is in the tooltip and the text keeps up with the clock |

### Quality
| | |
|---|---|
| **Security** | Row Level Security on every table **plus least privilege**: a visitor has no privileges at all, a user can change only what the app needs (see [Database](#database)) |
| **Rate limits** | Per user and minute, enforced in the database (HTTP 429, code `PT429`): 10 posts, 20 comments, **60 likes, 30 follows, 20 blocks and 5 reports**. The post form shows a yellow warning and keeps the text; the other actions show the message in a toast |
| **Performance** | Every foreign key and feed query has an index. With 100 000 posts, 200 000 likes and 100 000 comments the first page of the feed takes 5 ms (1.5 s without the likes index) |
| **Accessibility** | One first level heading per page, `main` and `nav` landmarks, named spinners. [axe-core](https://github.com/dequelabs/axe-core) (WCAG 2.0 / 2.1 A and AA) finds **zero problems** in the light and the dark theme |
| **Theme and layout** | Responsive layout (Material UI). Light and dark theme, following the device until the user chooses (also before logging in). Both are checked for readable contrast |
| **Error handling** | Error toasts when a like, comment, follow or delete fails, a 404 page, an error boundary instead of a blank screen (navigation keeps working), and a "Reload page" button when a new release replaces the page files |
| **Error reporting** | Optional ([Sentry](https://sentry.io)): crashes and failed requests of other people's browsers are reported. Off unless `VITE_SENTRY_DSN` is set. Private by design: no user, cookies, address query or hash (a password reset link holds a secret there), no click or request history; offline noise, outdated-version errors and expected rate limits are not reported; at most 20 reports per page load |
| **Code splitting** | Pages load on demand and the big libraries (React, Material UI, Supabase) are separate, cacheable files |

## Tech stack

| | |
|---|---|
| Frontend | [React](https://react.dev) 19, [Vite](https://vite.dev), [Material UI](https://mui.com), [React Router](https://reactrouter.com) |
| Backend | [Supabase](https://supabase.com): Auth, PostgreSQL with Row Level Security, Realtime, Storage |
| Testing | [Vitest](https://vitest.dev) and [React Testing Library](https://testing-library.com/react), [Playwright](https://playwright.dev), [axe-core](https://github.com/dequelabs/axe-core) |
| Tooling | ESLint, Supabase CLI and Docker (local backend), [GitHub Actions](https://docs.github.com/actions) |

## Quick start

**You need:** Node.js 22.12 or newer (the test tools do not support Node 20) and a free [Supabase](https://supabase.com) account.

```bash
git clone https://github.com/Arquid/social-media-platform.git
cd social-media-platform
npm install
```

**1. Create the database.** In a new Supabase project open **SQL Editor -> New query** and run every file in [`supabase/migrations/`](supabase/migrations/) **in filename order** (what each one does: [Database](#database)).

**2. Set up sign in.** Go to **Authentication -> Providers -> Email** and turn **Confirm email** off for development.

**3. Add your keys.** Copy **Project URL** and the **anon public** key from **Project Settings -> API**:

```bash
cp .env.example .env
```

```ini
VITE_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
# Optional: error reporting (Sentry). Leave empty to send nothing.
VITE_SENTRY_DSN=
```

> Only use the `anon` key in the frontend. Never expose the `service_role` key.

**4. Run it.**

```bash
npm run dev
```

Open http://localhost:5173.

## Local development with Docker

Run the whole Supabase stack (auth, database, realtime, email inbox) on your own machine. Nothing leaves your computer, so it is a safe place for throwaway test accounts. You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) running. The Supabase CLI is a dev dependency.

```bash
npm run db:start      # first start downloads several Docker images
npm run db:status     # copy the ANON_KEY (or publishable key)
cp .env.localdb.example .env.localdb   # paste the key into VITE_SUPABASE_ANON_KEY
npm run dev:local     # the app against the local backend
```

All migrations are applied on a fresh start. If you add one while Supabase is running, use `npx supabase migration up`.

| Service | Address |
|---|---|
| Supabase Studio | http://127.0.0.1:54323 |
| Email inbox (Mailpit), including password reset emails | http://127.0.0.1:54324 |

Email confirmation is off locally. The links in emails lead back to the app on `localhost:5173` (addresses are listed in `supabase/config.toml`).

```bash
npm run db:stop       # stop the containers (data is kept)
npm run db:reset      # wipe the local database and re-apply migrations
```

`.env.localdb` is git-ignored. `.env.localdb.example` has throwaway test credentials that exist only in the local database.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `dev:local` | Development server against cloud Supabase (`.env`) / local Supabase (`.env.localdb`) |
| `npm run build` / `preview` | Build for production / preview the build |
| `npm run lint` | ESLint |
| `npm test` / `test:watch` | Unit and component tests (Vitest) / watch mode |
| `npm run test:coverage` | Unit tests with a coverage report (`coverage/index.html`); fails below the limits in `vite.config.js` |
| `npm run test:e2e` | End-to-end tests (Playwright, needs local Supabase) |
| `npm run verify` | **Fast check of your change**: lint, the unit tests and only the end-to-end tests that look at the changed files ([details](#fast-check-of-a-change)) |
| `npm run verify:all` | The same steps for everything, like the CI |
| `npm run db:start` / `db:stop` / `db:status` / `db:reset` | Local Supabase (Docker) |

## Testing

| Level | Count | Runs against | Command |
|---|---|---|---|
| Unit and component | **624** (599 app, 25 for the test selection) | Mocked Supabase, no backend. **98.4 %** of the statements and 99.8 % of the lines of `src/` are covered | `npm test` |
| End-to-end | **271** | Real browser and **local** Supabase | `npm run db:start` then `npm run test:e2e` |
| CI | all of the above | GitHub Actions | on every push and pull request |

### Fast check of a change

All end-to-end tests take about nine minutes, so while developing run

```bash
npm run verify
```

It looks at what you changed (`git diff` against the last commit plus new files) and runs

1. lint,
2. the unit tests that are affected by the change (`vitest --changed`),
3. only the end-to-end test files that look at those files, plus two quick core flows (`social`, `auth`) for any change in `src/`.

The local Supabase is started if it is not running and reset only when a migration changed. A change of one page takes about 5 minutes instead of 9 or more, and a change of documents takes seconds. Options: `-- --dry-run` shows the plan only, `-- --files=a,b` pretends that these files changed, `npm run verify:all` runs everything.

Which tests look at which file is a table in [`scripts/affected.js`](scripts/affected.js). A file that is not in the table makes **everything** run (a wrong guess costs time, never a missed bug), and unit tests in `scripts/affected.test.js` fail when a new e2e test, source file or migration has no entry. The CI always runs everything, so `verify` is the fast check and the CI is the last word.

Tests are also checked by **mutation**: a feature is broken on purpose and the matching test must fail.

<details>
<summary><b>What the unit tests cover</b></summary>

- **Posts and feed:** post cards (like, unlike, delete, avatars, error toasts, optimistic likes: instant update, undo on failure, no double counting), the feed (pagination cursor, duplicate protection, the Following tab and its view, new posts, the realtime filters: only the posts on the screen, at most 100, one new subscription for a burst of posts, profile page filter, cleanup), the post form and comment section (saving, double submit, errors, the rate limit as a yellow warning that keeps the text), the home page (a new post at the top at once, two in a row, no jump after a tab switch)
- **Account deletion:** the confirmation (exact username needed), the order (picture, then account), a failing picture removal or database stops everything, locked while working, double clicks, only on your own profile
- **Pages:** profile, post page, notifications, search (typing pause, one search per pause, spinner, empty and error states, ignoring slow answers, text in the address), 404, login, sign up ("Check your email"), forgot and reset password (the exact return address, same answer for any address, errors, mismatching passwords, double clicks)
- **Block and report:** the library (block, unblock, report a post, comment or person, the duplicate is not an error), the report dialog (reason needed, details limit, success in green, errors inside the dialog with the text kept, locked while sending), the block question (cancel and Escape block nobody, success and error messages, locked while working), the profile of a blocked person (note, Unblock, no feed, no Follow), the Report buttons (only on other people's posts and comments), and the red button of the dark theme (contrast)
- **Error reporting:** off without an address and Sentry not even loaded, private settings (no personal data, no tracing or replay), the cleaning of addresses, events and breadcrumbs, readable reports for database errors (code kept, row details left out), reports made while Sentry loads, the limit of 20, never throwing, reports from the error boundary (not for outdated versions) and from the failed queries (not for rate limits)
- **App shell:** route protection, routing for unknown addresses, error boundary (catching, "Try again", reset on navigation, outdated version detection), navigation bar, theme toggle and both color schemes (WCAG contrast)
- **Structure:** one first level heading per page in every state, `main` and `nav` areas, spinner names, `autocomplete` attributes
- **Helpers:** avatar validation and storage calls, search library, rate limit error check, relative time texts (every limit, future times, six time zones), clock hook, debounce hook

</details>

<details>
<summary><b>What the end-to-end tests cover</b></summary>

They create throwaway accounts and use two separate browser sessions to check real-time behaviour.

| File | Checks |
|---|---|
| `auth.spec.js` | Redirect for visitors, sign up validation, sign up, log out and in, wrong password, taken username |
| `social.spec.js` | Two users post, like, comment, follow and are notified in real time; unliking |
| `database.spec.js` | The database rejects invalid and duplicate usernames, also on rename |
| `profile.spec.js` | Editing profiles, uploading, replacing and removing real picture files, old files deleted from storage |
| `profile-storage.spec.js` | Avatar uploads: own folder only, images only, max 2 MB; profile field limits |
| `post-page.spec.js` | Notification links open the post page, live updates, "not found" cases |
| `notifications.spec.js` | No duplicate notifications for repeated likes or follows (comments still notify), read stays read, users cannot create notifications |
| `optimistic-like.spec.js` | Slow or broken network: instant update, correct counter, undo with an error message |
| `account-deletion.spec.js` | The whole path in the browser: a user with a picture, post, comment, like and follows deletes the account. Every row and the picture file are gone, a friend's data stays and the friend's open page updates live, the old login stops working and the name can be used again. Also: exact username needed, a failing picture removal keeps the account, and the function deletes only the caller's account and cannot be called without logging in |
| `post-images.spec.js` | The storage and the database for post pictures: own folder only, no visitors, only JPEG/PNG/WebP, exactly 5 MB passes and one byte more does not, only the owner can remove a file, no replacing in place, `image_path` only into the author's folder, the picture cannot be changed afterwards, visible in both feed views |
| `post-images-ui.spec.js` | In the browser: preview, picture in the post (also after a reload, on the post page and profile), removing before posting, wrong type and too big refused, other people see it live, text editing keeps it, deleting the post removes the file, a post that cannot be saved leaves no file behind; avatars next to comments |
| `edit-post.spec.js` | Editing a post in the database: the text changes and `edited_at` is set by the database, saving the same text is not an edit, nobody else can edit, no visitors, author/time/edit time cannot be changed (not even together with the text), 1-500 characters, likes and comments stay, the feed views show the edit time |
| `post-editing-ui.spec.js` | In the browser: editing a post (also on the post page and profile), "edited" mark after a reload, Cancel and same text, edit button on own posts only, other people see the edit live (feed and post page); deleting a comment (count goes down, live for readers, under a feed post too) |
| `pagination.spec.js` | Lists longer than a page in the browser: 45 notifications, 45 comments (also under a post in the feed) and 45 search results, 20 at a time, newest first, nobody twice, the button gone on the last page, new notifications and comments on top (also your own), the search starting over when the text changes |
| `realtime-filters.spec.js` | Reads the real WebSocket messages of the page: likes and comments of posts that are not shown never arrive (feed and post page), a profile page gets only that user's new posts, while the shown posts still update live (like, unlike, comment, your own new post) |
| `own-post.spec.js` | With realtime blocked completely your own posts still appear at once, in order, exactly once |
| `following-feed.spec.js` | 1100 followed people (the old request failed at about 400), only followed users' posts, cursor paging, unfollowing, no access without logging in |
| `search.spec.js` | The search function: letter case, ranking, limit of 20, trimming, logged-in only, public fields only, special characters as plain text, trigram indexes used |
| `search-ui.spec.js` | The search in the browser: one search after fast typing, text in the address, reload and back button |
| `password-reset.spec.js` | Reads emails from the local inbox and follows the link: new password works, old does not, link works once, expired link, unknown address gets the same answer and no email |
| `rate-limit.spec.js` | HTTP 429 on the 11th post and 21st comment, separate quotas, parallel and bulk requests, tampering with the log, backdated posts, quota returns after a minute |
| `abuse.spec.js` | Straight against the database: the 61st like, 31st follow, 21st block and 6th report are refused with 429 (deleting does not give the quota back, per user and per kind, back after a minute); blocking and unblocking, only your own blocks are visible, no blocking in another name or yourself or twice; a blocked user is refused 403 when liking, commenting or following (nothing stored, no quota used), and the blocker cannot follow them either; the follows end in both directions; the blocker does not see the posts (both feeds, by id), the comments (and the counter) or the notifications of the blocked user, others and the blocked user see everything; reports: a post, comment or person, the reported person and the copy of the text come from the database (cannot be forged), the copy stays after an edit and the report after a delete, duplicates, wrong reports, nobody can read, change or delete reports |
| `abuse-ui.spec.js` | In the browser: the block question (cancel blocks nobody), the note, no Follow and no feed for a blocked person, the same after a reload, in the home feed, and Unblock; the follows end and the blocked person is refused by the page (follow, like, comment) with a short message; the blocker is **sent no live posts or comments** of the blocked person but still those of others; reporting a post, comment and person with the owner reading who, what, why and the copy; no Report button on your own things, and a cancelled report sends nothing |
| `rate-limit-ui.spec.js` | The same limits through the app: yellow warning, text kept, works again after a minute |
| `privileges.spec.js` | Database privileges compared with a list (a new table without a decision fails), forbidden operations tried through the API, normal operations still work |
| `indexes.spec.js` | Expected indexes exist, every foreign key has a usable index, query plans use indexes on tables with tens of thousands of rows |
| `accessibility.spec.js` | axe-core on every page and the edit dialog, for visitors and users, in both themes; landmarks, headings, names |
| `theme-and-time.spec.js` | Theme on dark and light devices (toggle, remembered, contrast measured in the browser) and the time texts |
| `errors.spec.js` | 404 page, a crashed page, a blocked page file, working navigation and "Reload page" recovery |
| `error-reporting.spec.js` | A second copy of the app with reporting on sends to an address that does not exist, and the test reads the message: a crash and a failing request are reported (where, code, component), a report holds none of the query, hash, email, password or login token of the page, offline errors and outdated versions are not reported; with reporting off nothing is sent and the Sentry file is not downloaded |

</details>

### Running the end-to-end tests

- Needs `.env.localdb` (see [Local development](#local-development-with-docker)). The tests **refuse to run** unless it points to `localhost`.
- The dev server for the tests starts automatically on port 5175. The setup also waits until Realtime accepts subscriptions, so you can run the tests right after `db:start` or `db:reset`.
- By default the tests use the Edge that ships with Windows, so no browser download is needed. Use `E2E_BROWSER=chrome npm run test:e2e` for Chrome, or `npx playwright install chromium` and `E2E_BROWSER=chromium`.
- Reports are written to `playwright-report/` (git-ignored).

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and every pull request:

1. **Vulnerability check, lint, unit tests with coverage, and build.** `npm audit` stops the build if a package that the app ships to users has a known high or critical vulnerability (development tools are reported only). The tests fail if they cover less than 95 % of the statements, 88 % of the branches, 95 % of the functions or 95 % of the lines.
2. **End-to-end tests**, after step 1: starts a local Supabase in Docker (fresh database, all migrations), creates `.env.localdb`, installs Chromium and runs the tests. A failed test is retried once, because a freshly started machine can be slow. On failure the Playwright report is uploaded as an artifact (kept for 7 days).

No secrets are needed: the tests only use the throwaway database inside the runner.

**Updates.** [Dependabot](.github/dependabot.yml) opens a pull request every Monday: one for all minor and patch updates of the npm packages, one for each major version, and one for the GitHub Actions. Each runs the whole CI, so a bad update shows up there before it is merged. Security fixes come as pull requests of their own at once.

### Trying real time by hand

1. Sign up two users (a normal window and an incognito window).
2. Post as user B: it appears in user A's feed without a refresh.
3. Like and comment as user A: user B's notification badge updates instantly.
4. Follow user B from their profile and check the "Following" tab.

## Database

### Migrations

Run them in filename order. On a fresh local database they are applied automatically.

| Migration | What it does |
|---|---|
| `init_schema` | Tables, notification triggers, Row Level Security policies, realtime setup |
| `posts_feed_view` | `posts_feed` view: posts with author and computed like and comment counts |
| `posts_pagination_index` | Index for "posts by user, newest first" |
| `username_format_constraint` | Username rule as a check constraint (added `NOT VALID`, see below) |
| `profile_editing_and_avatars` | Profile columns and limits, public `avatars` bucket and its policies |
| `dedupe_notifications` | Removes duplicate like and follow notifications (keeps the oldest), adds the unique indexes |
| `rate_limits` | Private log table `rate_limit_events` and triggers on posts and comments |
| `user_search` | `search_profiles` function with trigram indexes |
| `missing_indexes` | Six indexes found by a load test (feed, followers, notifications, foreign keys) |
| `following_feed` | `posts_following_feed` view |
| `least_privilege` | Removes excess privileges from the API roles, closes new objects by default |
| `delete_account` | `delete_my_account()` function: a logged-in user deletes their own account (only the caller's, only when logged in) |
| `pagination` | Indexes for paging notifications and comments by id (they replace the older ones), and `search_profiles` with a page size and a start |
| `edit_posts` | Editing posts: `posts.edited_at` (set by a trigger, only when the text really changes), the policy "posts update own", the privilege to change the column `content` only, and the new column in the feed views |
| `post_images` | Pictures in posts: the public bucket `post-images` (5 MB, JPEG/PNG/WebP, only the owner's own folder), the column `posts.image_path` (must point into the author's own folder, cannot be changed afterwards) and the new column in the feed views |
| `abuse_protection` | Rate limits for likes, follows, blocks and reports (the rate limit function now also works for tables whose user column has another name); the table `blocks` with its policies, the triggers that refuse likes, comments and follows across a block and end the follows, and policies that hide the blocked user's posts, comments and notifications from the blocker; the table `reports` (insert only, six columns, nobody can read it through the API) with a trigger that fills in the reported person and a copy of the text |

> The username constraint is `NOT VALID`, so it only applies to new and changed profiles. If your project already has profiles that break the rule, fix them and run `alter table profiles validate constraint profiles_username_format;`.

### Security model

- **Row Level Security** is on for every table; policies decide which rows a user may touch.
- **Least privilege** decides which *kinds* of operations are possible at all:

  | Role | Can do |
  |---|---|
  | Visitor (`anon`) | Nothing. The API answers 401, not an empty list |
  | Logged-in user | Read; add and delete own posts, comments, likes and follows; change the **text** of own posts; edit own profile; set the `read` flag of own notifications; delete own account (`delete_my_account()`) |
  | Nobody through the API | Change the author, time or edit time of a post; edit likes, follows or comments; delete profiles; touch the rate limit log; call trigger functions; read, change or delete reports; see who has blocked them |

- New tables, sequences and functions are **closed by default** until a migration grants access, and a test fails if a table has no decision.
- Rate limits live in triggers, so parallel requests, bulk inserts, deleting posts and backdated posts cannot get around them. Deleting a like or a follow does not give the quota back.
- **Blocking is enforced by the database**, not by the pages: the policies of `posts`, `comments` and `notifications` hide the blocked user's rows (every view, count and realtime message follows), and triggers refuse the blocked user's actions.
- **CAPTCHA** for the sign up is not in the code: it is switched on in the Supabase dashboard (Authentication -> Attack Protection) together with Turnstile or hCaptcha, when the app is published.

## Project structure

```
src/
├── main.jsx, App.jsx, theme.js   # Entry, routes (lazy pages, error boundary, 404), light and dark colors
├── pages/                        # Login, Register, ForgotPassword, ResetPassword, Home, Profile,
│                                 # PostPage, Notifications, Search, NotFound
├── components/                   # Navbar, Feed, PostCard, PostForm, CommentSection, FollowButton,
│                                 # EditProfileDialog, UserAvatar, TimeAgo, ThemeToggle, PageTitle,
│                                 # ProtectedRoute, ErrorBoundary
├── context/, hooks/              # Auth and toast providers; useAuth, useToast, useDebouncedValue, useNow
├── lib/                          # Supabase client, avatars, search, error reporting, rate limit errors, relative time
└── test/                         # Test setup, Supabase mocks, render helper (*.test.jsx sit next to the code)
e2e/                              # Playwright end-to-end tests
supabase/
├── config.toml                   # Local Supabase (Docker) configuration
└── migrations/                   # Schema, triggers, RLS policies, privileges
.github/workflows/ci.yml          # GitHub Actions
```

## Deployment

The app can be deployed to Vercel or Netlify.

1. Import the GitHub repository.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables. To hear about errors, create a project at [sentry.io](https://sentry.io) (type React) and add its DSN as `VITE_SENTRY_DSN`; without it nothing is reported.
3. In Supabase open **Authentication -> URL Configuration**. Set **Site URL** to your deployed address and add it (and `http://localhost:5173` for development) to **Redirect URLs**. Password reset and confirmation emails send users back through these addresses.
4. **Email for real users.** Supabase's built-in email service only delivers to members of your own Supabase team, a few emails an hour. Set up your own SMTP server in **Authentication -> SMTP Settings** (Resend, Brevo, ...), otherwise password reset emails will not reach your users. Keep **Confirm email** off until that works.
5. For Vercel add a `vercel.json` so that page refreshes on client-side routes work:

   ```json
   {
     "rewrites": [{ "source": "/(.*)", "destination": "/" }]
   }
   ```

## Ideas for future development

- Hide blocked people from the search results
- Avatars in the notification list
- Links from feed posts (for example from the timestamp) to the post page
- Infinite scroll instead of the "Load more" button
