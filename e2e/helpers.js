import { expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

// Creates throwaway credentials that are unique per test run
export function newUser(prefix = 'u') {
  const id = randomBytes(4).toString('hex');
  const username = `${prefix}_${id}`; // 3-20 chars, letters/numbers/underscore
  return {
    username,
    email: `${username}@example.test`,
    password: `Pw-${randomBytes(8).toString('hex')}`,
  };
}

export async function signUp(page, user) {
  await page.goto('/register');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

export async function logIn(page, user) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

export async function createPost(page, text) {
  await page.getByPlaceholder("What's on your mind?").fill(text);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(postCard(page, text)).toBeVisible();
}

export function postCard(page, text) {
  return page.locator('.MuiCard-root', { hasText: text });
}

// Navbar bell: the aria-label contains the number of unread notifications
export function bell(page) {
  return page.locator('a[href="/notifications"]');
}

// Collects what the page receives over its realtime connections
export function listenToFrames(page) {
  const frames = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => frames.push(String(frame.payload)));
  });
  return frames;
}

// Waits until Realtime has confirmed the subscription of a channel (its name contains `part`),
// and a moment more: a change made just after the confirmation is not always reported
export async function waitForSubscription(page, frames, part) {
  await expect
    .poll(() => frames.some((f) => f.includes(part) && f.includes('"status":"ok"')), {
      message: `realtime subscription ${part}`,
    })
    .toBe(true);
  await page.waitForTimeout(1500);
}
