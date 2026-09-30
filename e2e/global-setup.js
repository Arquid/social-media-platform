import { readEnvFile } from './env';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

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
}
