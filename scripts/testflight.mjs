/**
 * Builds the iPhone app and uploads it to TestFlight (`npm run testflight`), signing in to Apple
 * with the App Store Connect API key in credentials/AuthKey.p8 and the ids in .env.local
 * (EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID, EXPO_APPLE_TEAM_ID), so no Apple password or 2FA code is
 * needed. The first run asks to create the distribution certificate and provisioning profile;
 * answer yes. Later runs can add --non-interactive.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = join(root, 'credentials', 'AuthKey.p8');
if (!existsSync(keyPath)) {
  console.error('No App Store Connect API key: save it as credentials/AuthKey.p8 (see docs/status.md, step 3).');
  process.exit(1);
}

const wanted = ['EXPO_TOKEN', 'EXPO_ASC_KEY_ID', 'EXPO_ASC_ISSUER_ID', 'EXPO_APPLE_TEAM_ID'];
const fromFile = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter((m) => m && wanted.includes(m[1]))
    .map((m) => [m[1], m[2].trim().replace(/^"|"$/g, '')]),
);
const missing = wanted.filter((k) => k !== 'EXPO_TOKEN' && !fromFile[k] && !process.env[k]);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`);
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['--yes', 'eas-cli@latest', 'build', '--platform', 'ios', '--profile', 'testflight', '--auto-submit', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...fromFile, EXPO_ASC_API_KEY_PATH: keyPath } },
);
process.exit(result.status ?? 1);
