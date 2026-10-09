import { createClient } from '@supabase/supabase-js';
import { readEnvFile } from './env';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

// Tries to subscribe to live changes once. Resolves true when the server confirms the subscription.
function canSubscribe(baseUrl, anonKey) {
  return new Promise((resolve) => {
    const client = createClient(baseUrl, anonKey);
    const channel = client
      .channel(`ready-check-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => {});

    let finished = false;
    const finish = async (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      await client.removeChannel(channel);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 5000);

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') finish(true);
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) finish(false);
    });
  });
}

// Realtime starts later than the rest of Supabase, and after a database reset it needs a few
// seconds to reconnect to the database. Without waiting, the first tests could run before live
// updates work (for example a new post would not show up).
async function waitForRealtime(baseUrl, anonKey, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await canSubscribe(baseUrl, anonKey)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Supabase Realtime did not become ready within ${timeoutMs / 1000} seconds.`);
}

// Runs once before all e2e tests. The tests create real accounts, so they must
// only ever talk to the local Supabase (Docker), never to a cloud project.
export default async function globalSetup() {
  const env = readEnvFile('.env.localdb');
  if (!env?.VITE_SUPABASE_URL || !env?.VITE_SUPABASE_ANON_KEY) {
    throw new Error(
      'Missing .env.localdb. Copy .env.localdb.example to .env.localdb and paste the ANON_KEY from `npm run db:status`.'
    );
  }

  const url = new URL(env.VITE_SUPABASE_URL);
  if (!LOCAL_HOSTS.includes(url.hostname)) {
    throw new Error(
      `Refusing to run e2e tests against ${url.hostname}. VITE_SUPABASE_URL in .env.localdb must point to localhost.`
    );
  }

  try {
    const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (error) {
    throw new Error(
      `Local Supabase is not reachable at ${env.VITE_SUPABASE_URL} (${error.message}). Start it with \`npm run db:start\` and wait a few seconds.`,
      { cause: error }
    );
  }

  await waitForRealtime(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
}
