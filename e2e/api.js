import { randomBytes } from 'node:crypto';
import { localSupabase } from './env';

export const { url: API, anonKey: KEY } = localSupabase();

// A valid 1x1 pixel PNG image
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// Signs up a throwaway user through the API (like the sign up form does) and returns their session
export async function createUser(request, prefix = 'api') {
  const username = `${prefix}_${randomBytes(4).toString('hex')}`;
  const response = await request.post(`${API}/auth/v1/signup`, {
    headers: { apikey: KEY, 'X-Supabase-Api-Version': '2024-01-01' },
    data: {
      email: `${username}@example.test`,
      password: `Pw-${randomBytes(8).toString('hex')}`,
      data: { username },
    },
  });
  const body = await response.json();
  return { username, id: body.user.id, token: body.access_token };
}

export function authHeaders(user, extra = {}) {
  return { apikey: KEY, Authorization: `Bearer ${user.token}`, ...extra };
}

export function uploadAvatar(request, user, path, { body = TINY_PNG, contentType = 'image/png' } = {}) {
  return request.post(`${API}/storage/v1/object/avatars/${path}`, {
    headers: authHeaders(user, { 'Content-Type': contentType }),
    data: body,
  });
}

export function publicAvatarUrl(path) {
  return `${API}/storage/v1/object/public/avatars/${path}`;
}

export function patchProfile(request, user, values) {
  return request.patch(`${API}/rest/v1/profiles?id=eq.${user.id}`, {
    headers: authHeaders(user, { Prefer: 'return=representation' }),
    data: values,
  });
}
