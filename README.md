# Socialy - Social Media Platform

[![CI](https://github.com/Arquid/social-media-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Arquid/social-media-platform/actions/workflows/ci.yml)

A social media web app built with React and Supabase. Users can sign up, post, like, comment, follow each other and get real-time notifications.

## Features

- User authentication (sign up, log in, log out) with protected routes
- User profiles with follower and following counts
- Profile editing: display name, bio (max 160 characters) and profile picture (JPEG, PNG or WebP, max 2 MB, stored in a public Supabase Storage bucket; users can only change files in their own folder). Pictures show on profiles and next to posts
- Create and delete posts
- Like posts and comment on them (like and comment counts are computed in the database through the `posts_feed` view)
- Follow / unfollow users, with a "Following" feed
- Notifications for likes, comments and new followers. Clicking a like or comment notification opens the post on its own page (`/post/:id`, comments open, updates in real time); a follow notification opens the follower's profile. Repeating an action does not spam the recipient: like, unlike, like again (or follow, unfollow, follow again) gives one notification, enforced by unique indexes in the database. Every comment still notifies
- Cursor-based pagination: feeds load 20 posts at a time with a "Load more" button
- Code splitting: pages are loaded on demand (`React.lazy`) and the big libraries (React, Material UI, Supabase) are built into separate, cacheable files (no file over 270 kB, app code about 6 kB)
- Real-time updates for feeds, comments and the notification badge (only the changed post is fetched, the whole feed is not reloaded)
- Username validation on sign up (3-20 characters: lowercase letters, numbers, underscores), enforced both in the form and by a database check constraint
- Error toasts when likes, comments, follows or deletes fail
- Accessible icon buttons (ARIA labels)
- Automated tests: 95 unit/component tests (Vitest) and 49 end-to-end tests (Playwright)
- Continuous integration: GitHub Actions runs lint, unit tests, build and the end-to-end tests on every push and pull request
- Responsive UI built with Material UI

## Tech Stack

- [React](https://react.dev) 19 + [Vite](https://vite.dev)
- [Material UI](https://mui.com) (`@mui/material`, `@mui/icons-material`)
- [React Router](https://reactrouter.com)
- [Supabase](https://supabase.com) (Auth, PostgreSQL, Row Level Security, Realtime), with the Supabase CLI and Docker for local development
- [Vitest](https://vitest.dev) + [React Testing Library](https://testing-library.com/react) for unit tests, [Playwright](https://playwright.dev) for end-to-end tests
- [GitHub Actions](https://docs.github.com/actions) for continuous integration

## Getting Started

### Prerequisites

- Node.js 22.12 or newer (the test tools do not support Node 20)
- A free [Supabase](https://supabase.com) account

### 1. Clone and install

```bash
git clone https://github.com/Arquid/social-media-platform.git
cd social-media-platform
npm install
```

### 2. Set up Supabase

1. Create a new project in the Supabase dashboard.
2. Open **SQL Editor -> New query**, then paste and run each file in [`supabase/migrations/`](supabase/migrations/) **in filename order** (initial schema, `posts_feed` view, pagination index, username format constraint, profile editing and avatars, notification de-duplication). The avatars migration also creates the public `avatars` storage bucket and its policies. The last migration first deletes duplicate like/follow notifications that already exist (keeping the oldest) and then adds the unique indexes.
   This creates the tables, notification triggers, Row Level Security policies and the realtime setup.
3. For local development, go to **Authentication -> Providers -> Email** and turn **Confirm email** off.
4. Go to **Project Settings -> API** and copy the **Project URL** and the **anon public** key.

Note: the username constraint is added as `NOT VALID`, so it only applies to new and changed profiles. If your project already has profiles with usernames that break the rule (3-20 characters of `a-z`, `0-9`, `_`), fix them and then run `alter table profiles validate constraint profiles_username_format;`.

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
```

Only use the `anon` key in the frontend. Never expose the `service_role` key.

### 4. Run the app

```bash
npm run dev
```

Open http://localhost:5173.

## Local Development with Docker (optional)

Instead of a cloud project you can run the whole Supabase stack (auth, database, realtime) on your own machine. Nothing leaves your computer, so it is a good way to create throwaway test accounts.

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/) running. The Supabase CLI is installed as a dev dependency.

```bash
npm install
npm run db:start      # first start downloads several Docker images
```

All migrations in `supabase/migrations/` are applied automatically on a fresh start. If you add a new migration while Supabase is running, apply it with `npx supabase migration up`. Then:

1. Run `npm run db:status` and copy the `ANON_KEY` (or the publishable key).
2. Copy `.env.localdb.example` to `.env.localdb` and paste the key into `VITE_SUPABASE_ANON_KEY`.
3. Start the app against the local backend:

```bash
npm run dev:local
```

Open the URL Vite prints. Local Supabase Studio is at http://127.0.0.1:54323 and the local email inbox (Mailpit) at http://127.0.0.1:54324. Email confirmation is disabled locally.

When you are done:

```bash
npm run db:stop       # stop the containers (data is kept)
npm run db:reset      # wipe the local database and re-apply migrations
```

`.env.localdb` is git-ignored. `.env.localdb.example` also contains throwaway test account credentials that only exist in the local database.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server (cloud Supabase from `.env`) |
| `npm run dev:local` | Start the development server against local Supabase (`.env.localdb`) |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit and component tests (Vitest) |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:e2e` | Run end-to-end tests (Playwright, needs local Supabase) |
| `npm run db:start` / `db:stop` | Start / stop local Supabase (Docker) |
| `npm run db:status` | Show local Supabase URLs and keys |
| `npm run db:reset` | Reset the local database and re-apply migrations |

## Project Structure

```
src/
├── main.jsx                 # App entry, theme and providers
├── App.jsx                  # Routes (pages are lazy-loaded)
├── lib/supabaseClient.js    # Supabase client
├── lib/avatars.js           # Avatar upload, delete, URL and file validation helpers
├── context/                 # Auth and toast providers with their context objects
├── hooks/                   # useAuth and useToast hooks
├── components/              # Navbar, Feed, PostCard, PostForm, CommentSection, FollowButton, ProtectedRoute, UserAvatar, EditProfileDialog
├── pages/                   # Login, Register, Home, Profile, PostPage, Notifications
└── test/                    # Test setup, Supabase mocks and render helper (*.test.jsx files live next to the code)
e2e/                         # Playwright end-to-end tests
.github/workflows/ci.yml     # GitHub Actions: lint, unit tests, build, e2e
supabase/
├── config.toml              # Local Supabase (Docker) configuration
└── migrations/              # Database schema, triggers, RLS policies
```

## Testing

### Unit and component tests (Vitest + React Testing Library)

```bash
npm test
```

These run without any backend: the Supabase client is mocked. They cover route protection, sign up validation, post cards (like, unlike, delete, avatars, error toasts), the feed (pagination cursor, duplicate protection, following and profile filters, realtime cleanup), the profile page, the post page (invalid ids, real-time updates, deletion), the notifications page (links, marking as read), the edit profile dialog (saving, picture upload/replace/remove, cleanup when saving fails) and the avatar helpers (file validation, storage calls).

### End-to-end tests (Playwright)

The e2e tests drive a real browser against the **local** Supabase, create throwaway accounts and use two separate browser sessions to verify real-time behavior (posts, likes, comments, follows, notifications). `e2e/database.spec.js` calls the Supabase API directly, skipping the form, to prove that the database rejects invalid and duplicate usernames. `e2e/profile-storage.spec.js` does the same for avatar uploads (own folder only, images only, max 2 MB) and the profile field limits. `e2e/profile.spec.js` edits profiles in the browser, uploads, replaces and removes real picture files and checks that old files are deleted from storage. `e2e/post-page.spec.js` clicks notifications to open the post page, checks its live updates and the "not found" cases. `e2e/notifications.spec.js` proves that repeated likes and follows do not create duplicate notifications (while comments still do), that read notifications stay read and that users cannot create notifications themselves.

```bash
npm run db:start
npm run test:e2e
```

- Requires `.env.localdb` (see "Local Development with Docker"). The tests refuse to run if it does not point to `localhost`.
- The dev server for the tests starts automatically on port 5175. Before the first test the setup also waits until Supabase Realtime accepts subscriptions, so you can run the tests right after `npm run db:start` or `npm run db:reset`.
- By default the tests use the Edge that ships with Windows, so no browser download is needed. Use `E2E_BROWSER=chrome npm run test:e2e` to use Chrome instead, or run `npx playwright install chromium` and use `E2E_BROWSER=chromium`.
- Test reports are written to `playwright-report/` (git-ignored).

### Continuous integration (GitHub Actions)

The workflow in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and on every pull request:

1. **Lint, unit tests and build** (`npm run lint`, `npm test`, `npm run build`).
2. **End-to-end tests**, after step 1 succeeds: starts a local Supabase in Docker (all migrations are applied to a fresh database), creates `.env.localdb` from `supabase status`, installs Chromium and runs `npm run test:e2e`. If a test fails, the Playwright report and traces are uploaded as the `playwright-report` artifact (kept for 7 days).

No secrets are needed: the end-to-end tests only use the throwaway local database inside the CI runner.

### Manual check of real-time features

1. Sign up two users (use a normal window and an incognito window).
2. Post as user B. The post appears in user A's feed without a refresh.
3. Like and comment as user A. User B's notification badge updates instantly.
4. Follow user B from their profile page and check the "Following" tab.

## Deployment

The app can be deployed to Vercel or Netlify:

1. Import the GitHub repository.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables.
3. Add your deployed URL to **Authentication -> URL Configuration -> Site URL** in Supabase.
4. For Vercel, add a `vercel.json` so that page refreshes on client-side routes work:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/" }]
}
```

## Ideas for Future Development

- Images in posts (Supabase Storage)
- Avatars next to comments and in the notification list
- A 404 page for unknown addresses (unknown posts already show a message)
- Links from feed posts (for example from the timestamp) to the post page
- User search
- Infinite scroll instead of the "Load more" button
- Dark mode
