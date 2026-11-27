#!/usr/bin/env node
/**
 * verify-hosted.mjs — static + pipeline assertions for the dual-source
 * hosted-video build (migration 0005 + R2 Edge Functions + player).
 *
 * Asserts:
 *  1. The migration contains the structural publish gate (trigger +
 *     function), RLS on both new tables, and the videos source check.
 *  2. Every Edge Function handles the unconfigured state
 *     (R2_NOT_CONFIGURED) and NO function file contains a hard-coded
 *     credential (AWS-style access keys, secret assignments, JWTs).
 *  3. HostedPlayer exposes the imperative handle API
 *     (seekTo / play / pause / setRate).
 *  4. The self-owned pipeline proof exists in /tmp/hosted-test/:
 *     the HLS master playlist parses and every segment it references
 *     exists on disk.
 *
 * Usage: node scripts/verify-hosted.mjs   (exit 0 = all passed)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
function read(rel) {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

// ── 1. Migration ─────────────────────────────────────────────────────
const migration = read('supabase/migrations/0005_hosted_videos.sql');
check('migration 0005 exists', migration !== null);
if (migration) {
  check(
    'publish gate: trigger on videos',
    migration.includes('create trigger videos_hosted_publish_gate') &&
      migration.includes('enforce_hosted_publish_gate'),
  );
  check(
    'publish gate: raises when no authorization exists',
    migration.includes('content_authorizations') && migration.includes('raise exception'),
  );
  check(
    'videos source check (youtube requires an id)',
    migration.includes("source in ('youtube', 'hosted')") &&
      migration.includes('videos_source_id_check'),
  );
  check(
    'youtube_video_id made nullable',
    migration.includes('alter column youtube_video_id drop not null'),
  );
  check(
    'RLS enabled on hosted_assets + content_authorizations',
    migration.includes('alter table public.hosted_assets enable row level security') &&
      migration.includes('alter table public.content_authorizations enable row level security'),
  );
  check(
    'rotation candidates function present, deletes nothing',
    migration.includes('hosted_rotation_candidates') &&
      !/delete\s+from\s+public\.hosted_assets/i.test(migration),
  );
}

// ── 2. Edge Functions ────────────────────────────────────────────────
const functions = [
  'supabase/functions/r2-upload/index.ts',
  'supabase/functions/r2-playback/index.ts',
  'supabase/functions/r2-admin/index.ts',
  'supabase/functions/r2-rotate/index.ts',
  'supabase/functions/_shared/s3.ts',
  'supabase/functions/_shared/auth.ts',
  'supabase/functions/_shared/rotate.ts',
];
const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/, // AWS access key id shape
  /R2_SECRET_ACCESS_KEY\s*=\s*['"][^'"]+['"]/, // assigned literal
  /R2_ACCESS_KEY_ID\s*=\s*['"][^'"]+['"]/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // JWT literal
  /secretAccessKey:\s*['"][0-9a-f]{32,}['"]/i,
];
for (const rel of functions) {
  const src = read(rel);
  check(`${rel} exists`, src !== null);
  if (!src) continue;
  if (rel.includes('index.ts')) {
    check(`${rel} handles R2_NOT_CONFIGURED`, src.includes('R2_NOT_CONFIGURED'));
  }
  const leaked = SECRET_PATTERNS.find((re) => re.test(src));
  check(`${rel} has no hard-coded secrets`, !leaked, leaked ? `matched ${leaked}` : '');
}

// ── 3. HostedPlayer handle API ───────────────────────────────────────
const player = read('src/components/video/HostedPlayer.tsx');
check('HostedPlayer exists', player !== null);
if (player) {
  for (const method of ['seekTo', 'play', 'pause', 'setRate']) {
    check(`HostedPlayer handle exposes ${method}()`, player.includes(`${method}:`) || player.includes(`${method}(`));
  }
  check('HostedPlayer supports showScrubber (session NOW PLAYING rule)', player.includes('showScrubber'));
}

// ── 4. Pipeline proof (/tmp/hosted-test) ─────────────────────────────
const hlsDir = '/tmp/hosted-test/hls';
const masterPath = join(hlsDir, 'master.m3u8');
check('pipeline proof: master.m3u8 exists', existsSync(masterPath), masterPath);
if (existsSync(masterPath)) {
  const playlist = readFileSync(masterPath, 'utf8');
  const segments = playlist
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.ts'));
  check('playlist references segments', segments.length > 0, `${segments.length} segments`);
  const missing = segments.filter((s) => !existsSync(join(hlsDir, s)));
  check('every referenced segment exists on disk', missing.length === 0, missing.join(','));
  const totalBytes = segments.reduce((sum, s) => sum + statSync(join(hlsDir, s)).size, 0);
  check('segments carry real bytes', totalBytes > 100_000, `${totalBytes} bytes`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
