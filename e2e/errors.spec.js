import { test, expect } from '@playwright/test';
import { newUser, signUp, bell } from './helpers';

// In the dev server every page is its own file; these tests break the Notifications one
const NOTIFICATIONS_FILE = '**/src/pages/Notifications.jsx*';

const errorPage = (page) => page.getByRole('alert').filter({ hasText: 'Something went wrong' });

test.describe('404 page', () => {
  test('an unknown address shows the 404 page, and the link leads back to the feed', async ({ page }) => {
    await signUp(page, newUser('lost'));

    await page.goto('/this-page-does-not-exist');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('404')).toBeVisible();
    // It does not silently jump to the feed any more
    await expect(page).toHaveURL('/this-page-does-not-exist');

    await page.getByRole('link', { name: 'Back to the feed' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByPlaceholder("What's on your mind?")).toBeVisible();
  });

  test('deep and nearly-correct addresses show it too', async ({ page }) => {
    await signUp(page, newUser('lost'));

    for (const path of ['/some/deep/unknown/path', '/notification', '/profile', '/post']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    }
  });

  test('visitors who are not logged in see it instead of the login page', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');

    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page).toHaveURL('/this-page-does-not-exist');
  });

  test('real pages that need a login still lead a visitor to the login page', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('error page', () => {
  test('a page file that cannot be loaded shows the error page, the navbar keeps working', async ({ page }) => {
    await signUp(page, newUser('chunk'));
    await page.route(NOTIFICATIONS_FILE, (route) => route.abort());

    await bell(page).click();

    await expect(errorPage(page)).toBeVisible();
    await expect(page.getByText(/new version of the app may have been published/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
    // Only the page area is replaced. The navigation is still there.
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

    // Moving to another page clears the error
    await page.getByRole('link', { name: 'Socialy' }).click();
    await expect(errorPage(page)).toHaveCount(0);
    await expect(page.getByPlaceholder("What's on your mind?")).toBeVisible();
  });

  test('"Reload page" brings the page back once the file can be loaded again', async ({ page }) => {
    await signUp(page, newUser('reload'));
    await page.route(NOTIFICATIONS_FILE, (route) => route.abort());
    await bell(page).click();
    await expect(errorPage(page)).toBeVisible();

    // The problem goes away (for example the connection comes back)
    await page.unroute(NOTIFICATIONS_FILE);
    await page.getByRole('button', { name: 'Reload page' }).click();

    await expect(page).toHaveURL(/\/notifications$/);
    await expect(errorPage(page)).toHaveCount(0);
    await expect(page.getByText('No notifications yet.')).toBeVisible();
  });

  test('a page that crashes while rendering shows the error page with "Try again"', async ({ page }) => {
    await signUp(page, newUser('crash'));
    await page.route(NOTIFICATIONS_FILE, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: "export default function Notifications() { throw new Error('test crash'); }",
      })
    );

    await bell(page).click();

    await expect(errorPage(page)).toBeVisible();
    await expect(page.getByText(/could not be shown/i)).toBeVisible();
    // The technical message is not shown to the user
    await expect(page.getByText('test crash')).toHaveCount(0);
    // No reload hint, because this is not an outdated-version problem
    await expect(page.getByRole('button', { name: 'Reload page' })).toHaveCount(0);

    // Still broken, so trying again shows the error page again
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(errorPage(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  test('"Go to the feed" starts the app fresh', async ({ page }) => {
    await signUp(page, newUser('crash'));
    await page.route(NOTIFICATIONS_FILE, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: "export default function Notifications() { throw new Error('test crash'); }",
      })
    );
    await bell(page).click();
    await expect(errorPage(page)).toBeVisible();

    await page.getByRole('link', { name: 'Go to the feed' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByPlaceholder("What's on your mind?")).toBeVisible();
    await expect(errorPage(page)).toHaveCount(0);
  });
});
