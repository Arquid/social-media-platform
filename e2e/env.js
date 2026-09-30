import fs from 'node:fs';

// Reads a simple KEY=value env file. Returns null if the file does not exist.
export function readEnvFile(file) {
  if (!fs.existsSync(file)) return null;
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()])
  );
}

// Connection settings of the local Supabase (from .env.localdb)
export function localSupabase() {
  const env = readEnvFile('.env.localdb');
  return { url: env?.VITE_SUPABASE_URL, anonKey: env?.VITE_SUPABASE_ANON_KEY };
}
