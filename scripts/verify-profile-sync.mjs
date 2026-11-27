#!/usr/bin/env node
/**
 * verify-profile-sync.mjs — proves the Edit Profile persistence rule
 * in src/features/auth/profileSync.ts: Google metadata is a
 * FIRST-SEED only. A name the user typed in Edit Profile must
 * survive sign-out → sign-in, i.e. syncProfileFromMetadata must
 * never write metadata over a non-empty stored display_name (same
 * for avatar_url).
 *
 * profileSync imports the real supabase client, so this script
 * transpiles the file with the project's TypeScript after swapping
 * that one import for a recording fake — the same transpile pattern
 * as verify-session-state-machine.mjs. No network, no backend.
 *
 * Run:  node scripts/verify-profile-sync.mjs   (exit 1 on any FAIL)
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(repoRoot, 'package.json'));
const ts = require('typescript');

// Recording fake supabase client: captures every profiles update.
const updates = [];
globalThis.__fakeSupabase = {
  from(table) {
    return {
      update(patch) {
        return {
          eq() {
            updates.push({ table, patch });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  },
};

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-verify-profile-'));
let source = fs.readFileSync(
  path.join(repoRoot, 'src', 'features', 'auth', 'profileSync.ts'),
  'utf8',
);
source = source.replace(
  /import \{ supabase \} from '\.\.\/\.\.\/lib\/supabase';/,
  'const supabase = globalThis.__fakeSupabase;',
);
if (source.includes("from '../../lib/supabase'")) {
  console.error('FAIL  could not stub the supabase import — script needs updating');
  process.exit(1);
}
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
fs.writeFileSync(path.join(outDir, 'profileSync.js'), outputText);
const { mergeProfileWithMetadata, syncProfileFromMetadata, extractMetadataProfile } =
  require(path.join(outDir, 'profileSync.js'));

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`,
  );
}

const googleUser = (id, meta) => ({ id, user_metadata: meta });
const row = (overrides = {}) => ({
  id: 'u',
  display_name: null,
  avatar_url: null,
  role: 'member',
  ...overrides,
});

// --- mergeProfileWithMetadata (what the UI shows) ---
const meta = { displayName: 'Mamm (Google)', avatarUrl: 'https://example.com/dp.jpg' };
check(
  'merge: stored edited name wins over Google metadata',
  mergeProfileWithMetadata(row({ display_name: 'Manmohan' }), meta)?.display_name,
  'Manmohan',
);
check(
  'merge: metadata name fills an empty stored name',
  mergeProfileWithMetadata(row(), meta)?.display_name,
  'Mamm (Google)',
);
check(
  'merge: stored avatar wins over metadata avatar',
  mergeProfileWithMetadata(row({ avatar_url: 'https://example.com/mine.jpg' }), meta)?.avatar_url,
  'https://example.com/mine.jpg',
);
check(
  'merge: metadata avatar fills an empty stored avatar',
  mergeProfileWithMetadata(row(), meta)?.avatar_url,
  'https://example.com/dp.jpg',
);

// --- syncProfileFromMetadata (what gets WRITTEN on sign-in) ---
async function syncCase(label, userId, profileRow, userMeta, expectedPatches, expectedName) {
  updates.length = 0;
  const result = await syncProfileFromMetadata(
    googleUser(userId, userMeta),
    { ...profileRow, id: userId },
  );
  check(`${label} — writes`, updates.map((u) => u.patch), expectedPatches);
  check(`${label} — exposed name`, result?.display_name, expectedName);
}

// THE case from the feature request: user edited "Mamm" → "Manmohan",
// signs out, signs back in with Google (metadata still says "Mamm").
// The edit must REMAIN.
await syncCase(
  'edited name survives Google sign-in',
  'case-edit',
  row({ display_name: 'Manmohan' }),
  { full_name: 'Mamm', picture: 'https://example.com/dp.jpg' },
  [{ avatar_url: 'https://example.com/dp.jpg' }], // avatar may seed (was empty); name must NOT be written
  'Manmohan',
);

// First-ever Google sign-in: both fields seed from metadata.
await syncCase(
  'first sign-in seeds name + avatar',
  'case-first',
  row(),
  { full_name: 'Mamm', picture: 'https://example.com/dp.jpg' },
  [{ display_name: 'Mamm', avatar_url: 'https://example.com/dp.jpg' }],
  'Mamm',
);

// Blank stored name counts as empty and seeds.
await syncCase(
  'blank stored name seeds',
  'case-blank',
  row({ display_name: '   ' }),
  { full_name: 'Mamm' },
  [{ display_name: 'Mamm' }],
  'Mamm',
);

// Stored avatar is never replaced by a different metadata avatar.
await syncCase(
  'stored avatar never replaced',
  'case-avatar',
  row({ display_name: 'Manmohan', avatar_url: 'https://example.com/mine.jpg' }),
  { full_name: 'Mamm', picture: 'https://example.com/other.jpg' },
  [],
  'Manmohan',
);

// Plain email user (no Google metadata): nothing is written.
await syncCase('email user untouched', 'case-email', row({ display_name: 'Manmohan' }), {}, [], 'Manmohan');

// extractMetadataProfile sanity: Google claim names.
check(
  'extract: picture claim maps to avatar',
  extractMetadataProfile(googleUser('x', { picture: 'https://example.com/p.jpg' })).avatarUrl,
  'https://example.com/p.jpg',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
