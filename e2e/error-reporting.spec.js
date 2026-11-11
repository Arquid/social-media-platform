import { test, expect } from '@playwright/test';
import { newUser, signUp, bell } from './helpers';

// Error reporting in a real browser. The app sends a report to an address that does not exist
// (see REPORTING_DSN in playwright.config.js); the test catches the message on its way out and
// reads it. Nothing leaves the computer.

const NOTIFICATIONS_FILE = '**/src/pages/Notifications.jsx*';
const REPORT_ADDRESS = '**/api/42/envelope/**';
const CRASH = "export default function Notifications() { throw new Error('test crash'); }";

// An envelope is lines of JSON: its header, then for each item a header and the content
function readEvents(body) {
  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((part) => part && (part.exception || part.message));
}

// Catches the reports. `reports` is what was sent: the whole text, and the events in it
async function catchReports(page) {
  const reports = [];
  await page.route(REPORT_ADDRESS, (route) => {
    const body = route.request().postData() ?? '';
    reports.push({ body, events: readEvents(body) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  });
  return reports;
}

const messages = (reports) => reports.flatMap((r) => r.events).map((e) => e.exception?.values?.[0]?.value ?? e.message);
const crashNotifications = (page) => page.route(NOTIFICATIONS_FILE, (route) => route.fulfill({ contentType: 'text/javascript', body: CRASH }));

test.describe('error reporting is on', () => {
  test.use({ baseURL: 'http://localhost:5176' });

  test('a page that crashes is reported, with where it happened and the component that failed', async ({ page }) => {
    const reports = await catchReports(page);
    await signUp(page, newUser('rep'));
    await crashNotifications(page);

    await bell(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible();

    await expect.poll(() => messages(reports)).toContain('test crash');
    const event = reports.flatMap((r) => r.events).find((e) => e.exception?.values?.[0]?.value === 'test crash');
    expect(event.tags.where).toBe('interface');
    expect(event.extra.componentStack).toContain('Notifications');
    expect(event.environment).toBe('localdb');
  });

  test('the report holds no secrets: not the address query, the hash, the email or the login', async ({ page }) => {
    const reports = await catchReports(page);
    const user = newUser('priv');
    await signUp(page, user);
    const loginToken = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
      return JSON.parse(localStorage.getItem(key)).access_token;
    });
    await crashNotifications(page);

    // Like the link of a password reset: the secrets are in the query and in the hash
    await page.goto('/notifications?code=secretcode123#access_token=secrethash456');
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible();
    await expect.poll(() => messages(reports)).toContain('test crash');

    const everything = reports.map((r) => r.body).join('\n');
    for (const secret of ['secretcode123', 'secrethash456', user.email, user.password, loginToken]) {
      expect(everything).not.toContain(secret);
    }
    const event = reports.flatMap((r) => r.events).find((e) => e.exception?.values?.[0]?.value === 'test crash');
    expect(event.request.url).toBe('http://localhost:5176/notifications');
    expect(event.user).toBeUndefined();
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.headers?.Referer).toBeUndefined();
    // The history is only the moves between pages, and cleaned too
    for (const crumb of event.breadcrumbs ?? []) expect(crumb.category).toBe('navigation');
  });

  test('a failing request is reported with a readable message and the code, and the page shows its own message', async ({ page }) => {
    const reports = await catchReports(page);
    await signUp(page, newUser('rpc'));
    await page.route('**/rest/v1/rpc/search_profiles*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'the database is on fire', code: 'XX000', details: 'Key (username)=(somebody) is private', hint: null }),
      })
    );

    await page.goto('/search?q=ann');
    await expect(page.getByText(/the database is on fire/)).toBeVisible();

    await expect.poll(() => messages(reports)).toContain('Search failed: the database is on fire');
    const event = reports.flatMap((r) => r.events).find((e) => e.exception?.values?.[0]?.value === 'Search failed: the database is on fire');
    expect(event.tags.where).toBe('Search failed');
    expect(event.extra.code).toBe('XX000');
    // The details can hold what people wrote: they are not sent
    expect(reports.map((r) => r.body).join('\n')).not.toContain('somebody');
  });

  test('a user who is offline is not reported, but the next real error still is', async ({ page }) => {
    const reports = await catchReports(page);
    await signUp(page, newUser('off'));
    await page.route('**/rest/v1/rpc/search_profiles*', (route) => route.abort('connectionrefused'));

    await page.goto('/search?q=ann');
    await expect(page.getByRole('alert')).toBeVisible(); // the page tells the user
    await page.waitForTimeout(1500);
    expect(reports).toHaveLength(0);

    await page.unroute('**/rest/v1/rpc/search_profiles*');
    await page.route('**/rest/v1/rpc/search_profiles*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'a real problem', code: 'XX000' }) })
    );
    await page.goto('/search?q=bob');

    await expect.poll(() => messages(reports)).toEqual(['Search failed: a real problem']);
  });

  test('an outdated version of the app (a page file that is gone) is not reported: it is a release, not a bug', async ({ page }) => {
    const reports = await catchReports(page);
    await signUp(page, newUser('old'));
    await page.route(NOTIFICATIONS_FILE, (route) => route.abort());

    await bell(page).click();
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
    await page.waitForTimeout(1500);

    expect(reports).toHaveLength(0);
  });
});

test.describe('error reporting is off by default', () => {
  test('nothing is sent and the reporting code is not even downloaded', async ({ page }) => {
    const touched = [];
    page.on('request', (request) => {
      if (/sentry|envelope/i.test(request.url())) touched.push(request.url());
    });
    await signUp(page, newUser('quiet'));
    await crashNotifications(page);

    await bell(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible();
    await page.waitForTimeout(1000);

    expect(touched).toEqual([]);
  });
});
