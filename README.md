<div align="center">

# Socialy

**A social media web app with real-time posts, likes, comments, follows and notifications.**

[![CI](https://github.com/Arquid/social-media-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Arquid/social-media-platform/actions/workflows/ci.yml)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
![Material UI](https://img.shields.io/badge/Material_UI-v9-007fff?logo=mui&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)
![Tests](https://img.shields.io/badge/tests-363_unit_%2B_161_e2e-brightgreen)

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
| **Password managers** | Every form tells browsers what each field is (`autocomplete`) |

### Social
| | |
|---|---|
| **Posts** | Create and delete. Your own new post appears at the top **at once**, even if realtime is slow or broken, and is never shown twice |
| **Likes and comments** | Counts are computed in the database (`posts_feed` view). Likes are **optimistic**: instant update, undone with an error toast if saving fails |
| **Follow** | Follow / unfollow, with a **Following** feed filtered by the database (`posts_following_feed`), so it works for users who follow thousands of people |
| **Notifications** | Likes, comments and new followers, opened as the post (`/post/:id`) or the follower's profile. Repeating an action (like, unlike, like again) gives **one** notification, enforced by unique indexes |
| **Search** | `/search` finds people by username or display name (any letter case, part of a word), ranked and limited to 20. The text lives in the address (`/search?q=anna`), so reload, back button and shared links work |
| **Real time** | Feeds, comments, post pages and the notification badge update live. Only the changed post is fetched, the feed is not reloaded. Each page asks Realtime for **only what it shows**: the feed for the likes and comments of its (at most 100) posts, a post page for its own post, a profile page for that user's new posts. Likes on posts that are not on the screen never reach the browser |
| **Pagination** | Cursor-based: 20 posts at a time with "Load more" |
| **Relative times** | "just now", "5 minutes ago", "yesterday", then a date. The exact time is in the tooltip and the text keeps up with the clock |

### Quality
| | |
|---|---|
| **Security** | Row Level Security on every table **plus least privilege**: a visitor has no privileges at all, a user can change only what the app needs (see [Database](#database)) |
| **Rate limits** | At most 10 posts and 20 comments per user per minute, enforced in the database (HTTP 429, code `PT429`). The post form shows a yellow warning and keeps the text |
| **Performance** | Every foreign key and feed query has an index. With 100 000 posts, 200 000 likes and 100 000 comments the first page of the feed takes 5 ms (1.5 s without the likes index) |
| **Accessibility** | One first level heading per page, `main` and `nav` landmarks, named spinners. [axe-core](https://github.com/dequelabs/axe-core) (WCAG 2.0 / 2.1 A and AA) finds **zero problems** in the light and the dark theme |
| **Theme and layout** | Responsive layout (Material UI). Light and dark theme, following the device until the user chooses (also before logging in). Both are checked for readable contrast |
| **Error handling** | Error toasts when a like, comment, follow or delete fails, a 404 page, an error boundary instead of a blank screen (navigation keeps working), and a "Reload page" button when a new release replaces the page files |
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
| `npm run test:e2e` | End-to-end tests (Playwright, needs local Supabase) |
| `npm run db:start` / `db:stop` / `db:status` / `db:reset` | Local Supabase (Docker) |

## Testing

| Level | Count | Runs against | Command |
|---|---|---|---|
| Unit and component | **363** | Mocked Supabase, no backend | `npm test` |
| End-to-end | **161** | Real browser and **local** Supabase | `npm run db:start` then `npm run test:e2e` |
| CI | all of the above | GitHub Actions | on every push and pull request |

Tests are also checked by **mutation**: a feature is broken on purpose and the matching test must fail.

<details>
<summary><b>What the unit tests cover</b></summary>

- **Posts and feed:** post cards (like, unlike, delete, avatars, error toasts, optimistic likes: instant update, undo on failure, no double counting), the feed (pagination cursor, duplicate protection, the Following tab and its view, new posts, the realtime filters: only the posts on the screen, at most 100, one new subscription for a burst of posts, profile page filter, cleanup), the post form and comment section (saving, double submit, errors, the rate limit as a yellow warning that keeps the text), the home page (a new post at the top at once, two in a row, no jump after a tab switch)
- **Pages:** profile, post page, notifications, search (typing pause, one search per pause, spinner, empty and error states, ignoring slow answers, text in the address), 404, login, sign up ("Check your email"), forgot and reset password (the exact return address, same answer for any address, errors, mismatching passwords, double clicks)
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
| `realtime-filters.spec.js` | Reads the real WebSocket messages of the page: likes and comments of posts that are not shown never arrive (feed and post page), a profile page gets only that user's new posts, while the shown posts still update live (like, unlike, comment, your own new post) |
| `own-post.spec.js` | With realtime blocked completely your own posts still appear at once, in order, exactly once |
| `following-feed.spec.js` | 1100 followed people (the old request failed at about 400), only followed users' posts, cursor paging, unfollowing, no access without logging in |
| `search.spec.js` | The search function: letter case, ranking, limit of 20, trimming, logged-in only, public fields only, special characters as plain text, trigram indexes used |
| `search-ui.spec.js` | The search in the browser: one search after fast typing, text in the address, reload and back button |
| `password-reset.spec.js` | Reads emails from the local inbox and follows the link: new password works, old does not, link works once, expired link, unknown address gets the same answer and no email |
| `rate-limit.spec.js` | HTTP 429 on the 11th post and 21st comment, separate quotas, parallel and bulk requests, tampering with the log, backdated posts, quota returns after a minute |
| `rate-limit-ui.spec.js` | The same limits through the app: yellow warning, text kept, works again after a minute |
| `privileges.spec.js` | Database privileges compared with a list (a new table without a decision fails), forbidden operations tried through the API, normal operations still work |
| `indexes.spec.js` | Expected indexes exist, every foreign key has a usable index, query plans use indexes on tables with tens of thousands of rows |
| `accessibility.spec.js` | axe-core on every page and the edit dialog, for visitors and users, in both themes; landmarks, headings, names |
| `theme-and-time.spec.js` | Theme on dark and light devices (toggle, remembered, contrast measured in the browser) and the time texts |
| `errors.spec.js` | 404 page, a crashed page, a blocked page file, working navigation and "Reload page" recovery |

</details>

### Running the end-to-end tests

- Needs `.env.localdb` (see [Local development](#local-development-with-docker)). The tests **refuse to run** unless it points to `localhost`.
- The dev server for the tests starts automatically on port 5175. The setup also waits until Realtime accepts subscriptions, so you can run the tests right after `db:start` or `db:reset`.
- By default the tests use the Edge that ships with Windows, so no browser download is needed. Use `E2E_BROWSER=chrome npm run test:e2e` for Chrome, or `npx playwright install chromium` and `E2E_BROWSER=chromium`.
- Reports are written to `playwright-report/` (git-ignored).

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and every pull request:

1. **Lint, unit tests and build.**
2. **End-to-end tests**, after step 1: starts a local Supabase in Docker (fresh database, all migrations), creates `.env.localdb`, installs Chromium and runs the tests. A failed test is retried once, because a freshly started machine can be slow. On failure the Playwright report is uploaded as an artifact (kept for 7 days).

No secrets are needed: the tests only use the throwaway database inside the runner.

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

> The username constraint is `NOT VALID`, so it only applies to new and changed profiles. If your project already has profiles that break the rule, fix them and run `alter table profiles validate constraint profiles_username_format;`.

### Security model

- **Row Level Security** is on for every table; policies decide which rows a user may touch.
- **Least privilege** decides which *kinds* of operations are possible at all:

  | Role | Can do |
  |---|---|
  | Visitor (`anon`) | Nothing. The API answers 401, not an empty list |
  | Logged-in user | Read; add and delete own posts, comments, likes and follows; edit own profile; set the `read` flag of own notifications |
  | Nobody through the API | Edit posts, likes, follows or comments; delete profiles; touch the rate limit log; call trigger functions |

- New tables, sequences and functions are **closed by default** until a migration grants access, and a test fails if a table has no decision.
- Rate limits live in triggers, so parallel requests, bulk inserts, deleting posts and backdated posts cannot get around them.

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
├── lib/                          # Supabase client, avatars, search, rate limit errors, relative time
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
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables.
3. In Supabase open **Authentication -> URL Configuration**. Set **Site URL** to your deployed address and add it (and `http://localhost:5173` for development) to **Redirect URLs**. Password reset and confirmation emails send users back through these addresses.
4. **Email for real users.** Supabase's built-in email service only delivers to members of your own Supabase team, a few emails an hour. Set up your own SMTP server in **Authentication -> SMTP Settings** (Resend, Brevo, ...), otherwise password reset emails will not reach your users. Keep **Confirm email** off until that works.
5. For Vercel add a `vercel.json` so that page refreshes on client-side routes work:

   ```json
   {
     "rewrites": [{ "source": "/(.*)", "destination": "/" }]
   }
   ```

## Ideas for future development

- Images in posts (Supabase Storage)
- Avatars next to comments and in the notification list
- Links from feed posts (for example from the timestamp) to the post page
- Infinite scroll instead of the "Load more" button
