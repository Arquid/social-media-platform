import { test, expect } from '@playwright/test';
import { newUser, signUp, logIn } from './helpers';
import { waitForEmail, countEmails, authLink } from './mail';

// The reset emails are read from the local test mailbox, and the link in them is opened in the
// browser like a real user would do it.

async function logOut(page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);
}

async function requestLink(page, email) {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel(/^email/i).fill(email);
  await page.getByRole('button', { name: 'Send link' }).click();
}

test('a user who forgot the password gets a link, chooses a new password and can log in with it', async ({ page }) => {
  const user = newUser('reset');
  await signUp(page, user);
  await logOut(page);

  await requestLink(page, user.email);
  await expect(page.getByText(`If an account exists for ${user.email}`)).toBeVisible();

  const email = await waitForEmail(user.email);
  expect(email.subject).toMatch(/reset/i);
  await page.goto(authLink(email));

  // The link logs the user in and opens the page of this app, not the address of the auth server
  // (the auth library leaves an empty "#" behind after it has read the tokens from the address)
  await expect(page).toHaveURL(/\/reset-password#?$/);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

  // Two different passwords are not accepted
  await page.getByLabel(/^new password/i).fill('Another-pw-1');
  await page.getByLabel(/^repeat new password/i).fill('Another-pw-2');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('The passwords do not match.')).toBeVisible();

  const newPassword = `New-${user.password}`;
  await page.getByLabel(/^new password/i).fill(newPassword);
  await page.getByLabel(/^repeat new password/i).fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();

  await expect(page.getByText('Your password has been changed.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

  // The old password no longer works, the new one does
  await logOut(page);
  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(user.email);
  await page.getByLabel(/^password/i).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toContainText(/invalid login credentials/i);

  await logIn(page, { ...user, password: newPassword });
});

test('a link works only once', async ({ page, browser }) => {
  const user = newUser('once');
  await signUp(page, user);
  await logOut(page);
  await requestLink(page, user.email);
  const link = authLink(await waitForEmail(user.email));

  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

  // Someone else (or the same person later, in another browser) opens the same link again
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await secondPage.goto(link);

  await expect(secondPage.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await expect(secondPage.getByLabel(/^new password/i)).toHaveCount(0);
  await second.close();
});

test('the reset page without a link, and with a broken or expired link, offers a new link', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await page.getByRole('link', { name: 'Request a new link' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);

  // What the auth server adds to the address when the link has expired
  await page.goto('/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
});

test('asking for a link with an unknown address looks the same and sends nothing', async ({ page }) => {
  const stranger = newUser('nobody');

  await requestLink(page, stranger.email);

  // The answer must not reveal that there is no such account
  await expect(page.getByText(`If an account exists for ${stranger.email}`)).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await countEmails(stranger.email)).toBe(0);
});

test('the sign up, log in and reset forms tell the browser what each field is', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel(/^email/i)).toHaveAttribute('autocomplete', 'username');
  await expect(page.getByLabel(/^password/i)).toHaveAttribute('autocomplete', 'current-password');

  await page.goto('/register');
  await expect(page.getByLabel(/^username/i)).toHaveAttribute('autocomplete', 'username');
  await expect(page.getByLabel(/^email/i)).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByLabel(/^password/i)).toHaveAttribute('autocomplete', 'new-password');

  await page.goto('/forgot-password');
  await expect(page.getByLabel(/^email/i)).toHaveAttribute('autocomplete', 'email');
});
