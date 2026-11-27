#!/usr/bin/env node
/**
 * verify-session-state-machine.mjs — exercises the session state
 * machine (src/features/sessions/stateMachine.ts) at its boundaries.
 *
 * The state machine is pure TS (type-only imports), so this script
 * transpiles just that file with the project's own TypeScript and
 * runs assertions in plain Node — the same pattern as
 * verify-search.mjs. No network, no backend: given the same
 * (storedStatus, starts_at, ends_at, duration, now) every device must
 * derive the same status and the same synced playback offset.
 *
 * Cases: just before start, exactly at start, during, exactly at end,
 * after end, a recording shorter than its scheduled window (session
 * completes at the RECORDING's end, not the window's), a window with
 * no explicit end (duration is the end), a cancelled session (never
 * revived by the clock), and offset clamping (0 before start, clamped
 * at the duration once the recording is over).
 *
 * Run:  node scripts/verify-session-state-machine.mjs   (exit 1 on any FAIL)
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(repoRoot, 'package.json'));
const ts = require('typescript');

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-verify-session-'));
const source = fs.readFileSync(
  path.join(repoRoot, 'src', 'features', 'sessions', 'stateMachine.ts'),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
fs.writeFileSync(path.join(outDir, 'stateMachine.js'), outputText);
const { deriveStatus, deriveOffsetSeconds, canTransition } = require(
  path.join(outDir, 'stateMachine.js'),
);

// Fixed schedule: start 2026-01-01T10:00:00Z, window end 12:00:00Z,
// recording length 5400s (90 min — SHORTER than the 2h window).
const START = '2026-01-01T10:00:00.000Z';
const END = '2026-01-01T12:00:00.000Z';
const startMs = Date.parse(START);
const DURATION = 5400;

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

const status = (nowMs, overrides = {}) =>
  deriveStatus({
    storedStatus: 'upcoming',
    scheduledStartAt: START,
    scheduledEndAt: END,
    durationSeconds: DURATION,
    nowMs,
    ...overrides,
  });

// ── Status boundaries (window end 12:00, recording end 11:30) ──────
check('1s before start → upcoming', status(startMs - 1000), 'upcoming');
check('exactly at start → now_playing', status(startMs), 'now_playing');
check('1s after start → now_playing', status(startMs + 1000), 'now_playing');
check('mid-recording → now_playing', status(startMs + 2700_000), 'now_playing');
check('1s before recording end → now_playing', status(startMs + (DURATION - 1) * 1000), 'now_playing');
check('exactly at recording end (before window end) → completed', status(startMs + DURATION * 1000), 'completed');
check('between recording end and window end → completed', status(startMs + 6000_000), 'completed');
check('exactly at window end → completed', status(Date.parse(END)), 'completed');
check('after window end → completed', status(Date.parse(END) + 60_000), 'completed');

// ── No explicit window end: the duration is the end ────────────────
check('no end, during → now_playing', status(startMs + 60_000, { scheduledEndAt: null }), 'now_playing');
check('no end, at duration → completed', status(startMs + DURATION * 1000, { scheduledEndAt: null }), 'completed');

// ── No end and no duration: plays until stored status changes ──────
check('no end, no duration → now_playing', status(startMs + 999_000_000, { scheduledEndAt: null, durationSeconds: null }), 'now_playing');
check('before start regardless → upcoming', status(startMs - 60_000, { scheduledEndAt: null, durationSeconds: null }), 'upcoming');

// ── Stored terminal states are never revived by the clock ──────────
check('cancelled stays cancelled during window', status(startMs + 60_000, { storedStatus: 'cancelled' }), 'cancelled');
check('stored now_playing before start still derives upcoming', status(startMs - 60_000, { storedStatus: 'now_playing' }), 'upcoming');

// ── Synced offset: everyone at the same second ─────────────────────
const offset = (nowMs, durationSeconds = DURATION) =>
  deriveOffsetSeconds({ scheduledStartAt: START, durationSeconds, nowMs });
check('offset before start clamps to 0', offset(startMs - 30_000), 0);
check('offset at start is 0', offset(startMs), 0);
check('offset 61s in is 61', offset(startMs + 61_000), 61);
check('offset past recording end clamps to duration', offset(startMs + (DURATION + 600) * 1000), DURATION);
check('offset without duration is unclamped elapsed', offset(startMs + 61_000, null), 61);

// ── Transition table sanity ────────────────────────────────────────
check('upcoming → now_playing allowed', canTransition('upcoming', 'now_playing'), true);
check('now_playing → completed allowed', canTransition('now_playing', 'completed'), true);
check('completed → now_playing forbidden', canTransition('completed', 'now_playing'), false);
check('upcoming → completed forbidden', canTransition('upcoming', 'completed'), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
