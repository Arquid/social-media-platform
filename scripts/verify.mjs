// npm run verify: check the change you have made, and only that.
//
//   npm run verify                 lint, the unit tests of the changed code, and the end-to-end tests
//                                  that look at the changed parts (see scripts/affected.js)
//   npm run verify -- --all        everything, like the CI does
//   npm run verify -- --dry-run    only say what would be run
//   npm run verify -- --files=src/components/PostCard.jsx,src/pages/Search.jsx
//                                  pretend that these files were changed (for trying it out)
//
// "Changed" means: different from the last commit, or new and not committed yet.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { selectSpecs, needsSmoke, touchesDatabase, SMOKE } from './affected.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function run(command, commandArgs, { quiet = false } = {}) {
  const result = spawnSync(command, commandArgs, { stdio: quiet ? 'pipe' : 'inherit', shell: true, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function changedFiles() {
  const given = option('files');
  if (given) return given.split(',').map((f) => f.trim()).filter(Boolean);

  const tracked = run('git', ['diff', '--name-only', 'HEAD'], { quiet: true }).output;
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], { quiet: true }).output;
  return `${tracked}\n${untracked}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('warning:') && !line.startsWith('The file will have'));
}

const everything = flag('all');
const files = changedFiles();
const { specs, everything: unknownChange, reasons } = selectSpecs(files);
const runAllEndToEnd = everything || unknownChange;
const selected = new Set(specs);
if (!runAllEndToEnd && needsSmoke(files)) SMOKE.forEach((name) => selected.add(name));
const specPaths = [...selected].sort().map((name) => `e2e/${name}.spec.js`);
const resetDatabase = everything || touchesDatabase(files);

// ---- the plan ----
console.log(`\nChanged files: ${files.length}`);
for (const file of files) console.log(`  ${file}  (${everything ? 'all tests are run' : reasons[file] ?? 'checked by the unit tests'})`);
console.log('\nPlan:');
console.log('  1. lint');
console.log(`  2. unit tests ${everything || files.some((f) => /^(package|vite\.config|src\/test\/setup)/.test(f)) ? '(all)' : '(the ones that are affected by the change)'}`);
if (runAllEndToEnd) console.log(`  3. end-to-end tests: ALL${unknownChange && !everything ? ' (a changed file is not known to scripts/affected.js)' : ''}`);
else if (specPaths.length > 0) console.log(`  3. end-to-end tests: ${specPaths.length} of ${fs.readdirSync('e2e').filter((f) => f.endsWith('.spec.js')).length} files: ${[...selected].sort().join(', ')}`);
else console.log('  3. end-to-end tests: none needed');
if (resetDatabase && (runAllEndToEnd || specPaths.length > 0)) console.log(`     (the local database is reset first: ${everything ? 'everything is run' : 'a migration changed'})`);
if (flag('dry-run')) process.exit(0);

// ---- the run ----
const started = Date.now();
const failures = [];
const step = (name, command, commandArgs) => {
  console.log(`\n=== ${name} ===`);
  const { ok } = run(command, commandArgs);
  if (!ok) failures.push(name);
  return ok;
};

step('lint', 'npm', ['run', 'lint', '--silent']);

const unitAll = everything || files.some((f) => /^(package|vite\.config|src\/test\/setup)/.test(f));
if (files.some((f) => f.startsWith('src/') || f.startsWith('scripts/')) || unitAll) {
  step('unit tests', 'npx', ['vitest', 'run', ...(unitAll ? [] : ['--changed'])]);
} else {
  console.log('\n=== unit tests === (no code was changed: skipped)');
}

if (runAllEndToEnd || specPaths.length > 0) {
  const dockerUp = run('docker', ['info'], { quiet: true }).ok;
  if (!dockerUp) {
    console.log('\nDocker is not running: start Docker Desktop and run this again.');
    process.exit(1);
  }
  const running = run('docker', ['ps', '--format', '{{.Names}}'], { quiet: true }).output.includes('supabase_db_');
  if (!running) step('start the local Supabase', 'npx', ['supabase', 'start']);
  if (resetDatabase || !running) step('reset the local database', 'npx', ['supabase', 'db', 'reset']);

  step(
    runAllEndToEnd ? 'end-to-end tests (all)' : `end-to-end tests (${specPaths.length} files)`,
    'npx',
    ['playwright', 'test', ...(runAllEndToEnd ? [] : specPaths), '--retries=0', '--reporter=line']
  );
}

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\n${failures.length === 0 ? 'ALL GOOD' : `FAILED: ${failures.join(', ')}`} (${seconds} s)`);
console.log('The CI runs everything, so this is the fast check, not the last word.');
process.exit(failures.length === 0 ? 0 : 1);
