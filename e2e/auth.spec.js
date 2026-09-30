import { test, expect } from '@playwright/test';
import { newUser, signUp, logIn } from './helpers';

test.describe('authentication', () => {
  test('a visitor is redirected to the login page', async ({ page }) => {
    for (const path of ['/', '/notifications', '/profile/someone']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test('sign up validates the username before anything is sent', async ({ page }) => {
    let signUpRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/auth/v1/signup')) signUpRequests += 1;
    });

    await page.goto('/register');
    await page.getByLabel('Username').fill('bad name!');
    await page.getByLabel('Email').fill('validation@example.test');
    await page.getByLabel('Password').fill('secret123');

    await expect(page.getByText(/username must be 3-20 characters/i)).toBeVisible();
    await page.getByRole('button', { name: 'Sign up' }).click();

    await expect(page).toHaveURL(/\/register$/);
    expect(signUpRequests).toBe(0);
  });

  test('a user can sign up, log out and log in again', async ({ page }) => {
    const user = newUser('auth');

    await signUp(page, user);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await logIn(page, user);
    await expect(page).toHaveURL('/');
  });

  test('wrong password shows an error', async ({ page }) => {
    const user = newUser('auth');
    await signUp(page, user);
    await page.getByRole('button', { name: 'Log out' }).click();

    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a taken username shows a friendly message', async ({ page, browser }) => {
    const first = newUser('dup');
    await signUp(page, first);

    const context = await browser.newContext();
    const other = await context.newPage();
    await other.goto('/register');
    await other.getByLabel('Username').fill(first.username);
    await other.getByLabel('Email').fill(`other_${first.email}`);
    await other.getByLabel('Password').fill('secret123');
    await other.getByRole('button', { name: 'Sign up' }).click();

    await expect(other.getByText(/username is already taken/i)).toBeVisible();
    await context.close();
  });
});
