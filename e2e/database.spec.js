import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { localSupabase } from './env';

// These tests talk to the Supabase API directly, skipping the sign up form,
// to prove that the database itself enforces the username rules.
const { url: API, anonKey: KEY } = localSupabase();

function credentials(username) {
  return {
    email: `${username.replace(/[^a-z0-9]/gi, '')}_${randomBytes(3).toString('hex')}@example.test`,
    password: `Pw-${randomBytes(8).toString('hex')}`,
  };
}

async function signUp(request, username) {
  return request.post(`${API}/auth/v1/signup`, {
    // supabase-js sends this header; without it the API returns raw database errors
    headers: { apikey: KEY, 'X-Supabase-Api-Version': '2024-01-01' },
    data: { ...credentials(username), data: { username } },
  });
}

test.describe('username rules in the database', () => {
  const invalid = [
    ['too short', 'ab'],
    ['too long', 'a'.repeat(21)],
    ['uppercase letters', 'UpperCase1'],
    ['a space', 'has space'],
    ['a special character', 'bad!name'],
    ['a dash', 'bad-name'],
  ];

  for (const [reason, username] of invalid) {
    test(`rejects a username with ${reason}`, async ({ request }) => {
      const response = await signUp(request, username);

      expect(response.ok()).toBe(false);
      const body = await response.json();
      expect(body.message).toMatch(/database error saving new user/i);
    });
  }

  test('rejects a sign up without a username', async ({ request }) => {
    const response = await request.post(`${API}/auth/v1/signup`, {
      headers: { apikey: KEY },
      data: credentials('nousername'),
    });
    expect(response.ok()).toBe(false);
  });

  test('accepts a valid username of maximum length', async ({ request }) => {
    const username = `n${randomBytes(4).toString('hex')}`.padEnd(20, '9');
    expect(username).toHaveLength(20);
    expect((await signUp(request, username)).ok()).toBe(true);
  });

  test('accepts a valid username of minimum length', async ({ request }) => {
    // Only 3 characters, so a name may already exist from an earlier run: try a few random ones
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789_';
    let accepted = false;

    for (let attempt = 0; attempt < 15 && !accepted; attempt += 1) {
      const username = Array.from({ length: 3 }, () => alphabet[randomBytes(1)[0] % alphabet.length]).join('');
      accepted = (await signUp(request, username)).ok();
    }

    expect(accepted).toBe(true);
  });

  test('accepts a normal username with an underscore', async ({ request }) => {
    const username = `u_${randomBytes(4).toString('hex')}`;
    expect((await signUp(request, username)).ok()).toBe(true);
  });

  test('does not allow the same username twice', async ({ request }) => {
    const username = `twice_${randomBytes(3).toString('hex')}`;
    expect((await signUp(request, username)).ok()).toBe(true);
    expect((await signUp(request, username)).ok()).toBe(false);
  });

  test('a logged-in user cannot rename their profile to an invalid username', async ({ request }) => {
    const username = `rename_${randomBytes(3).toString('hex')}`;
    const signUpResponse = await signUp(request, username);
    const { access_token: token, user } = await signUpResponse.json();

    const patch = (newName) =>
      request.patch(`${API}/rest/v1/profiles?id=eq.${user.id}`, {
        headers: { apikey: KEY, Authorization: `Bearer ${token}`, Prefer: 'return=representation' },
        data: { username: newName },
      });

    const bad = await patch('Not Valid!');
    expect(bad.status()).toBe(400);
    expect((await bad.json()).code).toBe('23514'); // check_violation

    const good = await patch(`${username}_2`.slice(0, 20));
    expect(good.ok()).toBe(true);
  });
});
